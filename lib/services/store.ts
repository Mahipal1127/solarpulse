import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { isStoreMember, isStoreLead, STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateInventoryItemInput,
  UpdateInventoryItemInput,
  CreateStockMovementInput,
  RecordDamagedStockInput,
  CreateDealerInput,
  UpdateDealerInput,
  CreateMarketSurveyNoteInput,
  CreateFacilityLogInput,
  UpdateFacilityLogInput,
} from '@/lib/validation/schemas'
import type {
  InventoryItem,
  StockMovement,
  Dealer,
  MarketSurveyNote,
  FacilityMaintenanceLog,
} from '@/lib/types'

export { ServiceError }
export { STORE_DEPARTMENT_SLUG, isStoreMember, isStoreLead }

/**
 * Store department service layer.
 *
 * Access is deliberately looser than HR/Finance: inventory is a shared operational resource,
 * so this module uses ONE member tier — any active Store member reads and writes the whole
 * department's data (RLS in 0017 enforces it), plus the CEO org-wide. There is no own-only
 * exec tier and no separate lead tier; a lead differs only in dashboard summary widgets, not
 * in row access. So the write gate here is simply "is this a Store member (or the CEO)".
 *
 * The load-bearing rule of the module: a stock QUANTITY only ever changes through a
 * stock_movements insert. No service function updates a quantity column (there isn't one —
 * current quantity is the computed inventory_stock_levels view), and updateInventoryItem
 * explicitly cannot touch quantity. Damaged stock goes through the caller-run
 * record_damaged_stock RPC (0017) so the movement and its damage-detail row land in one
 * transaction — a half-written damage entry would corrupt the ledger the module rests on.
 */

/** The CEO reads every module; the CEO role is 'CEO'. */
function isCeo(user: SessionUser): boolean {
  return user.roleName === 'CEO'
}

/**
 * Store writes are performed by the department; the CEO reads this module but does not do the
 * Store's data entry, matching every prior module's read-only-for-outsiders rule. RLS then
 * grants the CEO the org-wide tier if they ever do write.
 */
function assertCanWrite(user: SessionUser): void {
  if (!isStoreMember(user) && !isCeo(user)) {
    throw new ServiceError('Store records are read-only outside the department', 403)
  }
}

/** numeric columns arrive from supabase-js as strings — Number() them for the app. */
function num(v: unknown): number {
  return Number(v ?? 0)
}

function coerceItem(row: Record<string, unknown>): InventoryItem {
  return {
    ...(row as unknown as InventoryItem),
    reorder_threshold: row.reorder_threshold == null ? null : num(row.reorder_threshold),
  }
}

function coerceMovement(row: Record<string, unknown>): StockMovement {
  return { ...(row as unknown as StockMovement), quantity: num(row.quantity) }
}

/**
 * Loads a record the caller can see, letting RLS decide. A row outside the caller's reach is
 * simply not returned, surfacing as the same 404 as a row that does not exist.
 */
async function loadVisible<T>(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
  id: string,
  columns: string,
  label: string
): Promise<T> {
  const { data } = await supabase.from(table).select(columns).eq('id', id).maybeSingle()
  if (!data) throw new ServiceError(`${label} not found`, 404)
  return data as T
}

// ---------------------------------------------------------------------------
// Inventory items
// ---------------------------------------------------------------------------

export async function createInventoryItem(
  user: SessionUser,
  input: CreateInventoryItemInput
): Promise<InventoryItem> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      organization_id: user.organization_id,
      name: input.name,
      category: input.category,
      sku: input.sku ?? null,
      unit: input.unit,
      reorder_threshold: input.reorder_threshold ?? null,
      rack_location: input.rack_location ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    // 23505 is the (organization_id, sku) unique constraint.
    if (error.code === '23505') {
      throw new ServiceError('An item with that SKU already exists', 409)
    }
    throw new ServiceError(error.message, 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'inventory_item_created',
    entityType: 'inventory_item',
    entityId: data.id,
    metadata: { name: input.name, category: input.category, sku: input.sku ?? null },
  })

  return coerceItem(data as Record<string, unknown>)
}

