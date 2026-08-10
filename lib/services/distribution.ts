import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { assertTransition } from '@/lib/services/transitions'
import type { SessionUser } from '@/lib/auth/guards'
import {
  PO_TRANSITIONS,
  PO_FINANCE_ONLY_TRANSITIONS,
  DISPATCH_TRANSITIONS,
  ALLOCATION_TRANSITIONS,
  RETURN_TRANSITIONS,
} from '@/lib/distribution/constants'
import type {
  CreateVendorInput,
  UpdateVendorInput,
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  ApprovePurchaseOrderInput,
  CreateAllocationInput,
  UpdateAllocationInput,
  CreateDispatchInput,
  UpdateDispatchInput,
  CreateReturnInput,
  UpdateReturnInput,
} from '@/lib/validation/schemas'
import type {
  Vendor,
  PurchaseOrder,
  PurchaseOrderStatus,
  MaterialDispatch,
  MaterialAllocation,
  MaterialReturn,
} from '@/lib/types'

export { ServiceError }

export const DISTRIBUTION_DEPARTMENT_SLUG = 'distribution'
export const FINANCE_DEPARTMENT_SLUG = 'finance'

/**
 * Departments whose members may approve a purchase order, matching
 * auth_is_finance_member() in migration 0007. 'accounts' is included because the
 * 0002 seed makes it a child of Finance — an Accounts user is Finance for
 * approval purposes, and the guard has to agree with the policy or an Accounts
 * user gets a 403 on something the database would have allowed.
 */
export const PO_APPROVER_DEPARTMENT_SLUGS = [FINANCE_DEPARTMENT_SLUG, 'accounts']

/**
 * Material movement is a shared department operation, so unlike Sales there is no
 * per-employee ownership tier here: any Distribution member may act on any PO,
 * dispatch, allocation or return. The CEO reads this module but does not write to
 * it, the same rule assertCanWrite() enforces in the Tender and Sales services.
 */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== DISTRIBUTION_DEPARTMENT_SLUG) {
    throw new ServiceError('Distribution records are read-only outside the department', 403)
  }
}

/**
 * The one action Distribution may not perform on its own paperwork.
 *
 * The blueprint's workflow puts Finance approval before Distribution dispatches
 * material, so the department that raises a PO cannot be the one that approves
 * it. Checked here for a clear 403, and independently by
 * enforce_po_approval_authority() in the database — which is the check that
 * actually holds, since it sees the old and new status and cannot be bypassed by
 * any code path.
 */
function assertCanApprove(user: SessionUser): void {
  if (user.roleName === 'CEO') return
  if (PO_APPROVER_DEPARTMENT_SLUGS.includes(user.departmentSlug ?? '')) return
  throw new ServiceError('Only Finance or the CEO can approve a purchase order', 403)
}

/**
 * Loads a record the caller can see, letting RLS decide. A row outside the
 * caller's organization simply is not returned, which surfaces as the same 404 as
 * a row that does not exist — not leaking the difference is intentional.
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

// assertTransition moved to lib/services/transitions.ts when Technical needed the
// same check — see the import above. Kept identical in behaviour and wording.

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export async function createVendor(
  user: SessionUser,
  input: CreateVendorInput
): Promise<Vendor> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('vendors')
    .insert({
      organization_id: user.organization_id,
      name: input.name,
      category: input.category ?? null,
      contact_person: input.contact_person ?? null,
      phone: input.phone ?? null,
      email: input.email || null,
      address: input.address ?? null,
      gstin: input.gstin ?? null,
      notes: input.notes ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'vendor_created',
    entityType: 'vendor',
    entityId: data.id,
    metadata: { name: data.name, category: data.category },
  })

  return data as Vendor
}

export async function updateVendor(
  user: SessionUser,
  vendorId: string,
  input: UpdateVendorInput
): Promise<Vendor> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<Vendor, 'id' | 'name' | 'is_active'>>(
    supabase,
    'vendors',
    vendorId,
    'id, name, is_active',
    'Vendor'
  )

  const { email, ...rest } = input
  const patch = { ...rest, ...(email !== undefined ? { email: email || null } : {}) }

  const { data, error } = await supabase
    .from('vendors')
    .update(patch)
    .eq('id', vendorId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const deactivated = input.is_active === false && existing.is_active
  const reactivated = input.is_active === true && !existing.is_active

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: deactivated ? 'vendor_deactivated' : reactivated ? 'vendor_reactivated' : 'vendor_updated',
    entityType: 'vendor',
    entityId: vendorId,
    metadata: { name: existing.name, changed: Object.keys(input) },
  })

  return data as Vendor
}

/**
 * Soft delete, and the only kind this module has. Historical purchase orders
 * reference the vendor by foreign key, so removing the row would either fail or
 * orphan the paperwork — a deactivated vendor drops out of the pickers while
 * every past PO still reads correctly. Matches archiveTask() and markLeadLost().
 */
