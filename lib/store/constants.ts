import type { SessionUser } from '@/lib/auth/guards'
import type { StockMovementType } from '@/lib/types'

/**
 * Store module domain vocabularies and membership helpers.
 *
 * No 'server-only': the category/movement lists and the membership predicates decide which
 * options a client form offers and whether it shows a read-only notice, so client components
 * import them. Nothing here is a permission boundary — RLS (0017) and the service layer are.
 * Display labels and colours live in lib/format.ts alongside every other module's.
 *
 * NOTE: only `import type` from guards.ts, never a value import. guards.ts pulls in the
 * server Supabase client (next/headers), and a value import would drag that whole server-only
 * chain into the browser bundle of every client form that imports this file. The one predicate
 * we need — the "<Department> Manager" check — is inlined below as `isManagerRole` for that
 * reason; it mirrors isDepartmentManager() in guards.ts.
 */

/** Pure mirror of guards.ts isDepartmentManager(), inlined to keep this file client-safe. */
function isManagerRole(user: SessionUser): boolean {
  return user.department_id !== null && /\sManager$/.test(user.roleName)
}

/** Seeded in 0002 as slug 'store', name 'Store'. Single-department module (like O&M). */
export const STORE_DEPARTMENT_SLUG = 'store'

/**
 * The Store-lead tier, matching auth_is_store_lead() in migration 0017. The
 * '<Department> Manager' convention that auth_is_department_manager() (0006) and
 * isDepartmentManager() (guards.ts) key off requires the seeded role to end in "Manager", so
 * the lead role 0017 creates is 'Store Manager'. A hand-made 'Store Lead' is honoured too.
 */
export const STORE_LEAD_ROLE_NAMES = ['Store Manager', 'Store Lead']

/** An active member of the Store department. Mirrors auth_is_store_member() (0017). */
export function isStoreMember(user: SessionUser): boolean {
  return user.departmentSlug === STORE_DEPARTMENT_SLUG
}

/**
 * The Store lead (or CEO-as-lead via the Manager convention). Mirrors auth_is_store_lead().
 * The lead differs from an executive only in extra dashboard summary widgets — inventory row
 * visibility is department-wide for both (see 0017's header on why there is no lead RLS tier).
 */
export function isStoreLead(user: SessionUser): boolean {
  return (
    isStoreMember(user) &&
    (isManagerRole(user) || STORE_LEAD_ROLE_NAMES.includes(user.roleName))
  )
}

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** Inventory categories. Stored as text; this is the picker's option set (0017 documents it). */
export const INVENTORY_CATEGORIES = [
  'solar_panel',
  'inverter',
  'structure',
  'cable',
  'accessory',
  'tool',
] as const

/** Common units of measure offered by the item form. `unit` is free text. */
export const INVENTORY_UNITS = ['pcs', 'meter', 'kg', 'set', 'roll', 'box'] as const

/**
 * The movement types a Store user can log directly from the stock-movement form. 'damaged'
 * is deliberately EXCLUDED here — it has its own form/endpoint (record_damaged_stock) because
 * it must write the damage-detail row in the same transaction, so offering it as a plain
 * movement option would bypass that. 'adjustment' is the manual correction (may be signed).
 */
export const LOGGABLE_MOVEMENT_TYPES: StockMovementType[] = [
  'stock_in',
  'stock_out',
  'material_issue',
  'material_return',
  'adjustment',
]

/** What a movement can reference. Stored as text; matches stock_movements.reference_type. */
export const MOVEMENT_REFERENCE_TYPES = [
  'purchase_order',
  'installation',
  'task',
  'manual',
  'other',
] as const

/** Dealer relationship lifecycle. Stored as text (0017). */
export const DEALER_RELATIONSHIP_STATUSES = ['prospective', 'active', 'inactive'] as const

/** Facility issue lifecycle. Stored as text (0017). */
export const FACILITY_STATUSES = ['open', 'in_progress', 'resolved'] as const

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Private bucket created in 0017. Objects live at '{organization_id}/{stock_movement_id}/{filename}'. */
export const STORE_MEDIA_BUCKET = 'store-media'

/** How long a damaged-stock photo download link stays valid — short, it is a bearer token. */
export const SIGNED_URL_TTL_SECONDS = 300

/** Upload ceiling for a damage photo. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