/**
 * Edits an item's catalogue fields. Deliberately cannot change quantity — there is no quantity
 * column and the schema has no such field; stock only moves through recordStockMovement.
 */
export async function updateInventoryItem(
  user: SessionUser,
  itemId: string,
  input: UpdateInventoryItemInput
): Promise<InventoryItem> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<InventoryItem, 'id'>>(
    supabase,
    'inventory_items',
    itemId,
    'id',
    'Inventory item'
  )

  const { data, error } = await supabase
    .from('inventory_items')
    .update(input)
    .eq('id', itemId)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ServiceError('An item with that SKU already exists', 409)
    }
    throw new ServiceError(error.message, 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'inventory_item_updated',
    entityType: 'inventory_item',
    entityId: itemId,
    metadata: { changed: Object.keys(input) },
  })

  return coerceItem(data as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// Stock movements — the ONLY way a quantity ever changes
// ---------------------------------------------------------------------------

/**
 * Logs a stock movement. performed_by is the session user, never the caller's to assign — a
 * movement is a report from the person who handled the stock. The DB check constraint (0017)
 * backs the schema's rule that only 'adjustment' may be negative.
 *
 * installation_id is accepted for the common "issued to a specific install" case and, when
 * present, reference_type is defaulted to 'installation' so the log reads correctly even if
 * the caller only picked an installation.
 */
export async function recordStockMovement(
  user: SessionUser,
  input: CreateStockMovementInput
): Promise<StockMovement> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // Confirm the item is visible to the caller before writing against it — turns an opaque RLS
  // rejection into a clear 404, and keeps the movement's org in step with the item's.
  const item = await loadVisible<Pick<InventoryItem, 'id' | 'organization_id'>>(
    supabase,
    'inventory_items',
    input.inventory_item_id,
    'id, organization_id',
    'Inventory item'
  )

  const referenceType =
    input.reference_type ?? (input.installation_id ? 'installation' : null)

  const { data, error } = await supabase
    .from('stock_movements')
    .insert({
      organization_id: item.organization_id,
      inventory_item_id: input.inventory_item_id,
      movement_type: input.movement_type,
      quantity: input.quantity,
      reference_type: referenceType,
      reference_id: input.installation_id ?? null,
      installation_id: input.installation_id ?? null,
      notes: input.notes ?? null,
      performed_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'stock_movement_recorded',
    entityType: 'inventory_item',
    entityId: input.inventory_item_id,
    metadata: {
      movement_type: input.movement_type,
      quantity: input.quantity,
      stock_movement_id: data.id,
      reference_type: referenceType,
      installation_id: input.installation_id ?? null,
    },
  })

  return coerceMovement(data as Record<string, unknown>)
}

/**
 * Records damaged stock atomically via the record_damaged_stock RPC (0017): the 'damaged'
 * movement (which decrements the computed quantity) AND its damaged_stock_records detail row
 * are written in one transaction. Caller-run, so RLS governs both inserts — a non-Store user
 * cannot see the item and so cannot record damage against it. The photo (if any) is uploaded
 * to the store-media bucket by the route handler first; only its path is passed here.
 */
export async function recordDamagedStock(
  user: SessionUser,
  input: RecordDamagedStockInput
): Promise<string> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // The path, if supplied, must live under this org's folder — a signed URL minted from it
  // later must not be able to reach another org's media.
  if (input.photo_file_path && !input.photo_file_path.startsWith(`${user.organization_id}/`)) {
    throw new ServiceError('Photo path does not belong to this organization', 400)
  }

  const { data: movementId, error } = await supabase.rpc('record_damaged_stock', {
    p_inventory_item_id: input.inventory_item_id,
    p_quantity: input.quantity,
    p_reason: input.reason ?? null,
    p_notes: input.notes ?? null,
    p_photo_file_path: input.photo_file_path ?? null,
  })

  if (error) {
    // Messages from inside the function are caller-facing ("Inventory item not found or not
    // visible to you", "Damaged quantity must be positive").
    throw new ServiceError(error.message, 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'damaged_stock_recorded',
    entityType: 'inventory_item',
    entityId: input.inventory_item_id,
    metadata: {
      quantity: input.quantity,
      stock_movement_id: movementId as string,
      has_photo: Boolean(input.photo_file_path),
    },
  })

  return movementId as string
}

