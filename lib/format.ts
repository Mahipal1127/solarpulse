import type {
  TaskPriority,
  TaskStatus,
  ApprovalStatus,
  TenderStatus,
  TenderBidStatus,
  LeadStatus,
  PropertyType,
  FollowUpType,
  FollowUpStatus,
  SiteVisitStatus,
  QuotationStatus,
  ProposalStatus,
  PurchaseOrderStatus,
  DispatchStatus,
  AllocationStatus,
  MaterialReturnStatus,
  MaterialCondition,
  SurveyStatus,
  DesignStatus,
  ITTicketStatus,
  ITIssueType,
  BackupTarget,
  BackupResult,
} from '@/lib/types'
import { DISPATCH_IN_TRANSIT_WARNING_DAYS } from '@/lib/distribution/constants'

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return INR.format(amount)
}

/**
 * Indian-notation compact currency: ₹12.5L, ₹1.3Cr. For dashboard tiles, where a
 * full ₹1,25,00,000 would either wrap or shrink the type until the figure beside it
 * no longer reads as the same size.
 *
 * Verified to produce L/Cr rather than M/B on this runtime's ICU data. Use
 * formatCurrency anywhere the exact rupee matters — an invoice, a PO total, a
 * confirmation dialog. Rounding is fine on a tile and wrong on a document.
 */
const INR_COMPACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatCompactCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return INR_COMPACT.format(amount)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function daysSince(value: string): number {
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
}

export function hoursSince(value: string): number {
  return Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000)
}

/**
 * Delayed is derived, never trusted from the stored status — a department that
 * forgets to flag its own slippage still shows up as delayed to the CEO.
 */
export function isOverdue(task: { due_date: string | null; status: TaskStatus }): boolean {
  if (!task.due_date) return false
  if (task.status === 'completed' || task.status === 'archived') return false
  return new Date(task.due_date).getTime() < Date.now()
}

/* ---------------------------------------------------------------------------
   Status badge styling
   ---------------------------------------------------------------------------
   Every *_STYLES map below resolves to one of five badge utilities defined in
   app/globals.css: badge-success, badge-warning, badge-danger, badge-info and
   badge-neutral. Do not write a color class here. The brand color system defines
   exactly four status colors, and a sixth hue invented for one status is the
   thing that pulls nine modules apart.

   WHAT THE COLLAPSE COSTS, AND WHY IT IS RIGHT
   These maps used to span nine hues — sky, indigo, violet, cyan, blue, amber,
   emerald, rose, slate — so 'preparing_bid' and 'submitted' were visually
   distinct from each other. They no longer are: both are in-flight, so both are
   badge-info.

   That is deliberate. The badge always renders its label beside the color, so
   the exact state is already legible as words. What the color now encodes is
   whether someone needs to act — in flight, waiting on you, went wrong, done.
   For an interface that is scanned rather than read, that is the more useful
   distinction, and it is what keeps 'overdue' from blending into a gold
   'Create Task' button two columns over.

   THE FIVE BUCKETS
   - badge-success — a good terminal state. Won, approved, completed, received,
     delivered, accepted, resolved.
   - badge-warning — waiting on a human. Awaiting Finance, requested,
     under review, negotiation, an open ticket, damaged goods.
   - badge-danger   — a bad outcome or a slipped clock. Lost, rejected, delayed,
     missed, failed, unusable.
   - badge-info     — moving, nothing required. In progress, sent, ordered,
     in transit, scheduled.
   - badge-neutral  — not started or settled without an outcome. Draft, new,
     archived, closed, expired, cancelled.

   Note `cancelled` is neutral everywhere now. It used to be slate in tender,
   survey, site-visit and quotation but rose in PO, dispatch and allocation — the
   same idea in two colors depending on which page you happened to be on. A
   cancellation is a decision someone made, not a failure, so it reads neutral.
   --------------------------------------------------------------------------- */

/**
 * Priority is not a status, but it shares the badge. It maps onto the urgency
 * axis rather than the outcome axis: 'urgent' is danger because it is the one
 * value that should pull the eye the same way an overdue row does.
 */
export const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: 'badge-neutral',
  medium: 'badge-info',
  high: 'badge-warning',
  urgent: 'badge-danger',
}