export async function deactivateVendor(user: SessionUser, vendorId: string): Promise<Vendor> {
  return updateVendor(user, vendorId, { is_active: false })
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

/**
 * Creates the PO and its line items in one database call.
 *
 * create_purchase_order() generates the PO number from a locked counter row
 * rather than count(*) + 1, so two concurrent creates cannot be handed the same
 * number, and it inserts every line item inside the same statement — a partial
 * failure cannot leave a PO whose total_amount is a real number that happens to
 * be wrong. total_amount itself is never passed: the recompute trigger owns it.
 */
export async function createPurchaseOrder(
  user: SessionUser,
  input: CreatePurchaseOrderInput
): Promise<PurchaseOrder> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: poId, error } = await supabase.rpc('create_purchase_order', {
    p_vendor_id: input.vendor_id,
    p_items: input.items,
    p_expected_date: input.expected_delivery_date ?? null,
    p_notes: input.notes ?? null,
    p_submit: input.submit_for_approval,
  })

  // The raise messages inside the function are already caller-facing
  // ("Vendor not found or inactive", "A purchase order needs at least one line item").
  if (error) throw new ServiceError(error.message, 400)

  const po = await loadVisible<PurchaseOrder>(
    supabase,
    'purchase_orders',
    poId as string,
    '*',
    'Purchase order'
  )

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'purchase_order_created',
    entityType: 'purchase_order',
    entityId: po.id,
    metadata: {
      po_number: po.po_number,
      vendor_id: input.vendor_id,
      item_count: input.items.length,
      total_amount: po.total_amount,
      status: po.status,
    },
  })

  // Submitting for approval is a status transition in its own right, and the
  // acceptance criteria want one audit row per transition.
  if (po.status === 'pending_finance_approval') {
    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'purchase_order_status_changed',
      entityType: 'purchase_order',
      entityId: po.id,
      metadata: {
        po_number: po.po_number,
        from_status: 'draft',
        to_status: 'pending_finance_approval',
        total_amount: po.total_amount,
      },
    })
  }

  return po
}

export async function updatePurchaseOrder(
  user: SessionUser,
  poId: string,
  input: UpdatePurchaseOrderInput
): Promise<PurchaseOrder> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<
    Pick<PurchaseOrder, 'id' | 'po_number' | 'status' | 'total_amount'>
  >(supabase, 'purchase_orders', poId, 'id, po_number, status, total_amount', 'Purchase order')

  const { items, status, ...fields } = input

  if (status && status !== existing.status) {
    // Belt and braces with the zod enum, which already excludes 'approved' from
    // this endpoint's vocabulary. Worth stating as its own error so the caller is
    // told where the transition does live rather than just that it failed.
    if (PO_FINANCE_ONLY_TRANSITIONS.includes(status as PurchaseOrderStatus)) {
      throw new ServiceError(
        'Approval is Finance’s decision — use POST /api/purchase-orders/[poId]/approve',
        403
      )
    }
    assertTransition(PO_TRANSITIONS, existing.status, status, PO_STATUS_TEXT)
  }

  // Editing the commercial terms of a PO that Finance has already been asked to
  // approve, or has approved, would move the goalposts under them.
  const editsTerms = items !== undefined || fields.vendor_id !== undefined
  if (editsTerms && existing.status !== 'draft') {
    throw new ServiceError(
      'Vendor and line items can only be changed while the purchase order is a draft',
      400
    )
  }

  if (items) {
    const { error: itemsError } = await supabase.rpc('replace_purchase_order_items', {
      p_po_id: poId,
      p_items: items,
    })
    if (itemsError) throw new ServiceError(itemsError.message, 400)
  }

  const patch = { ...fields, ...(status ? { status } : {}) }

  // A line-items-only edit has nothing left to write: the trigger already moved
  // total_amount, and touching the row again would only be for updated_at.
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('purchase_orders').update(patch).eq('id', poId)
    if (error) throw new ServiceError(error.message, 400)
  }

  const po = await loadVisible<PurchaseOrder>(
    supabase,
    'purchase_orders',
    poId,
    '*',
    'Purchase order'
  )

  const statusChanged = Boolean(status && status !== existing.status)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: statusChanged ? 'purchase_order_status_changed' : 'purchase_order_updated',
    entityType: 'purchase_order',
    entityId: poId,
    metadata: {
      po_number: existing.po_number,
      changed: Object.keys(input),
      ...(statusChanged ? { from_status: existing.status, to_status: status } : {}),
      ...(items
        ? {
            item_count: items.length,
            from_total: existing.total_amount,
            to_total: po.total_amount,
          }
        : {}),
    },
  })

  return po
}

