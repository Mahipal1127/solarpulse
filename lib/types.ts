export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'pending' | 'in_progress' | 'delayed' | 'completed' | 'archived'
export type ApprovalType = 'budget' | 'purchase' | 'leave' | 'expense'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
/**
 * Names the wire dialect the request is built in, not the company. `compatible` is
 * OpenAI's chat-completions format pointed at an operator-supplied host, which is
 * what every gateway (OpenRouter, LiteLLM, Groq, a self-hosted vLLM) speaks.
 * Must stay in step with the ai_provider enum — see migration 0010.
 */
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'compatible'
export type AICommandStatus = 'proposed' | 'confirmed' | 'rejected' | 'executed'

export type TenderStatus =
  | 'open'
  | 'preparing_bid'
  | 'submitted'
  | 'won'
  | 'lost'
  | 'cancelled'

export type TenderBidStatus = 'draft' | 'submitted' | 'under_review' | 'won' | 'lost'

export interface Organization {
  id: string
  name: string
  created_at: string
}

export interface Department {
  id: string
  organization_id: string
  parent_department_id: string | null
  name: string
  slug: string
  created_at: string
}

export interface Role {
  id: string
  organization_id: string
  department_id: string | null
  name: string
}

export interface AppUser {
  id: string
  organization_id: string
  department_id: string | null
  role_id: string
  full_name: string
  email: string
  phone: string | null
  is_active: boolean
  created_at: string
}

export interface Task {
  id: string
  organization_id: string
  title: string
  description: string | null
  created_by: string
  assigned_department_id: string
  assigned_user_id: string | null
  priority: TaskPriority
  status: TaskStatus
  due_date: string | null
  progress_percent: number
  created_at: string
  updated_at: string
}

export interface TaskUpdate {
  id: string
  task_id: string
  updated_by: string
  note: string | null
  progress_percent: number | null
  status: TaskStatus | null
  created_at: string
}

export interface TaskAttachment {
  id: string
  task_id: string
  file_path: string
  file_name: string | null
  uploaded_by: string
  created_at: string
}

