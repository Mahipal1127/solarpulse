import type { NetMeteringStatus, SubsidyStatus } from '@/lib/types'

/**
 * DISCOM domain vocabularies and storage constants.
 *
 * No 'server-only': the document-type list feeds a client picker, so client
 * components import from here. Nothing here is a permission check — the service
 * layer and RLS do that. Display labels and colours, and the aging/staleness
 * helpers that are this module's whole point, live in lib/format.ts alongside
 * every other module's.
 *
 * Type-only imports keep this file client-safe: `import type` is erased at build,
 * so pulling NetMeteringStatus/SubsidyStatus in here adds no server dependency.
 *
 * NOTE THE ABSENCE OF A TRANSITION TABLE. The O&M module gates status moves with
 * INSTALLATION_TRANSITIONS et al. because those lifecycles are ours to control.
 * DISCOM status mirrors an external process — the electricity board's and PM Surya
 * Ghar's — that a liaison only observes and records. A case can go from
 * 'under_review' back to 'documents_pending' when the board asks for more papers,
 * or jump 'submitted' → 'rejected'. Constraining that would fight reality, so any
 * status is reachable; what the module enforces instead is that EVERY change is
 * recorded (a status-history row) so the time-in-status clock is trustworthy.
 */

/**
 * The full status vocabularies, in pipeline order. Unlike O&M's transition tables
 * these are not a state machine — the CaseStatusControl offers every status except
 * the current one, because a DISCOM case mirrors an external process that can move
 * any direction. These arrays just fix a sensible display order for the picker.
 */
export const NET_METERING_STATUSES = [
  'not_started',
  'documents_pending',
  'submitted',
  'under_review',
  'query_raised',
  'approved',
  'rejected',
] as const satisfies readonly NetMeteringStatus[]

export const SUBSIDY_STATUSES = [
  'not_started',
  'documents_pending',
  'applied',
  'under_review',
  'query_raised',
  'sanctioned',
  'disbursed',
  'rejected',
] as const satisfies readonly SubsidyStatus[]

/** Document categories offered by the upload picker. document_type is a DB enum. */
export const GOVERNMENT_DOCUMENT_TYPES = [
  'consumer_id_proof',
  'electricity_bill',
  'address_proof',
  'bank_passbook',
  'sanction_letter',
  'completion_certificate',
  'other',
] as const

/** Common DISCOMs offered as suggestions. discom_name is free text — this is a hint list. */
export const COMMON_DISCOM_NAMES = [
  'BESCOM',
  'MSEDCL',
  'TANGEDCO',
  'PSPCL',
  'UPPCL',
  'DHBVN',
  'UHBVN',
  'CESC',
  'TSSPDCL',
  'APEPDCL',
] as const

/** Subsidy schemes offered by the case form. scheme is free text in the DB. */
export const SUBSIDY_SCHEMES = ['pm_surya_ghar'] as const

export const SUBSIDY_SCHEME_LABELS: Record<string, string> = {
  pm_surya_ghar: 'PM Surya Ghar',
}

export function formatSubsidyScheme(scheme: string | null | undefined): string {
  if (!scheme) return '—'
  return SUBSIDY_SCHEME_LABELS[scheme] ?? scheme
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Private bucket created in migration 0013. Objects live at
 * '{organization_id}/{customer_id}/{filename}' — the org is the first path segment,
 * so the storage policy gates at org level and government_documents' RLS (plus the
 * service layer) enforces per-case ownership.
 */
export const DISCOM_DOCUMENTS_BUCKET = 'discom-documents'

/**
 * How long a download link stays valid. Short on purpose: a signed URL is a bearer
 * token, and these are consumer ID proofs, bank passbooks and sanction letters —
 * personal documents. The bucket is private; nothing is served from a public URL.
 */
export const SIGNED_URL_TTL_SECONDS = 300

/** Upload ceiling. Scanned government forms and sanction letters are the large cases. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