/**
 * The Finance approval gate.
 *
 * Enforced server-side in three independent places, because the acceptance
 * criteria ask for it to hold at both the route and the database:
 *   1. assertCanApprove() here, for a clear 403;
 *   2. the finance_approve_purchase_orders policy, which is what lets a Finance
 *      user — who is not a Distribution member — update the row at all;
 *   3. enforce_po_approval_authority(), which compares old to new status and is
 *      the only check that cannot be routed around, since a with-check expression
 *      cannot see where the row came from.
 *
 * approved_by and approved_at are not written here on purpose. The trigger stamps
 * them from auth.uid(), so the record of who approved cannot be forged by a
 * caller sending someone else's id.
 */
export async function approvePurchaseOrder(
  user: SessionUser,
  poId: string,
  input: ApprovePurchaseOrderInput = {}
): Promise<PurchaseOrder> {
  assertCanApprove(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<
    Pick<PurchaseOrder, 'id' | 'po_number' | 'status' | 'total_amount' | 'vendor_id'>
  >(
    supabase,
    'purchase_orders',
    poId,
    'id, po_number, status, total_amount, vendor_id',
    'Purchase order'
  )

  if (existing.status === 'approved') {
    throw new ServiceError('This purchase order is already approved', 400)
  }
  // A PO can only be approved from the state that asks for approval. This is what
  // rejects an attempt to approve a draft that was never submitted.
  assertTransition(PO_TRANSITIONS, existing.status, 'approved', PO_STATUS_TEXT)

  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'approved' })
    .eq('id', poId)
    .select()
    .single()

  if (error) {
    // errcode check_violation is what enforce_po_approval_authority() raises when
    // a non-Finance caller reaches this far. A 403 rather than a 400: the request
    // was well formed, the caller just may not make it.
    throw new ServiceError(error.message, error.code === '23514' ? 403 : 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'purchase_order_approved',
    entityType: 'purchase_order',
    entityId: poId,
    metadata: {
      po_number: existing.po_number,
      from_status: existing.status,
      to_status: 'approved',
      // The amount being signed off, recorded at the moment of approval so the
      // audit trail still shows what was approved even if the PO changes later.
      total_amount: existing.total_amount,
      vendor_id: existing.vendor_id,
      approver_department: user.departmentSlug,
      ...(input.note ? { note: input.note } : {}),
    },
  })

  return data as PurchaseOrder
}

// ---------------------------------------------------------------------------
// Material allocations
// ---------------------------------------------------------------------------

/**
 * Plans material for a project — one row per item, all for the same lead.
 *
 * Deliberately not validated against a stock balance: Store owns the master
 * inventory count and that module does not exist yet, so there is no table to
 * check against. This is Distribution's commitment record, not an availability
 * check, and pretending otherwise would mean validating against a number nobody
 * maintains.
 */
export async function createAllocations(
  user: SessionUser,
  input: CreateAllocationInput
): Promise<MaterialAllocation[]> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // RLS decides whether this lead is visible: distribution_read_won_leads only
  // exposes closed-won projects, so allocating against an open lead fails here.
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, status')
    .eq('id', input.lead_id)
    .maybeSingle()

  if (!lead) {
    throw new ServiceError('Project not found — material is allocated against a closed-won lead', 400)
  }

  const { data, error } = await supabase
    .from('material_allocations')
    .insert(
      input.items.map((item) => ({
        organization_id: user.organization_id,
        lead_id: input.lead_id,
        item_name: item.item_name,
        category: item.category ?? null,
        quantity: item.quantity,
        unit: item.unit,
        allocated_by: user.id,
        status: 'allocated' as const,
      }))
    )
    .select()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'material_allocated',
    entityType: 'material_allocation',
    // A single logical action created several rows, so the lead is the entity the
    // trail hangs off; the row ids are in the metadata.
    entityId: input.lead_id,
    metadata: {
      lead_id: input.lead_id,
      project: lead.name,
      allocation_ids: (data ?? []).map((row) => row.id),
      items: input.items.map((i) => `${i.item_name} × ${i.quantity} ${i.unit}`),
    },
  })

  return (data ?? []) as MaterialAllocation[]
}