export const STATUS_STYLES: Record<TaskStatus, string> = {
  pending: 'badge-neutral',
  in_progress: 'badge-info',
  delayed: 'badge-danger',
  completed: 'badge-success',
  archived: 'badge-neutral',
}

/**
 * Left-edge rule marking priority on a task row.
 *
 * Tokens, not palette values. The task list previously hard-coded rose-500 /
 * orange-500 / blue-500 / slate-400 here, which is the exact thing the note above
 * forbids: four hues from outside the system, so "urgent" was a different red from
 * every other danger signal in the app. These map onto the same four status colors
 * the badges use, so a priority and a status agree on what red means.
 */
export const PRIORITY_BORDER: Record<TaskPriority, string> = {
  urgent: 'border-l-status-danger',
  high: 'border-l-status-warning',
  medium: 'border-l-status-info',
  low: 'border-l-border-subtle',
}

/**
 * Small filled dot echoing a task's status, for the leading edge of a list row.
 * Same four colors as the badges — the dot is a scannable restatement of the badge
 * on the far side of the row, not a second signal.
 */
export const STATUS_DOT: Record<TaskStatus, string> = {
  pending: 'bg-text-muted/40',
  in_progress: 'bg-status-info',
  delayed: 'bg-status-danger',
  completed: 'bg-status-success',
  archived: 'bg-text-muted/30',
}

export const APPROVAL_STATUS_STYLES: Record<ApprovalStatus, string> = {
  pending: 'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  delayed: 'Delayed',
  completed: 'Completed',
  archived: 'Archived',
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

// ---------------------------------------------------------------------------
// Tender module
// ---------------------------------------------------------------------------

/** A tender that is past its deadline but was never submitted or closed out. */
const TENDER_CLOSED: TenderStatus[] = ['submitted', 'won', 'lost', 'cancelled']

/**
 * Overdue is derived, never stored — same rule as isOverdue() for tasks. There
 * is deliberately no 'overdue' value in the tender_status enum: missing a
 * deadline is a fact about the clock, not a state someone has to remember to
 * set.
 */
export function isTenderOverdue(tender: {
  submission_deadline: string
  status: TenderStatus
}): boolean {
  if (TENDER_CLOSED.includes(tender.status)) return false
  return new Date(tender.submission_deadline).getTime() < Date.now()
}

/**
 * Human countdown to the deadline: "3 days left", "Overdue by 2 days", "Today".
 * Returns null once the tender has been submitted or closed, where a countdown
 * is meaningless.
 */
export function deadlineCountdown(tender: {
  submission_deadline: string
  status: TenderStatus
}): string | null {
  if (TENDER_CLOSED.includes(tender.status)) return null

  const diffMs = new Date(tender.submission_deadline).getTime() - Date.now()
  const days = Math.floor(Math.abs(diffMs) / 86_400_000)
  const hours = Math.floor(Math.abs(diffMs) / 3_600_000)

  if (diffMs < 0) {
    if (days === 0) return `Overdue by ${hours} hour${hours === 1 ? '' : 's'}`
    return `Overdue by ${days} day${days === 1 ? '' : 's'}`
  }
  if (days === 0) return hours <= 1 ? 'Due within the hour' : `${hours} hours left`
  return `${days} day${days === 1 ? '' : 's'} left`
}

export const TENDER_STATUS_STYLES: Record<TenderStatus, string> = {
  open: 'badge-info',
  preparing_bid: 'badge-info',
  submitted: 'badge-info',
  won: 'badge-success',
  lost: 'badge-danger',
  cancelled: 'badge-neutral',
}

export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  open: 'Open',
  preparing_bid: 'Preparing Bid',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
  cancelled: 'Cancelled',
}

export const BID_STATUS_STYLES: Record<TenderBidStatus, string> = {
  draft: 'badge-neutral',
  submitted: 'badge-info',
  under_review: 'badge-warning',
  won: 'badge-success',
  lost: 'badge-danger',
}

export const BID_STATUS_LABELS: Record<TenderBidStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  won: 'Won',
  lost: 'Lost',
}

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  submitted_tender: 'Submitted Tender',
  supporting_doc: 'Supporting Document',
  award_letter: 'Award Letter',
  other: 'Other',
}

