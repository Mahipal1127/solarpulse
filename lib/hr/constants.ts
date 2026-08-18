import type {
  CandidateStatus,
  CandidateSource,
  InterviewRound,
  InterviewResult,
  EmployeeDocumentType,
  ExitType,
  AttendanceStatus,
  LeaveType,
  SalaryStatus,
  KpiStatus,
} from '@/lib/types'

/**
 * HR domain vocabularies and storage constants.
 *
 * No 'server-only': these lists feed client pickers (the candidate form, the leave
 * form, the payroll form), so client components import from here. Nothing here is a
 * permission check — RLS (migration 0015) and the service layer own access; the four
 * tiers that gate salary/appraisal/exit visibility live there, not in this file.
 * Display labels and badge styles live in lib/format.ts alongside every other module's.
 *
 * `import type` is erased at build, so pulling the status unions in keeps this file
 * client-safe. `as const satisfies` fixes each picker's display order while proving
 * every value is a member of its DB-backed union — a typo is a compile error.
 */

export const CANDIDATE_STATUSES = [
  'applied',
  'screening',
  'interview_scheduled',
  'offered',
  'hired',
  'rejected',
] as const satisfies readonly CandidateStatus[]

export const CANDIDATE_SOURCES = [
  'referral',
  'job_portal',
  'walk_in',
  'other',
] as const satisfies readonly CandidateSource[]

export const INTERVIEW_ROUNDS = [
  'screening',
  'technical',
  'final',
] as const satisfies readonly InterviewRound[]

export const INTERVIEW_RESULTS = [
  'pending',
  'passed',
  'failed',
] as const satisfies readonly InterviewResult[]

export const EMPLOYEE_DOCUMENT_TYPES = [
  'id_proof',
  'address_proof',
  'offer_letter',
  'contract',
  'exit_letter',
  'other',
] as const satisfies readonly EmployeeDocumentType[]

export const EXIT_TYPES = [
  'resignation',
  'termination',
  'end_of_contract',
] as const satisfies readonly ExitType[]

export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'half_day',
  'on_leave',
  'holiday',
] as const satisfies readonly AttendanceStatus[]

export const LEAVE_TYPES = [
  'casual',
  'sick',
  'earned',
  'unpaid',
] as const satisfies readonly LeaveType[]

export const SALARY_STATUSES = [
  'draft',
  'finalized',
  'paid',
] as const satisfies readonly SalaryStatus[]

export const KPI_STATUSES = [
  'in_progress',
  'met',
  'not_met',
] as const satisfies readonly KpiStatus[]

/**
 * Document types that are sensitive enough to log access to when a signed download URL
 * is minted — an offer letter or contract carries compensation terms, an exit letter is
 * separation detail. Reads of these go through logSensitiveAccess, not logAction, the
 * same treatment salary rows get. id_proof/address_proof are ordinary HR paperwork.
 */
export const SENSITIVE_DOCUMENT_TYPES: readonly EmployeeDocumentType[] = [
  'offer_letter',
  'contract',
  'exit_letter',
]

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Private bucket created in migration 0015. Objects live at
 * '{employee_id}/{filename}' — the employee id is the FIRST path segment, so the
 * storage policy gates through the owning employee (CEO + HR lead manage any; the
 * employee reads their own folder). No blanket HR-member object access, mirroring the
 * stricter table RLS.
 */
export const HR_DOCUMENTS_BUCKET = 'hr-documents'

/** How long a download link stays valid. Short on purpose — a signed URL is a bearer token. */
export const SIGNED_URL_TTL_SECONDS = 300

/** Upload ceiling. HR docs are PDFs/scans, so this is tighter than the media bucket. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