export async function updateAllocation(
  user: SessionUser,
  allocationId: string,
  input: UpdateAllocationInput
): Promise<MaterialAllocation> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<
    Pick<MaterialAllocation, 'id' | 'status' | 'item_name' | 'lead_id'>
  >(supabase, 'material_allocations', allocationId, 'id, status, item_name, lead_id', 'Allocation')

  // 'dispatched' is unreachable from here by design — an allocation gets there
  // only through create_dispatch_from_allocations(), which sets
  // linked_dispatch_id in the same statement.
  assertTransition(ALLOCATION_TRANSITIONS, existing.status, input.status, ALLOCATION_STATUS_TEXT)

  const { data, error } = await supabase
    .from('material_allocations')
    .update({ status: input.status })
    .eq('id', allocationId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'allocation_status_changed',
    entityType: 'material_allocation',
    entityId: allocationId,
    metadata: {
      lead_id: existing.lead_id,
      item_name: existing.item_name,
      from_status: existing.status,
      to_status: input.status,
    },
  })

  return data as MaterialAllocation
}

// ---------------------------------------------------------------------------
// Dispatches
// ---------------------------------------------------------------------------

/**
 * Creates a dispatch, its items, and — where it draws on planned allocations —
 * marks those allocations dispatched, all in one database call.
 *
 * This has to be atomic, the same principle as Sales' deal closure. Two client
 * calls could fail between them and leave either a dispatch whose allocations
 * still read 'allocated', so the same material gets sent out twice, or
 * allocations marked 'dispatched' pointing at a dispatch that was never created.
 * create_dispatch_from_allocations() also locks each allocation row, so two
 * concurrent dispatches cannot claim the same one.
 */
export async function createDispatch(
  user: SessionUser,
  input: CreateDispatchInput
): Promise<MaterialDispatch> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: dispatchId, error } = await supabase.rpc('create_dispatch_from_allocations', {
    p_lead_id: input.lead_id ?? null,
    p_allocation_ids: input.allocation_ids,
    p_items: input.items,
    p_vehicle_details: input.vehicle_details ?? null,
    p_driver_contact: input.driver_contact ?? null,
    p_notes: input.notes ?? null,
  })

  // Messages from inside the function are caller-facing: "Allocation for X is
  // already dispatched", "Allocation for X belongs to a different project".
  if (error) throw new ServiceError(error.message, 400)

  const dispatch = await loadVisible<MaterialDispatch>(
    supabase,
    'material_dispatches',
    dispatchId as string,
    '*',
    'Dispatch'
  )

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'material_dispatch_created',
    entityType: 'material_dispatch',
    entityId: dispatch.id,
    metadata: {
      dispatch_number: dispatch.dispatch_number,
      lead_id: input.lead_id ?? null,
      from_allocations: input.allocation_ids,
      ad_hoc_item_count: input.items.length,
      status: dispatch.status,
    },
  })

  return dispatch
}

export async function updateDispatch(
  user: SessionUser,
  dispatchId: string,
  input: UpdateDispatchInput
): Promise<MaterialDispatch> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<
    Pick<MaterialDispatch, 'id' | 'dispatch_number' | 'status' | 'dispatched_at' | 'lead_id'>
  >(
    supabase,
    'material_dispatches',
    dispatchId,
    'id, dispatch_number, status, dispatched_at, lead_id',
    'Dispatch'
  )

  const { status, ...fields } = input
  const statusChanged = Boolean(status && status !== existing.status)

  if (status && statusChanged) {
    assertTransition(DISPATCH_TRANSITIONS, existing.status, status, DISPATCH_STATUS_TEXT)
  }

  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('material_dispatches')
    .update({
      ...fields,
      ...(status ? { status } : {}),
      // Timestamps are stamped server-side so a client clock cannot backdate a
      // departure or a delivery — the same rule as follow_ups.completed_at. The
      // in-transit warning is measured from dispatched_at, so a forgeable value
      // there would let a late dispatch look punctual.
      ...(statusChanged && status === 'in_transit' && !existing.dispatched_at
        ? { dispatched_at: now }
        : {}),
      ...(statusChanged && status === 'delivered' ? { delivered_at: now } : {}),
    })
    .eq('id', dispatchId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: statusChanged ? 'dispatch_status_changed' : 'dispatch_updated',
    entityType: 'material_dispatch',
    entityId: dispatchId,
    metadata: {
      dispatch_number: existing.dispatch_number,
      lead_id: existing.lead_id,
      changed: Object.keys(input),
      ...(statusChanged ? { from_status: existing.status, to_status: status } : {}),
    },
  })

  // Cancelling releases the allocations this dispatch had claimed, back in the
  // database via release_allocations_on_dispatch_cancel(). Logged separately so
  // the trail shows the material became available again.
  if (statusChanged && status === 'cancelled') {
    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'allocations_released',
      entityType: 'material_dispatch',
      entityId: dispatchId,
      metadata: {
        dispatch_number: existing.dispatch_number,
        reason: 'dispatch_cancelled',
      },
    })
  }

  return data as MaterialDispatch
}