// ---------------------------------------------------------------------------
// Sales module
// ---------------------------------------------------------------------------

/**
 * A follow-up whose scheduled time has passed while it is still pending.
 * Derived, never stored — same rule as isOverdue() for tasks and
 * isTenderOverdue() for tenders. There is deliberately no 'overdue' value in
 * follow_up_status: 'missed' is a judgement someone records, while overdue is
 * just a fact about the clock.
 */
export function isFollowUpOverdue(followUp: {
  scheduled_for: string
  status: FollowUpStatus
}): boolean {
  if (followUp.status !== 'pending') return false
  return new Date(followUp.scheduled_for).getTime() < Date.now()
}

/** True when a follow-up falls on today's date, regardless of time of day. */
export function isToday(value: string): boolean {
  const d = new Date(value)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/**
 * A quotation past its valid_until date that nobody has actioned. Display-only:
 * the stored 'expired' status still exists for an explicit decision, but a
 * quotation does not silently look live just because no one ran a cron job.
 */
export function isQuotationExpired(quotation: {
  valid_until: string | null
  status: QuotationStatus
}): boolean {
  if (!quotation.valid_until) return false
  if (quotation.status !== 'draft' && quotation.status !== 'sent') return false
  return new Date(quotation.valid_until).getTime() < Date.now()
}

/** Pipeline stage order for the kanban board and funnel counts. */
export const LEAD_PIPELINE_ORDER: LeadStatus[] = [
  'new',
  'contacted',
  'site_visit_scheduled',
  'quotation_sent',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
]

/** Stages that represent a lead still in play — excludes won and lost. */
export const LEAD_OPEN_STAGES: LeadStatus[] = [
  'new',
  'contacted',
  'site_visit_scheduled',
  'quotation_sent',
  'proposal_sent',
  'negotiation',
]

/**
 * Six in-flight stages all read badge-info; the pipeline board conveys where a
 * lead sits by which column it is in, so the badge does not need to re-encode
 * that. 'negotiation' is the exception — it is warning because it is the stage
 * that goes stale if nobody chases it.
 */
export const LEAD_STATUS_STYLES: Record<LeadStatus, string> = {
  new: 'badge-neutral',
  contacted: 'badge-info',
  site_visit_scheduled: 'badge-info',
  quotation_sent: 'badge-info',
  proposal_sent: 'badge-info',
  negotiation: 'badge-warning',
  won: 'badge-success',
  lost: 'badge-danger',
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  site_visit_scheduled: 'Site Visit Scheduled',
  quotation_sent: 'Quotation Sent',
  proposal_sent: 'Proposal Sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
}

/** Short labels for kanban column headers, where horizontal space is tight. */
export const LEAD_STATUS_SHORT_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  site_visit_scheduled: 'Site Visit',
  quotation_sent: 'Quoted',
  proposal_sent: 'Proposed',
  negotiation: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
}

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
}

export const LEAD_SOURCES = [
  'referral',
  'website',
  'walk_in',
  'marketing_campaign',
  'cold_call',
  'other',
] as const

export const LEAD_SOURCE_LABELS: Record<string, string> = {
  referral: 'Referral',
  website: 'Website',
  walk_in: 'Walk-in',
  marketing_campaign: 'Marketing Campaign',
  cold_call: 'Cold Call',
  other: 'Other',
}

/**
 * 'pending' is info rather than warning because a follow-up scheduled for next
 * Tuesday needs nothing today. The one that does need attention is surfaced by
 * isFollowUpOverdue(), which the queue styles separately.
 */
export const FOLLOW_UP_STATUS_STYLES: Record<FollowUpStatus, string> = {
  pending: 'badge-info',
  completed: 'badge-success',
  missed: 'badge-danger',
}

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  missed: 'Missed',
}

export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  site_visit_reminder: 'Site Visit Reminder',
}

/**
 * 'requested' is warning, not info: it is the Sales → Technical handoff the client
 * flagged as a delay source, and it sits waiting on a human to put a date on it.
 */
export const SITE_VISIT_STATUS_STYLES: Record<SiteVisitStatus, string> = {
  requested: 'badge-warning',
  scheduled: 'badge-info',
  completed: 'badge-success',
  cancelled: 'badge-neutral',
}