// ---------------------------------------------------------------------------
// Dealers
// ---------------------------------------------------------------------------

export async function createDealer(
  user: SessionUser,
  input: CreateDealerInput
): Promise<Dealer> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('dealers')
    .insert({
      organization_id: user.organization_id,
      name: input.name,
      contact_person: input.contact_person ?? null,
      phone: input.phone ?? null,
      location: input.location ?? null,
      relationship_status: input.relationship_status,
      notes: input.notes ?? null,
      managed_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'dealer_created',
    entityType: 'dealer',
    entityId: data.id,
    metadata: { name: input.name, relationship_status: input.relationship_status },
  })

  return data as Dealer
}

export async function updateDealer(
  user: SessionUser,
  dealerId: string,
  input: UpdateDealerInput
): Promise<Dealer> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Dealer, 'id'>>(supabase, 'dealers', dealerId, 'id', 'Dealer')

  const { data, error } = await supabase
    .from('dealers')
    .update(input)
    .eq('id', dealerId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'dealer_updated',
    entityType: 'dealer',
    entityId: dealerId,
    metadata: { changed: Object.keys(input) },
  })

  return data as Dealer
}

// ---------------------------------------------------------------------------
// Market survey notes
// ---------------------------------------------------------------------------

export async function createMarketSurveyNote(
  user: SessionUser,
  input: CreateMarketSurveyNoteInput
): Promise<MarketSurveyNote> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('market_survey_notes')
    .insert({
      organization_id: user.organization_id,
      area: input.area,
      observations: input.observations,
      surveyed_by: user.id,
      ...(input.survey_date ? { survey_date: input.survey_date } : {}),
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'market_survey_note_created',
    entityType: 'market_survey_note',
    entityId: data.id,
    metadata: { area: input.area },
  })

  return data as MarketSurveyNote
}

// ---------------------------------------------------------------------------
// Facility maintenance logs
// ---------------------------------------------------------------------------

export async function createFacilityLog(
  user: SessionUser,
  input: CreateFacilityLogInput
): Promise<FacilityMaintenanceLog> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('facility_maintenance_logs')
    .insert({
      organization_id: user.organization_id,
      issue: input.issue,
      reported_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'facility_log_created',
    entityType: 'facility_maintenance_log',
    entityId: data.id,
    metadata: { issue: input.issue },
  })

  return data as FacilityMaintenanceLog
}

/**
 * Moves a facility issue's status. Resolving stamps resolved_by/resolved_at from the session
 * and the clock; moving it back off 'resolved' clears them, so the resolution record always
 * reflects who actually closed it, not who last edited the row.
 */
export async function updateFacilityLog(
  user: SessionUser,
  logId: string,
  input: UpdateFacilityLogInput
): Promise<FacilityMaintenanceLog> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<FacilityMaintenanceLog, 'id'>>(
    supabase,
    'facility_maintenance_logs',
    logId,
    'id',
    'Facility issue'
  )

  const resolving = input.status === 'resolved'

  const { data, error } = await supabase
    .from('facility_maintenance_logs')
    .update({
      status: input.status,
      resolved_by: resolving ? user.id : null,
      resolved_at: resolving ? new Date().toISOString() : null,
    })
    .eq('id', logId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'facility_log_status_changed',
    entityType: 'facility_maintenance_log',
    entityId: logId,
    metadata: { to_status: input.status },
  })

  return data as FacilityMaintenanceLog
}