// ---------------------------------------------------------------------------
// Material returns
// ---------------------------------------------------------------------------

export async function createReturn(
  user: SessionUser,
  input: CreateReturnInput
): Promise<MaterialReturn> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // A return usually comes back from a dispatch. If one is named, it has to be
  // real and visible; the lead is inherited from it rather than trusted from the
  // client, so a return cannot be filed against the wrong project.
  let leadId = input.lead_id ?? null

  if (input.dispatch_id) {
    const dispatch = await loadVisible<Pick<MaterialDispatch, 'id' | 'lead_id'>>(
      supabase,
      'material_dispatches',
      input.dispatch_id,
      'id, lead_id',
      'Dispatch'
    )
    leadId = dispatch.lead_id
  }

  const { data, error } = await supabase
    .from('material_returns')
    .insert({
      organization_id: user.organization_id,
      dispatch_id: input.dispatch_id ?? null,
      lead_id: leadId,
      item_name: input.item_name,
      category: input.category ?? null,
      quantity: input.quantity,
      unit: input.unit,
      reason: input.reason ?? null,
      condition: input.condition,
      returned_by: user.id,
      status: 'pending' as const,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'material_return_created',
    entityType: 'material_return',
    entityId: data.id,
    metadata: {
      dispatch_id: input.dispatch_id ?? null,
      lead_id: leadId,
      item_name: input.item_name,
      quantity: input.quantity,
      condition: input.condition,
      reason: input.reason ?? null,
    },
  })

  return data as MaterialReturn
}

/**
 * Moves a return out of 'pending'.
 *
 * TODO: this should eventually be confirmed by the Store department module, not
 * self-confirmed by Distribution. Store owns the physical receipt of returned
 * material, so marking 'received_by_store' is really Store's action — but that
 * module does not exist yet. Rather than build a fake cross-department
 * confirmation flow, Distribution self-marks it in the meantime, and the audit
 * row records who actually did so.
 */
export async function updateReturn(
  user: SessionUser,
  returnId: string,
  input: UpdateReturnInput
): Promise<MaterialReturn> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<
    Pick<MaterialReturn, 'id' | 'status' | 'item_name' | 'dispatch_id'>
  >(supabase, 'material_returns', returnId, 'id, status, item_name, dispatch_id', 'Return')

  assertTransition(RETURN_TRANSITIONS, existing.status, input.status, RETURN_STATUS_TEXT)

  const { data, error } = await supabase
    .from('material_returns')
    .update({ status: input.status })
    .eq('id', returnId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'return_status_changed',
    entityType: 'material_return',
    entityId: returnId,
    metadata: {
      item_name: existing.item_name,
      dispatch_id: existing.dispatch_id,
      from_status: existing.status,
      to_status: input.status,
      // Recorded because Store did not confirm this — Distribution did, on
      // Store's behalf, until that module lands.
      self_confirmed: input.status === 'received_by_store',
    },
  })

  return data as MaterialReturn
}

/**
 * Status names for error messages only.
 *
 * Kept here rather than imported from lib/format.ts on purpose: those maps are
 * display labels that a designer may reword, while these end up in API error
 * strings and audit metadata. Coupling the two would let a UI copy change alter
 * what an error message says.
 */
const PO_STATUS_TEXT: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  pending_finance_approval: 'Pending Finance approval',
  approved: 'Approved',
  ordered: 'Ordered',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
}

const DISPATCH_STATUS_TEXT: Record<MaterialDispatch['status'], string> = {
  preparing: 'Preparing',
  in_transit: 'In transit',
  delivered: 'Delivered',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
}

const ALLOCATION_STATUS_TEXT: Record<MaterialAllocation['status'], string> = {
  allocated: 'Allocated',
  dispatched: 'Dispatched',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

const RETURN_STATUS_TEXT: Record<MaterialReturn['status'], string> = {
  pending: 'Pending',
  received_by_store: 'Received by Store',
  rejected: 'Rejected',
}