export const SITE_VISIT_STATUS_LABELS: Record<SiteVisitStatus, string> = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const QUOTATION_STATUS_STYLES: Record<QuotationStatus, string> = {
  draft: 'badge-neutral',
  sent: 'badge-info',
  accepted: 'badge-success',
  rejected: 'badge-danger',
  expired: 'badge-neutral',
}

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
}

export const PROPOSAL_STATUS_STYLES: Record<ProposalStatus, string> = {
  draft: 'badge-neutral',
  sent: 'badge-info',
  accepted: 'badge-success',
  rejected: 'badge-danger',
}

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

// ---------------------------------------------------------------------------
// Distribution module
// ---------------------------------------------------------------------------

/** Statuses where a purchase order has stopped expecting a delivery. */
const PO_DELIVERY_SETTLED: PurchaseOrderStatus[] = ['received', 'cancelled']

/**
 * A purchase order past its expected delivery date that has not fully arrived.
 * Derived, never stored — the same rule as isOverdue() for tasks and
 * isTenderOverdue() for tenders, and the reason purchase_order_status has no
 * 'overdue' value.
 */
export function isPurchaseOrderOverdue(po: {
  expected_delivery_date: string | null
  status: PurchaseOrderStatus
}): boolean {
  if (!po.expected_delivery_date) return false
  if (PO_DELIVERY_SETTLED.includes(po.status)) return false
  // A date column compared as an instant: the PO is late once the whole of its
  // expected day has passed, so the boundary is the start of the following day.
  const due = new Date(`${po.expected_delivery_date}T00:00:00`)
  due.setDate(due.getDate() + 1)
  return due.getTime() < Date.now()
}

/**
 * A dispatch that has been in transit longer than
 * DISPATCH_IN_TRANSIT_WARNING_DAYS without being delivered.
 *
 * Display-only, and deliberately separate from dispatch_status.delayed: that
 * value is a judgement someone records after speaking to the driver, while this
 * is only a fact about the clock. A dispatch can be flagged here and still be
 * 'in_transit' in the database.
 */
export function isDispatchRunningLate(dispatch: {
  status: DispatchStatus
  dispatched_at: string | null
  delivered_at: string | null
}): boolean {
  if (dispatch.status !== 'in_transit') return false
  if (dispatch.delivered_at) return false
  // Nothing to measure from if the dispatch never got a departure stamp. Better
  // to show no flag than to imply a delay from a missing timestamp.
  if (!dispatch.dispatched_at) return false
  return daysSince(dispatch.dispatched_at) > DISPATCH_IN_TRANSIT_WARNING_DAYS
}

/** "12 nos", "2.5 kg" — trims the trailing zeros Postgres numeric brings back. */
export function formatQuantity(quantity: number | null | undefined, unit?: string | null): string {
  if (quantity === null || quantity === undefined) return '—'
  const value = Number(quantity)
  const text = Number.isInteger(value) ? value.toString() : value.toString().replace(/0+$/, '')
  return unit ? `${text} ${unit}` : text
}

/**
 * 'approved' is success even though the PO is only midway through its lifecycle:
 * it means the Finance gate was cleared, and the same word carries the same color
 * in APPROVAL_STATUS_STYLES and DESIGN_STATUS_STYLES. A reviewer who sees
 * "Approved" green in the approvals queue should not meet a different green
 * elsewhere for the same decision. 'received' being green too is fine — the two
 * are never ambiguous, because each badge prints its own label.
 */
export const PO_STATUS_STYLES: Record<PurchaseOrderStatus, string> = {
  draft: 'badge-neutral',
  pending_finance_approval: 'badge-warning',
  approved: 'badge-success',
  ordered: 'badge-info',
  partially_received: 'badge-info',
  received: 'badge-success',
  cancelled: 'badge-neutral',
}

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  pending_finance_approval: 'Awaiting Finance',
  approved: 'Approved',
  ordered: 'Ordered',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
}

/** Short forms for the status tracker's step labels, where space is tight. */
export const PO_STATUS_SHORT_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  pending_finance_approval: 'Finance',
  approved: 'Approved',
  ordered: 'Ordered',
  partially_received: 'Partial',
  received: 'Received',
  cancelled: 'Cancelled',
}

