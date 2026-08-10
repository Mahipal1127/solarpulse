import type {
  PurchaseOrderStatus,
  DispatchStatus,
  AllocationStatus,
  MaterialReturnStatus,
} from '@/lib/types'

/**
 * Distribution's domain rules: thresholds, the category and reason vocabularies,
 * and the status transition tables.
 *
 * No 'server-only' here on purpose — the transition tables are the same ones the
 * PO status tracker and the dispatch controls use to decide which buttons to
 * offer, so they have to be importable from a client component. Nothing in this
 * file is a permission check; the service layer and RLS do that.
 *
 * Display labels and colours live in lib/format.ts alongside every other
 * module's, but the in-transit threshold lives here because it is a business
 * rule rather than a formatting choice.
 */

/**
 * How long a dispatch may sit 'in_transit' before the UI flags it as running
 * late. Derived at read time, never stored — a dispatch is not "delayed" in the
 * database just because a clock advanced, and dispatch_status.delayed stays a
 * judgement someone records deliberately.
 */
export const DISPATCH_IN_TRANSIT_WARNING_DAYS = 3

/** Shared by vendors, PO line items, dispatch items, allocations and returns. */
export const MATERIAL_CATEGORIES = [
  'panels',
  'inverters',
  'structure',
  'cables',
  'accessories',
  'tools',
  'other',
] as const

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

export const RETURN_REASONS = [
  'excess_material',
  'damaged',
  'wrong_item',
  'project_cancelled',
  'other',
] as const

/** Units of measure. Free text in the database; this is the picker's list. */
export const MATERIAL_UNITS = ['nos', 'kg', 'meter', 'set', 'roll', 'box', 'litre'] as const

export const DEFAULT_MATERIAL_UNIT = 'nos'

// ---------------------------------------------------------------------------
// Purchase order status flow
// ---------------------------------------------------------------------------

/**
 * The full transition table. The company workflow in the blueprint puts Finance
 * approval before Distribution acts on a PO, so 'draft' leads only to
 * 'pending_finance_approval' — there is deliberately no edge from 'draft' or
 * 'pending_finance_approval' to 'ordered'. Skipping approval is not a hidden
 * button, it is an absent edge, and the service layer rejects it with a 400.
 *
 * Enforced in three places, on purpose: here (clear errors), in the
 * distribution_create_purchase_orders policy (a PO cannot be born approved), and
 * in the enforce_po_approval_authority() trigger (which is the only one of the
 * three that can compare the old status to the new one).
 */
export const PO_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ['pending_finance_approval', 'cancelled'],
  pending_finance_approval: ['approved', 'draft', 'cancelled'],
  approved: ['ordered', 'cancelled'],
  ordered: ['partially_received', 'received', 'cancelled'],
  partially_received: ['received', 'cancelled'],
  // Terminal. A received PO is a historical record; a cancelled one stays
  // cancelled rather than being quietly revived.
  received: [],
  cancelled: [],
}

/**
 * The one transition Distribution may not perform itself. Finance or the CEO
 * owns this edge — checked by the route guard, the service layer, and the
 * database trigger independently.
 */
export const PO_FINANCE_ONLY_TRANSITIONS: PurchaseOrderStatus[] = ['approved']

/** Statuses where a PO is still expected to arrive, used for overdue counts. */
export const PO_OPEN_STATUSES: PurchaseOrderStatus[] = [
  'draft',
  'pending_finance_approval',
  'approved',
  'ordered',
  'partially_received',
]

export const PO_STATUS_ORDER: PurchaseOrderStatus[] = [
  'draft',
  'pending_finance_approval',
  'approved',
  'ordered',
  'partially_received',
  'received',
]

// ---------------------------------------------------------------------------
// Dispatch, allocation and return status flows
// ---------------------------------------------------------------------------

export const DISPATCH_TRANSITIONS: Record<DispatchStatus, DispatchStatus[]> = {
  preparing: ['in_transit', 'cancelled'],
  // 'delayed' is a sideways move, not a dead end: a delayed lorry still arrives.
  in_transit: ['delivered', 'delayed', 'cancelled'],
  delayed: ['in_transit', 'delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

export const DISPATCH_STATUS_ORDER: DispatchStatus[] = ['preparing', 'in_transit', 'delivered']

export const ALLOCATION_TRANSITIONS: Record<AllocationStatus, AllocationStatus[]> = {
  // 'dispatched' is absent on purpose: reaching it means a dispatch was created,
  // which only create_dispatch_from_allocations() may do, atomically. A manual
  // status flip would leave linked_dispatch_id null and the plan record lying.
  allocated: ['cancelled'],
  dispatched: ['returned'],
  returned: [],
  cancelled: [],
}

export const RETURN_TRANSITIONS: Record<MaterialReturnStatus, MaterialReturnStatus[]> = {
  pending: ['received_by_store', 'rejected'],
  received_by_store: [],
  rejected: [],
}

/**
 * True when `to` is reachable from `from`. Same shape for every entity in this
 * module so the callers read identically.
 *
 * Re-exported rather than defined here: Technical needs the same check, and having
 * it import from this file would couple two unrelated departments over a generic
 * four-line helper. It now lives in lib/workflow/transitions.ts; this export keeps
 * every existing Distribution call site unchanged.
 */
export { canTransition } from '@/lib/workflow/transitions'
