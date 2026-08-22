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

// ---------------------------------------------------------------------------
// Operations & Maintenance module
//
// installation_status/inspection_result/service_ticket_status/service_priority/
// amc_status/amc_visit_status match the enums in migration 0012. Two states the
// build spec listed as status values are deliberately absent from the stored
// enums and computed at read time instead: an AMC's 'expiring_soon'/'expired'
// (from end_date) and a visit's 'missed' (from a passed scheduled_date) — same
// derived-never-stored rule as isOverdue()/isTenderOverdue(). numeric(n,2)
// columns arrive from supabase-js as strings; every consumer wraps them in
// Number(), so they are typed as number here as the other modules do.
// ---------------------------------------------------------------------------

export type InstallationStatus =
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'on_hold'
  | 'cancelled'

export type InspectionResult = 'passed' | 'passed_with_notes' | 'failed'
export type ServiceTicketStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed'
export type ServicePriority = 'low' | 'medium' | 'high' | 'urgent'
/** Stored AMC lifecycle only. 'expiring_soon'/'expired' are derived from end_date. */
export type AmcStatus = 'active' | 'cancelled'
/** Stored visit lifecycle only. 'missed' is derived from a passed scheduled_date. */
export type AmcVisitStatus = 'scheduled' | 'completed' | 'rescheduled'