/**
 * 'delayed' moves from amber to danger. A delivery that has slipped is a problem
 * to chase, not a state to note, and the token system groups it with overdue for
 * exactly that reason. Note this is the recorded status, distinct from
 * isDispatchRunningLate(), which is only a fact about the clock.
 */
export const DISPATCH_STATUS_STYLES: Record<DispatchStatus, string> = {
  preparing: 'badge-neutral',
  in_transit: 'badge-info',
  delivered: 'badge-success',
  delayed: 'badge-danger',
  cancelled: 'badge-neutral',
}

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  preparing: 'Preparing',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
}

export const ALLOCATION_STATUS_STYLES: Record<AllocationStatus, string> = {
  allocated: 'badge-info',
  dispatched: 'badge-info',
  returned: 'badge-warning',
  cancelled: 'badge-neutral',
}

export const ALLOCATION_STATUS_LABELS: Record<AllocationStatus, string> = {
  allocated: 'Allocated',
  dispatched: 'Dispatched',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

export const RETURN_STATUS_STYLES: Record<MaterialReturnStatus, string> = {
  pending: 'badge-warning',
  received_by_store: 'badge-success',
  rejected: 'badge-danger',
}

export const RETURN_STATUS_LABELS: Record<MaterialReturnStatus, string> = {
  pending: 'Pending',
  received_by_store: 'Received by Store',
  rejected: 'Rejected',
}

export const MATERIAL_CONDITION_STYLES: Record<MaterialCondition, string> = {
  good: 'badge-success',
  damaged: 'badge-warning',
  unusable: 'badge-danger',
}

export const MATERIAL_CONDITION_LABELS: Record<MaterialCondition, string> = {
  good: 'Good',
  damaged: 'Damaged',
  unusable: 'Unusable',
}

/**
 * Keyed by plain string rather than a union, like LEAD_SOURCE_LABELS: category is
 * free text in the database so the canonical list can grow without a migration.
 */
export const MATERIAL_CATEGORY_LABELS: Record<string, string> = {
  panels: 'Panels',
  inverters: 'Inverters',
  structure: 'Structure',
  cables: 'Cables',
  accessories: 'Accessories',
  tools: 'Tools',
  other: 'Other',
}

export const RETURN_REASON_LABELS: Record<string, string> = {
  excess_material: 'Excess Material',
  damaged: 'Damaged',
  wrong_item: 'Wrong Item',
  project_cancelled: 'Project Cancelled',
  other: 'Other',
}

// ---------------------------------------------------------------------------
// Technical module
// ---------------------------------------------------------------------------

/** Statuses where a survey is no longer expected to happen. */
const SURVEY_SETTLED: SurveyStatus[] = ['completed', 'cancelled']

/**
 * A survey whose scheduled slot has passed without being completed.
 *
 * Derived, never stored — survey_status has no 'overdue' value, the same choice
 * made for tasks, tenders and purchase orders.
 *
 * Note the boundary differs from isPurchaseOrderOverdue(): a PO carries a `date`
 * column, so it is only late once the whole of that day has passed. scheduled_date
 * here is a timestamptz naming an actual appointment, so 9am today is late by
 * 10am today and the instant compares directly.
 */
export function isSurveyOverdue(survey: {
  scheduled_date: string | null
  status: SurveyStatus
}): boolean {
  if (!survey.scheduled_date) return false
  if (SURVEY_SETTLED.includes(survey.status)) return false
  return new Date(survey.scheduled_date).getTime() < Date.now()
}

/**
 * Sales asked for a survey and nobody has put a date on it yet.
 *
 * The operationally important queue in this module: it is the exact handoff point
 * the client flagged as a source of delay, so the dashboard leads with it. Only
 * surveys that came from a Sales request count — a standalone survey with no date
 * is Technical's own scheduling, not a request left hanging.
 */
export function isSurveyAwaitingSchedule(survey: {
  site_visit_request_id: string | null
  scheduled_date: string | null
  status: SurveyStatus
}): boolean {
  if (!survey.site_visit_request_id) return false
  if (survey.status !== 'assigned') return false
  return survey.scheduled_date === null
}

/** "12.9716° N, 77.5946° E" — hemisphere letters beat unsigned decimals in the field. */
export function formatCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): string {
  if (latitude === null || latitude === undefined) return '—'
  if (longitude === null || longitude === undefined) return '—'
  const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`
  const lng = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`
  return `${lat}, ${lng}`
}