export interface Approval {
  id: string
  organization_id: string
  type: ApprovalType
  requested_by: string
  department_id: string
  amount: number | null
  description: string | null
  status: ApprovalStatus
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export interface DepartmentReport {
  id: string
  department_id: string
  report_date: string
  summary: string | null
  tasks_completed: number
  tasks_pending: number
  tasks_delayed: number
  created_at: string
}

export interface AuditLog {
  id: string
  organization_id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

/** Shape returned by the ai_settings_public view. Never carries the key itself. */
export interface AISettingsPublic {
  id: string
  organization_id: string
  provider: AIProvider
  model: string
  is_enabled: boolean
  /** Credits per day, or null for unlimited. One credit is one provider token —
   *  see lib/ai/credits.ts. */
  daily_credit_limit: number | null
  has_api_key: boolean
  updated_by: string | null
  updated_at: string
  /**
   * Null means "use the vendor's default host". Not a secret — it is a hostname the
   * CEO typed — so unlike the key it is returned to the browser in full.
   */
  base_url: string | null
}

export interface AICommandLog {
  id: string
  organization_id: string
  user_id: string
  raw_prompt: string
  proposed_action: Record<string, unknown>
  status: AICommandStatus
  created_at: string
  confirmed_at: string | null
}

export interface Tender {
  id: string
  organization_id: string
  title: string
  issuing_authority: string | null
  tender_number: string | null
  description: string | null
  submission_deadline: string
  status: TenderStatus
  estimated_value: number | null
  created_by: string
  assigned_employee_id: string | null
  created_at: string
  updated_at: string
}

export interface TenderBid {
  id: string
  tender_id: string
  bid_amount: number | null
  bid_status: TenderBidStatus
  assigned_employee_id: string | null
  notes: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
}

export interface TenderDocument {
  id: string
  tender_id: string
  file_path: string
  file_name: string
  document_type: string | null
  uploaded_by: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Sales module
// ---------------------------------------------------------------------------

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'site_visit_scheduled'
  | 'quotation_sent'
  | 'proposal_sent'
  | 'negotiation'
  | 'won'
  | 'lost'

export type PropertyType = 'residential' | 'commercial' | 'industrial'
export type FollowUpType = 'call' | 'meeting' | 'email' | 'site_visit_reminder'
export type FollowUpStatus = 'pending' | 'completed' | 'missed'
export type SiteVisitStatus = 'requested' | 'scheduled' | 'completed' | 'cancelled'
export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected'

export interface Lead {
  id: string
  organization_id: string
  name: string
  phone: string | null
  email: string | null
  source: string | null
  property_type: PropertyType | null
  estimated_load_kw: number | null
  status: LeadStatus
  assigned_to: string | null
  assigned_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  organization_id: string
  lead_id: string | null
  name: string
  phone: string | null
  email: string | null
  address: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface FollowUp {
  id: string
  lead_id: string
  scheduled_for: string
  type: FollowUpType
  notes: string | null
  status: FollowUpStatus
  created_by: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface SiteVisitRequest {
  id: string
  lead_id: string
  requested_by: string
  preferred_date: string | null
  status: SiteVisitStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Quotation {
  id: string
  lead_id: string
  quoted_by: string
  system_size_kw: number | null
  amount: number
  valid_until: string | null
  status: QuotationStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Proposal {
  id: string
  lead_id: string
  quotation_id: string | null
  proposed_by: string
  amount: number
  terms: string | null
  status: ProposalStatus
  created_at: string
  updated_at: string
}

export interface DealClosure {
  id: string
  lead_id: string
  proposal_id: string | null
  closed_by: string
  final_amount: number
  closed_at: string
  customer_id: string | null
  created_at: string
}

export interface SalesTarget {
  id: string
  organization_id: string
  user_id: string
  period_start: string
  period_end: string
  target_amount: number
  target_deals: number | null
  created_by: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Distribution module
// ---------------------------------------------------------------------------

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_finance_approval'
  | 'approved'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled'

export type DispatchStatus = 'preparing' | 'in_transit' | 'delivered' | 'delayed' | 'cancelled'
export type AllocationStatus = 'allocated' | 'dispatched' | 'returned' | 'cancelled'
export type MaterialReturnStatus = 'pending' | 'received_by_store' | 'rejected'
export type MaterialCondition = 'good' | 'damaged' | 'unusable'

export interface Vendor {
  id: string
  organization_id: string
  name: string
  category: string | null
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  gstin: string | null
  /** Vendors are only ever deactivated — historical POs still reference them. */
  is_active: boolean
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface PurchaseOrder {
  id: string
  organization_id: string
  po_number: string
  vendor_id: string
  status: PurchaseOrderStatus
  expected_delivery_date: string | null
  /**
   * Maintained by the recompute_po_total() database trigger from the line items.
   * Never write this from application code — it would drift.
   */
  total_amount: number
  created_by: string
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  item_name: string
  category: string | null
  quantity: number
  unit: string
  unit_price: number
  /** Generated column: quantity * unit_price. Read-only. */
  line_total: number
  created_at: string
}

export interface MaterialDispatch {
  id: string
  organization_id: string
  dispatch_number: string
  lead_id: string | null
  dispatched_by: string
  vehicle_details: string | null
  driver_contact: string | null
  status: DispatchStatus
  dispatched_at: string | null
  delivered_at: string | null
  delivery_notes: string | null
  created_at: string
  updated_at: string
}

export interface MaterialDispatchItem {
  id: string
  dispatch_id: string
  item_name: string
  category: string | null
  quantity: number
  unit: string
  created_at: string
}

/**
 * Distribution's plan record: material earmarked for a project. Deliberately not
 * a stock check — Store owns the master inventory count and its module does not
 * exist yet.
 */
export interface MaterialAllocation {
  id: string
  organization_id: string
  lead_id: string
  item_name: string
  category: string | null
  quantity: number
  unit: string
  allocated_by: string
  status: AllocationStatus
  linked_dispatch_id: string | null
  created_at: string
  updated_at: string
}

export interface MaterialReturn {
  id: string
  organization_id: string
  dispatch_id: string | null
  lead_id: string | null
  item_name: string
  category: string | null
  quantity: number
  unit: string
  reason: string | null
  condition: MaterialCondition
  returned_by: string
  status: MaterialReturnStatus
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Technical module
// ---------------------------------------------------------------------------

export type SurveyStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled'
export type DesignStatus = 'draft' | 'under_review' | 'approved' | 'sent_to_sales'
export type ITTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type ITIssueType =
  | 'erp_bug'
  | 'software_access'
  | 'hardware'
  | 'data_backup'
  | 'other'
export type BackupTarget = 'database' | 'storage'
export type BackupResult = 'success' | 'failed'

/**
 * The shape the survey form writes into site_surveys.roof_measurements.
 *
 * Every field optional, and the column is jsonb rather than columns, because roof
 * details vary enough site to site that normalising them would mean a migration
 * each time a surveyor needs a new one. Anything read out of here should be
 * treated as possibly absent.
 */
export interface RoofMeasurements {
  usable_area_sqft?: number
  shading_notes?: string
  orientation?: string
  /** Tilt in degrees, where the surveyor recorded it. */
  tilt_degrees?: number
}

/** One line of a design's bill of quantities. */
export interface BOQLine {
  item: string
  qty: number
  unit: string
}

/**
 * Month-by-month generation estimate, keyed by lowercase short month name
 * ('jan', 'feb', ...). Optional in full or in part — an engineer may record only
 * the annual figure.
 */
export type MonthlyGeneration = Partial<Record<string, number>>

export interface SiteSurvey {
  id: string
  organization_id: string
  /** Sales' handoff row. Null when the survey was logged standalone. */
  site_visit_request_id: string | null
  lead_id: string | null
  assigned_engineer_id: string
  scheduled_date: string | null
  status: SurveyStatus
  roof_measurements: RoofMeasurements | null
  gps_latitude: number | null
  gps_longitude: number | null
  electricity_bill_avg_units: number | null
  electricity_bill_file_path: string | null
  /** A flag only. No flight control or telemetry — drone imagery uploads as photos. */
  is_drone_survey: boolean
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface SurveyPhoto {
  id: string
  survey_id: string
  file_path: string
  file_name: string
  /** Free text: the blueprint's list of types is open-ended. */
  photo_type: string | null
  uploaded_by: string
  created_at: string
}

export interface Design {
  id: string
  survey_id: string
  designed_by: string
  system_size_kw: number | null
  panel_count: number | null
  panel_wattage: number | null
  inverter_spec: string | null
  /** Uploaded documents. This module records designs; it does not draw them. */
  layout_file_path: string | null
  sld_file_path: string | null
  boq_data: BOQLine[] | null
  status: DesignStatus
  created_at: string
  updated_at: string
}

export interface GenerationReport {
  id: string
  design_id: string
  estimated_annual_generation_kwh: number | null
  estimated_monthly_generation_kwh: MonthlyGeneration | null
  /**
   * Set when the figures came out of an external tool (PVsyst, PVWatts) and were
   * uploaded. Nothing here computes generation — that is a real engineering
   * calculation this system does not fake.
   */
  report_file_path: string | null
  generated_by: string
  created_at: string
}

export interface ITSupportTicket {
  id: string
  organization_id: string
  /** Any authenticated org member, not just Technical — IT issues come from everywhere. */
  raised_by: string
  issue_type: ITIssueType | null
  description: string
  status: ITTicketStatus
  assigned_to: string | null
  resolved_at: string | null
  created_at: string
}

/**
 * A status log, not a scheduler. Rows arrive from infrastructure (Supabase's own
 * backup feature or a cron job) through the service-role client; no RLS policy
 * grants insert, so nothing in the app can write or falsify one.
 */
export interface DataBackupLog {
  id: string
  organization_id: string
  backup_type: BackupTarget
  status: BackupResult
  performed_at: string
  notes: string | null
}

/**
 * Metrics that no department module produces yet. The analytics page renders an
 * explicit empty state for these rather than a fabricated chart.
 */
export interface PendingDataSource {
  metric: string
  awaitingDepartment: string
}