export interface Installation {
  id: string
  organization_id: string
  design_id: string | null
  customer_id: string
  deal_closure_id: string | null
  team_lead_id: string
  status: InstallationStatus
  scheduled_start_date: string | null
  actual_start_date: string | null
  completed_date: string | null
  system_size_kw: number | null
  address: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface InstallationTeamMember {
  id: string
  installation_id: string
  user_id: string
  role_on_site: string | null
  created_at: string
}

export interface InstallationProgressUpdate {
  id: string
  installation_id: string
  updated_by: string
  progress_percent: number
  note: string | null
  created_at: string
}

export interface InstallationPhoto {
  id: string
  installation_id: string
  file_path: string
  file_name: string
  photo_stage: string | null
  uploaded_by: string
  created_at: string
}

export interface CompletionReport {
  id: string
  installation_id: string
  submitted_by: string
  summary: string
  actual_system_size_kw: number | null
  report_file_path: string | null
  created_at: string
}

export interface InstallationChecklistItem {
  id: string
  installation_id: string
  item: string
  is_checked: boolean
  checked_by: string | null
  checked_at: string | null
  created_at: string
}

export interface FinalInspection {
  id: string
  installation_id: string
  inspected_by: string
  result: InspectionResult
  notes: string | null
  inspected_at: string
}

export interface ServiceTicket {
  id: string
  organization_id: string
  customer_id: string
  installation_id: string | null
  raised_by: string
  issue_type: string | null
  description: string
  priority: ServicePriority
  status: ServiceTicketStatus
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface ServiceReport {
  id: string
  service_ticket_id: string
  reported_by: string
  work_done: string
  parts_used: string | null
  resolved: boolean
  created_at: string
}

export interface AmcContract {
  id: string
  organization_id: string
  customer_id: string
  installation_id: string | null
  start_date: string
  end_date: string
  visit_frequency: string | null
  amount: number | null
  status: AmcStatus
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface AmcVisit {
  id: string
  amc_contract_id: string
  scheduled_date: string
  completed_date: string | null
  performed_by: string | null
  status: AmcVisitStatus
  notes: string | null
  created_at: string
}

export interface PerformanceLog {
  id: string
  installation_id: string
  logged_by: string
  log_date: string
  generation_kwh: number | null
  issue_flag: boolean
  notes: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// DISCOM module
//
// net_metering_status/subsidy_status/government_document_type match the enums in
// migration 0013. Status is append-only history, not a bare column: each
// application/case carries the current `status` AND a *_status_history table
// recording every transition. "Days in current status" — the number the whole
// staleness dashboard is built on — is derived at read time from the newest
// history row (or created_at when there is none), never stored, the same
// derived-never-stored rule as AMC 'expired' and visit 'missed'. numeric(n,2)
// columns arrive from supabase-js as strings; every consumer wraps them in
// Number(), so they are typed as number here as the other modules do.
// ---------------------------------------------------------------------------

export type NetMeteringStatus =
  | 'not_started'
  | 'documents_pending'
  | 'submitted'
  | 'under_review'
  | 'query_raised'
  | 'approved'
  | 'rejected'

export type SubsidyStatus =
  | 'not_started'
  | 'documents_pending'
  | 'applied'
  | 'under_review'
  | 'query_raised'
  | 'sanctioned'
  | 'disbursed'
  | 'rejected'

export type GovernmentDocumentType =
  | 'consumer_id_proof'
  | 'electricity_bill'
  | 'address_proof'
  | 'bank_passbook'
  | 'sanction_letter'
  | 'completion_certificate'
  | 'other'

export interface NetMeteringApplication {
  id: string
  organization_id: string
  installation_id: string
  customer_id: string
  assigned_to: string
  discom_name: string | null
  consumer_number: string | null
  application_number: string | null
  status: NetMeteringStatus
  submitted_date: string | null
  approved_date: string | null
  rejection_reason: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface NetMeteringStatusHistory {
  id: string
  application_id: string
  updated_by: string
  status: NetMeteringStatus
  note: string | null
  created_at: string
}

export interface SubsidyCase {
  id: string
  organization_id: string
  installation_id: string
  customer_id: string
  assigned_to: string
  scheme: string
  application_reference: string | null
  eligible_subsidy_amount: number | null
  status: SubsidyStatus
  applied_date: string | null
  disbursed_date: string | null
  disbursed_amount: number | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface SubsidyStatusHistory {
  id: string
  subsidy_case_id: string
  updated_by: string
  status: SubsidyStatus
  note: string | null
  created_at: string
}

export interface GovernmentDocument {
  id: string
  organization_id: string
  installation_id: string | null
  net_metering_application_id: string | null
  subsidy_case_id: string | null
  document_type: GovernmentDocumentType
  file_path: string
  file_name: string
  uploaded_by: string
  created_at: string
}

export interface ConsumerVerification {
  id: string
  installation_id: string
  customer_id: string
  verified_by: string
  consumer_number_verified: boolean
  identity_verified: boolean
  address_verified: boolean
  notes: string | null
  verified_at: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Marketing & Training module
//
// Statuses are stored as plain text (not DB enums) — see migration 0014 for why:
// these lifecycles are loose and rename-prone, unlike the safety-relevant net
// metering/subsidy enums. The unions here mirror the documented value lists so the
// app gets autocomplete and exhaustiveness without the DB rigidity; a value the DB
// allows but the union omits would still round-trip as its string. numeric(n,2)
// money columns (budget_amount, amount_spent) arrive from supabase-js as strings and
// are Number()'d by the read layer, so they are typed as number here.
//
// ai_marketing_insights is WRITTEN by the CEO module's AI Marketing Officer through
// the service-role client and only READ here — no client write path exists but
// acknowledge (see the RLS in 0014).
// ---------------------------------------------------------------------------

export type ContentType = 'reel' | 'post' | 'story' | 'ad_creative'
export type ContentStatus = 'planned' | 'in_production' | 'ready' | 'posted' | 'skipped'
export type ContentAssetType =
  | 'raw_footage'
  | 'edited_video'
  | 'graphic'
  | 'script'
  | 'thumbnail'

export type CampaignObjective = 'lead_generation' | 'brand_awareness' | 'website_traffic'
export type CampaignPlatform = 'instagram' | 'facebook' | 'google' | 'other'
export type CampaignStatus = 'planning' | 'active' | 'paused' | 'completed'

export interface ContentCalendarItem {
  id: string
  organization_id: string
  title: string
  content_type: ContentType
  platform: string
  scheduled_date: string
  status: ContentStatus
  assigned_to: string
  caption_draft: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ContentAsset {
  id: string
  content_calendar_item_id: string
  file_path: string
  file_name: string
  asset_type: ContentAssetType | null
  uploaded_by: string
  created_at: string
}

export interface Campaign {
  id: string
  organization_id: string
  name: string
  objective: CampaignObjective | null
  platform: CampaignPlatform | null
  status: CampaignStatus
  start_date: string | null
  end_date: string | null
  budget_amount: number | null
  amount_spent: number
  leads_generated: number
  managed_by: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface LeadSource {
  id: string
  organization_id: string
  campaign_id: string | null
  content_calendar_item_id: string | null
  source_detail: string | null
  lead_id: string
  created_by: string
  created_at: string
}

export interface AiMarketingInsight {
  id: string
  organization_id: string
  insight_date: string
  summary: string
  recommendation: string | null
  source: string
  acknowledged_by: string | null
  acknowledged_at: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// HR module
//
// The most sensitive module: beyond the usual three tiers (CEO / dept lead / self),
// salary_records, appraisals, and exits carry a FOURTH, tighter tier — only the CEO
// and HR lead see anyone else's row; a regular employee (HR or otherwise) sees only
// their own, and a regular HR Executive sees no one's pay at all. See migration 0015
// for the RLS that enforces this; the frontend conditionally renders those tabs out
// but is NOT the source of truth.
//
// Statuses are plain text with a documented value list (0015), same choice the
// marketing module made — a growing HR team renames a stage without a type migration.
// The unions here mirror those lists for autocomplete/exhaustiveness. numeric(14,2)
// money columns arrive from supabase-js as strings and are Number()'d by the read
// layer, so they are typed number here. net_payable is a GENERATED column — read-only,
// never sent on a write.
//
// The `employees` table (extended in 0015) links to a user via employees.user_id, NOT
// employees.id; every self-scoping RLS check keys off user_id = auth.uid().
// ---------------------------------------------------------------------------

export type EmploymentStatus = 'active' | 'on_leave' | 'exited'

export type CandidateStatus =
  | 'applied'
  | 'screening'
  | 'interview_scheduled'
  | 'offered'
  | 'hired'
  | 'rejected'
export type CandidateSource = 'referral' | 'job_portal' | 'walk_in' | 'other'

export type InterviewRound = 'screening' | 'technical' | 'final'
export type InterviewResult = 'pending' | 'passed' | 'failed'

export type EmployeeDocumentType =
  | 'id_proof'
  | 'address_proof'
  | 'offer_letter'
  | 'contract'
  | 'exit_letter'
  | 'other'

export type ExitType = 'resignation' | 'termination' | 'end_of_contract'

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday'

export type LeaveType = 'casual' | 'sick' | 'earned' | 'unpaid'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export type SalaryStatus = 'draft' | 'finalized' | 'paid'

export type KpiStatus = 'in_progress' | 'met' | 'not_met'

// The employees table is created bare in 0001 and extended in 0015. This mirrors the
// full post-0015 shape.
export interface Employee {
  id: string
  user_id: string
  designation: string | null
  date_joined: string | null
  reporting_to: string | null
  employee_code: string | null
  phone: string | null
  emergency_contact: string | null
  employment_status: EmploymentStatus
  // Onboarding / ID-card additions (0018). profile_photo_path & id_card_file_path point into the
  // hr-documents bucket under '{employee_id}/...'. must_change_password gates first-login.
  profile_photo_path: string | null
  id_card_generated_at: string | null
  id_card_file_path: string | null
  whatsapp_number: string | null
  must_change_password: boolean
  created_at: string
  updated_at: string
}

export interface Candidate {
  id: string
  organization_id: string
  name: string
  phone: string | null
  email: string | null
  applied_for_department_id: string | null
  applied_for_role: string | null
  resume_file_path: string | null
  status: CandidateStatus
  source: string | null
  added_by: string
  created_at: string
  updated_at: string
}

export interface Interview {
  id: string
  candidate_id: string
  scheduled_date: string | null
  interviewer_id: string | null
  round: string | null
  result: InterviewResult
  feedback: string | null
  created_at: string
  updated_at: string
}

export interface EmployeeDocument {
  id: string
  employee_id: string
  document_type: EmployeeDocumentType
  file_path: string
  file_name: string
  uploaded_by: string
  created_at: string
}

export interface Exit {
  id: string
  employee_id: string
  exit_date: string
  reason: string | null
  exit_type: string | null
  notes: string | null
  processed_by: string
  created_at: string
}

export interface AttendanceRecord {
  id: string
  employee_id: string
  date: string
  check_in: string | null
  check_out: string | null
  status: AttendanceStatus
  marked_by: string | null
  created_at: string
}

export interface LeaveRequest {
  id: string
  employee_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  reason: string | null
  status: LeaveStatus
  approval_id: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

// net_payable is a generated column (base + bonus + incentives - deductions) — the DB
// computes it, so it is never part of an insert/update payload.
export interface SalaryRecord {
  id: string
  employee_id: string
  effective_month: string
  base_salary: number
  bonus: number
  incentives: number
  deductions: number
  net_payable: number
  status: SalaryStatus
  processed_by: string
  created_at: string
  updated_at: string
}

export interface PerformanceKpi {
  id: string
  employee_id: string
  period_start: string
  period_end: string
  kpi_description: string
  target_value: string | null
  actual_value: string | null
  status: KpiStatus
  set_by: string
  created_at: string
}

export interface Appraisal {
  id: string
  employee_id: string
  review_period: string
  rating: string | null
  strengths: string | null
  areas_of_improvement: string | null
  reviewed_by: string
  reviewed_at: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Finance & Accounts module
//
// As sensitive as HR pay data, and RECONCILIATION-shaped: most rows reference records
// other departments created (deal_closures, installations, subsidy_cases, salary_records)
// rather than duplicating their numbers. RLS (migration 0016) is the four-tier pattern —
// CEO full / Finance lead full / Finance exec own-only / no other department any access —
// with a single narrow exception function (get_invoice_status_for_deal) for a Sales user
// checking their own deal. The frontend gates sensitive pages (reports) by rendering them
// out entirely, but RLS is the source of truth.
//
// Statuses are plain text with a documented value list (0016). total_amount (invoices,
// purchase_bills) and net_payable (gst_filings) are GENERATED columns — the DB computes
// them, so they are read-only here and never part of an insert/update payload. numeric
// money columns arrive from supabase-js as strings and are Number()'d by the read layer,
// so they are typed number.
// ---------------------------------------------------------------------------

export type InvoiceType = 'advance' | 'milestone' | 'final'
export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled'

export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'upi' | 'other'

// Purchase-order status lives with Distribution (PurchaseOrderStatus, above) — Finance
// does not own POs. Finance's payables start at the bill.
export type PurchaseBillStatus = 'unpaid' | 'partially_paid' | 'paid'

export type ExpenseCategory =
  | 'rent'
  | 'utilities'
  | 'travel'
  | 'office_supplies'
  | 'marketing_spend'
  | 'salary_disbursement'
  | 'other'

export type CashFlowEntryType = 'inflow' | 'outflow'
export type CashFlowSource =
  | 'customer_payment'
  | 'subsidy_disbursement'
  | 'vendor_payment'
  | 'salary'
  | 'tax_payment'
  | 'other'

export type GstFilingStatus = 'draft' | 'filed'

export type LedgerAccountCategory =
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'salaries'
  | 'tax'
  | 'other'

// total_amount is generated (amount + gst_amount) — read-only, never sent on a write.
export interface Invoice {
  id: string
  organization_id: string
  customer_id: string
  deal_closure_id: string | null
  installation_id: string | null
  invoice_number: string
  invoice_type: InvoiceType
  amount: number
  gst_amount: number
  total_amount: number
  status: InvoiceStatus
  due_date: string | null
  issued_by: string
  created_at: string
  updated_at: string
}

export interface Receipt {
  id: string
  invoice_id: string
  amount_received: number
  payment_method: PaymentMethod | null
  reference_number: string | null
  received_date: string
  recorded_by: string
  created_at: string
}

// Purchase orders are Distribution's (PurchaseOrder interface lives in that module's
// section above). Finance links bills to a PO by id but does not model the PO itself here.

// total_amount is generated (amount + gst_amount) — read-only. purchase_order_id references
// Distribution's purchase_orders.
export interface PurchaseBill {
  id: string
  organization_id: string
  purchase_order_id: string | null
  vendor_name: string
  bill_number: string | null
  amount: number
  gst_amount: number
  total_amount: number
  status: PurchaseBillStatus
  due_date: string | null
  file_path: string | null
  recorded_by: string
  created_at: string
  updated_at: string
}

export interface VendorPayment {
  id: string
  purchase_bill_id: string
  amount_paid: number
  payment_method: PaymentMethod | null
  reference_number: string | null
  paid_date: string
  paid_by: string
  created_at: string
}

export interface Expense {
  id: string
  organization_id: string
  category: ExpenseCategory
  description: string | null
  amount: number
  expense_date: string
  approval_id: string | null
  linked_salary_record_id: string | null
  recorded_by: string
  created_at: string
}

export interface Budget {
  id: string
  organization_id: string
  department_id: string | null
  period_start: string
  period_end: string
  allocated_amount: number
  approval_id: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface CashFlowEntry {
  id: string
  organization_id: string
  entry_type: CashFlowEntryType
  source: CashFlowSource
  amount: number
  entry_date: string
  linked_receipt_id: string | null
  linked_vendor_payment_id: string | null
  linked_expense_id: string | null
  notes: string | null
  recorded_by: string
  created_at: string
}

// net_payable is generated (output_gst - input_gst) — read-only.
export interface GstFiling {
  id: string
  organization_id: string
  period: string
  output_gst: number | null
  input_gst: number | null
  net_payable: number
  status: GstFilingStatus
  filed_date: string | null
  prepared_by: string
  created_at: string
  updated_at: string
}

export interface TdsRecord {
  id: string
  organization_id: string
  deductee_name: string
  section: string | null
  amount_paid: number
  tds_deducted: number
  deduction_date: string
  deposited: boolean
  deposited_date: string | null
  recorded_by: string
  created_at: string
}

export interface LedgerEntry {
  id: string
  organization_id: string
  account_category: LedgerAccountCategory
  description: string
  debit: number
  credit: number
  entry_date: string
  linked_invoice_id: string | null
  linked_purchase_bill_id: string | null
  linked_expense_id: string | null
  recorded_by: string
  created_at: string
}

// Returned by get_invoice_status_for_deal() — the narrow Sales-facing exception. Only
// these five fields cross the department boundary, never a full invoice row.
export interface DealInvoiceStatus {
  invoice_id: string
  invoice_number: string
  status: InvoiceStatus
  total_amount: number
  due_date: string | null
}

// ---------------------------------------------------------------------------
// Store department (migration 0017)
// ---------------------------------------------------------------------------

export type InventoryCategory =
  | 'solar_panel'
  | 'inverter'
  | 'structure'
  | 'cable'
  | 'accessory'
  | 'tool'

/**
 * 'damaged' decrements stock and carries a damaged_stock_records detail row (written together
 * by record_damaged_stock). 'adjustment' is a manual correction and is the ONLY type whose
 * quantity may be negative; every other type is stored strictly positive and the sign is
 * implied by the type in the inventory_stock_levels view.
 */
export type StockMovementType =
  | 'stock_in'
  | 'stock_out'
  | 'material_issue'
  | 'material_return'
  | 'damaged'
  | 'adjustment'

export type MovementReferenceType =
  | 'purchase_order'
  | 'installation'
  | 'task'
  | 'manual'
  | 'other'

export type DealerRelationshipStatus = 'prospective' | 'active' | 'inactive'
export type FacilityStatus = 'open' | 'in_progress' | 'resolved'

export interface InventoryItem {
  id: string
  organization_id: string
  name: string
  category: InventoryCategory
  sku: string | null
  unit: string
  reorder_threshold: number | null
  rack_location: string | null
  created_by: string
  created_at: string
  updated_at: string
}

/**
 * A row of the inventory_stock_levels view (0017) — the item plus its live computed quantity.
 * current_quantity is NEVER a column on inventory_items; it is summed from the movement log,
 * so this is the shape every stock-reading surface uses instead of InventoryItem directly.
 */
export interface InventoryStockLevel {
  inventory_item_id: string
  organization_id: string
  name: string
  category: InventoryCategory
  sku: string | null
  unit: string
  reorder_threshold: number | null
  rack_location: string | null
  current_quantity: number
}

export interface StockMovement {
  id: string
  organization_id: string
  inventory_item_id: string
  movement_type: StockMovementType
  quantity: number
  reference_type: MovementReferenceType | null
  reference_id: string | null
  installation_id: string | null
  notes: string | null
  performed_by: string
  created_at: string
}

export interface DamagedStockRecord {
  id: string
  stock_movement_id: string
  reason: string | null
  reported_by: string
  photo_file_path: string | null
  created_at: string
}

export interface Dealer {
  id: string
  organization_id: string
  name: string
  contact_person: string | null
  phone: string | null
  location: string | null
  relationship_status: DealerRelationshipStatus
  notes: string | null
  managed_by: string
  created_at: string
  updated_at: string
}

export interface MarketSurveyNote {
  id: string
  organization_id: string
  area: string
  observations: string
  surveyed_by: string
  survey_date: string
  created_at: string
}

export interface FacilityMaintenanceLog {
  id: string
  organization_id: string
  issue: string
  status: FacilityStatus
  reported_by: string
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
}