/** "1,250 kWh". Uses the Indian grouping the rest of the app formats money with. */
export function formatEnergy(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined) return '—'
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(kwh)} kWh`
}

/** "5.4 kW" — system sizes are conventionally written to one decimal. */
export function formatSystemSize(kw: number | null | undefined): string {
  if (kw === null || kw === undefined) return '—'
  return `${Number(kw).toFixed(1)} kW`
}

export const SURVEY_STATUS_STYLES: Record<SurveyStatus, string> = {
  assigned: 'badge-neutral',
  in_progress: 'badge-info',
  completed: 'badge-success',
  cancelled: 'badge-neutral',
}

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/**
 * 'approved' is success here for the same reason as in PO_STATUS_STYLES: the word
 * means a sign-off happened, and it should not change color between the approvals
 * queue, a purchase order and a design. That an approved design still needs
 * handing to Sales is real, but it is surfaced by the dashboard's "Approved,
 * waiting to go to Sales" panel rather than by recoloring the badge.
 */
export const DESIGN_STATUS_STYLES: Record<DesignStatus, string> = {
  draft: 'badge-neutral',
  under_review: 'badge-warning',
  approved: 'badge-success',
  sent_to_sales: 'badge-success',
}

export const DESIGN_STATUS_LABELS: Record<DesignStatus, string> = {
  draft: 'Draft',
  under_review: 'Under Review',
  approved: 'Approved',
  sent_to_sales: 'Sent to Sales',
}

/** Short forms for the design status tracker, where space is tight. */
export const DESIGN_STATUS_SHORT_LABELS: Record<DesignStatus, string> = {
  draft: 'Draft',
  under_review: 'Review',
  approved: 'Approved',
  sent_to_sales: 'To Sales',
}

export const IT_TICKET_STATUS_STYLES: Record<ITTicketStatus, string> = {
  open: 'badge-warning',
  in_progress: 'badge-info',
  resolved: 'badge-success',
  closed: 'badge-neutral',
}

export const IT_TICKET_STATUS_LABELS: Record<ITTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const IT_ISSUE_TYPE_LABELS: Record<ITIssueType, string> = {
  erp_bug: 'ERP Bug',
  software_access: 'Software Access',
  hardware: 'Hardware',
  data_backup: 'Data Backup',
  other: 'Other',
}

export const BACKUP_TARGET_LABELS: Record<BackupTarget, string> = {
  database: 'Database',
  storage: 'Storage',
}

export const BACKUP_RESULT_STYLES: Record<BackupResult, string> = {
  success: 'badge-success',
  failed: 'badge-danger',
}

export const BACKUP_RESULT_LABELS: Record<BackupResult, string> = {
  success: 'Success',
  failed: 'Failed',
}

/**
 * Keyed by plain string rather than a union, like MATERIAL_CATEGORY_LABELS:
 * survey_photos.photo_type is free text in the database so a surveyor is never
 * blocked by a missing option, and an unrecognised tag falls back to its raw value.
 */
export const SURVEY_PHOTO_TYPE_LABELS: Record<string, string> = {
  roof_overview: 'Roof Overview',
  shading_obstruction: 'Shading / Obstruction',
  meter_box: 'Meter Box',
  roof_access: 'Roof Access',
  drone_aerial: 'Drone Aerial',
  electrical_panel: 'Electrical Panel',
  other: 'Other',
}

/** Falls back to the stored value, since photo_type accepts anything. */
export function formatPhotoType(photoType: string | null | undefined): string {
  if (!photoType) return 'Untagged'
  return SURVEY_PHOTO_TYPE_LABELS[photoType] ?? photoType
}

export const ROOF_ORIENTATION_LABELS: Record<string, string> = {
  'south-facing': 'South Facing',
  'south-east': 'South East',
  'south-west': 'South West',
  'east-facing': 'East Facing',
  'west-facing': 'West Facing',
  'north-facing': 'North Facing',
  flat: 'Flat',
  mixed: 'Mixed',
}
