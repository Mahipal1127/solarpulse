import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction, logSensitiveAccess } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { isDepartmentManager } from '@/lib/auth/guards'
import { DISCOM_DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from '@/lib/discom/constants'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateNetMeteringInput,
  UpdateNetMeteringInput,
  NetMeteringStatusChangeInput,
  CreateSubsidyInput,
  UpdateSubsidyInput,
  SubsidyStatusChangeInput,
  CreateGovernmentDocumentInput,
  CreateConsumerVerificationInput,
} from '@/lib/validation/schemas'
import type {
  Installation,
  NetMeteringApplication,
  SubsidyCase,
  GovernmentDocument,
  ConsumerVerification,
} from '@/lib/types'

export { ServiceError }

/** Re-exported so a route can tell the caller how long its signed URL lasts. */
export { SIGNED_URL_TTL_SECONDS }

/**
 * The slug migration 0002 seeds this department under, and the one every RLS helper
 * in 0013 and every requireDepartment guard keys off. The build spec wrote 'DISCOM'
 * as a display name; the slug is lowercase 'discom'.
 */
export const DISCOM_DEPARTMENT_SLUG = 'discom'

/**
 * The department-wide tier, matching auth_is_discom_lead() in migration 0013.
 *
 * Both names are accepted for the reason spelled out there: the build spec called
 * this role "DISCOM Lead", but the '<Department> Manager' convention that
 * auth_is_department_manager() (0006) and isDepartmentManager() (guards.ts) key off
 * requires the seeded role to end in "Manager". The guard has to agree with the
 * policy, so it honours either — but the seeded, working role is 'DISCOM Manager'.
 */
export const DISCOM_LEAD_ROLE_NAMES = ['DISCOM Manager', 'DISCOM Lead']

export function isDiscomLead(user: SessionUser): boolean {
  return (
    user.departmentSlug === DISCOM_DEPARTMENT_SLUG &&
    (isDepartmentManager(user) || DISCOM_LEAD_ROLE_NAMES.includes(user.roleName))
  )
}

/**
 * DISCOM records are written by the department only; the CEO reads this module but
 * does not write to it, the same rule Tender/Sales/Technical/O&M enforce.
 */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== DISCOM_DEPARTMENT_SLUG) {
    throw new ServiceError('DISCOM records are read-only outside the department', 403)
  }
}

/**
 * The assignee must be an active member of DISCOM. RLS scopes rows to the org but
 * cannot cheaply express "belongs to the department that owns this table", so the
 * check lives here — and it turns an opaque RLS rejection into a clear 400.
 */
async function assertDiscomEmployee(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  user: SessionUser,
  employeeId: string
): Promise<void> {
  const { data } = await supabase
    .from('users')
    .select('id, is_active, departments(slug)')
    .eq('id', employeeId)
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  if (!data) throw new ServiceError('Employee not found in this organization', 400)
  if (!data.is_active) throw new ServiceError('Employee is not active', 400)

  const department = data.departments as unknown as { slug: string } | null
  if (department?.slug !== DISCOM_DEPARTMENT_SLUG) {
    throw new ServiceError('Employee is not a member of the DISCOM department', 400)
  }
}

/**
 * Loads a record the caller can see, letting RLS decide. A row outside the caller's
 * reach is simply not returned, surfacing as the same 404 as a row that does not
 * exist — not leaking the difference is intentional.
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

/**
 * Reads the completed installation a case is being originated from, deriving the
 * customer and org server-side rather than trusting the caller to name them — the
 * same guard convertDeal() applies in O&M. The installation must be visible to the
 * caller (RLS, via discom_read_installations in 0013) and 'completed': net metering
 * and subsidy work only begins once the site is finished, which is exactly what the
 * Pending Handoffs queue is built on.
 */
async function loadConvertibleInstallation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  installationId: string
): Promise<Pick<Installation, 'id' | 'customer_id' | 'organization_id' | 'status'>> {
  const install = await loadVisible<
    Pick<Installation, 'id' | 'customer_id' | 'organization_id' | 'status'>
  >(supabase, 'installations', installationId, 'id, customer_id, organization_id, status', 'Installation')

  if (install.status !== 'completed') {
    throw new ServiceError(
      'Net metering and subsidy work can only begin once the installation is completed',
      400
    )
  }
  return install
}

// ---------------------------------------------------------------------------
// Net metering applications
// ---------------------------------------------------------------------------

/**
 * Creates a net-metering application from a completed installation — the O&M →
 * DISCOM handoff, and the case whose staleness the module tracks. customer_id and
 * organization_id are derived from the installation server-side, so an application
 * cannot be attached to a different customer than the one being metered.
 *
 * No status-history row is written here: the case starts 'not_started', and
 * daysInCurrentStatus() counts from created_at until the first real transition, so
 * the aging clock is already running from the moment of creation.
 */
export async function createNetMetering(
  user: SessionUser,
  input: CreateNetMeteringInput
): Promise<NetMeteringApplication> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const install = await loadConvertibleInstallation(supabase, input.installation_id)
  await assertDiscomEmployee(supabase, user, input.assigned_to)

  const { data, error } = await supabase
    .from('net_metering_applications')
    .insert({
      organization_id: install.organization_id,
      installation_id: install.id,
      customer_id: install.customer_id,
      assigned_to: input.assigned_to,
      discom_name: input.discom_name ?? null,
      consumer_number: input.consumer_number ?? null,
      application_number: input.application_number ?? null,
      notes: input.notes ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    // 23505 is the unique(installation_id) constraint.
    if (error.code === '23505') {
      throw new ServiceError('This installation already has a net metering application', 409)
    }
    throw new ServiceError(error.message, 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'net_metering_created',
    entityType: 'net_metering_application',
    entityId: data.id,
    metadata: {
      installation_id: install.id,
      customer_id: install.customer_id,
      assigned_to: input.assigned_to,
    },
  })

  return data as NetMeteringApplication
}

/**
 * Updates an application's details — reassigning, recording the consumer/application
 * numbers, DISCOM name, dates or notes. Deliberately CANNOT change status: that
 * travels through changeNetMeteringStatus() so a *_status_history row is always
 * written. The validation schema omits status too; this is the server-side half of
 * that rule, rejecting a status field even if one is smuggled past the schema.
 */
export async function updateNetMetering(
  user: SessionUser,
  applicationId: string,
  input: UpdateNetMeteringInput
): Promise<NetMeteringApplication> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // Belt-and-braces: the schema already omits status, but a direct status edit must
  // never reach the update path — it would move the case without an aging record.
  if ('status' in (input as Record<string, unknown>)) {
    throw new ServiceError(
      'Status changes must go through the status endpoint so the history is recorded',
      400
    )
  }

  const existing = await loadVisible<Pick<NetMeteringApplication, 'id' | 'assigned_to'>>(
    supabase,
    'net_metering_applications',
    applicationId,
    'id, assigned_to',
    'Net metering application'
  )

  if (input.assigned_to && input.assigned_to !== existing.assigned_to) {
    await assertDiscomEmployee(supabase, user, input.assigned_to)
  }

  const { data, error } = await supabase
    .from('net_metering_applications')
    .update(input)
    .eq('id', applicationId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const reassigned = Boolean(input.assigned_to) && input.assigned_to !== existing.assigned_to

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: reassigned ? 'net_metering_reassigned' : 'net_metering_updated',
    entityType: 'net_metering_application',
    entityId: applicationId,
    metadata: {
      changed: Object.keys(input),
      ...(reassigned ? { from_assignee: existing.assigned_to, to_assignee: input.assigned_to } : {}),
    },
  })

  return data as NetMeteringApplication
}

/**
 * Moves an application to a new status AND records the transition in
 * net_metering_status_history, in that order — the history row is the point of this
 * endpoint. This is the ONLY way status changes; the ordinary update path refuses
 * it. The newest history row's created_at is what daysInCurrentStatus() counts
 * from, so every move resets the aging clock and the staleness board stays honest.
 *
 * There is no transition table: DISCOM status mirrors an external process the
 * liaison only observes (a board can bounce a case from 'under_review' back to
 * 'documents_pending'), so any status is reachable — see lib/discom/constants.ts.
 * A no-op (same status) is rejected rather than logged as a phantom transition.
 *
 * submitted_date / approved_date are stamped here when the matching status is
 * reached and no date was set before, so a submitted or approved case always
 * carries when it got there.
 */
export async function changeNetMeteringStatus(
  user: SessionUser,
  applicationId: string,
  input: NetMeteringStatusChangeInput
): Promise<NetMeteringApplication> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<
    Pick<NetMeteringApplication, 'id' | 'status' | 'submitted_date' | 'approved_date'>
  >(
    supabase,
    'net_metering_applications',
    applicationId,
    'id, status, submitted_date, approved_date',
    'Net metering application'
  )

  if (existing.status === input.status) {
    throw new ServiceError(`This application is already ${input.status}`, 400)
  }

  const today = new Date().toISOString().slice(0, 10)
  const dateStamp: Partial<NetMeteringApplication> = {}
  if (input.status === 'submitted' && !existing.submitted_date) dateStamp.submitted_date = today
  if (input.status === 'approved' && !existing.approved_date) dateStamp.approved_date = today

  const { data, error } = await supabase
    .from('net_metering_applications')
    .update({ status: input.status, ...dateStamp })
    .eq('id', applicationId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  // The history row is what the aging clock reads. If this insert fails the status
  // move above has already landed, so surface it loudly rather than silently
  // leaving a case whose clock cannot be computed.
  const { error: histErr } = await supabase.from('net_metering_status_history').insert({
    application_id: applicationId,
    updated_by: user.id,
    status: input.status,
    note: input.note ?? null,
  })

  if (histErr) throw new ServiceError(histErr.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'net_metering_status_changed',
    entityType: 'net_metering_application',
    entityId: applicationId,
    metadata: { from_status: existing.status, to_status: input.status },
  })

  return data as NetMeteringApplication
}

// ---------------------------------------------------------------------------
// Subsidy cases
// ---------------------------------------------------------------------------

export async function createSubsidy(
  user: SessionUser,
  input: CreateSubsidyInput
): Promise<SubsidyCase> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const install = await loadConvertibleInstallation(supabase, input.installation_id)
  await assertDiscomEmployee(supabase, user, input.assigned_to)

  const { data, error } = await supabase
    .from('subsidy_cases')
    .insert({
      organization_id: install.organization_id,
      installation_id: install.id,
      customer_id: install.customer_id,
      assigned_to: input.assigned_to,
      scheme: input.scheme ?? 'pm_surya_ghar',
      application_reference: input.application_reference ?? null,
      eligible_subsidy_amount: input.eligible_subsidy_amount ?? null,
      notes: input.notes ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    // 23505 is the unique(installation_id, scheme) constraint.
    if (error.code === '23505') {
      throw new ServiceError('This installation already has a subsidy case for that scheme', 409)
    }
    throw new ServiceError(error.message, 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'subsidy_created',
    entityType: 'subsidy_case',
    entityId: data.id,
    metadata: {
      installation_id: install.id,
      customer_id: install.customer_id,
      assigned_to: input.assigned_to,
      scheme: input.scheme ?? 'pm_surya_ghar',
    },
  })

  return data as SubsidyCase
}

/** Updates a subsidy case's details. Cannot change status — see updateNetMetering. */
export async function updateSubsidy(
  user: SessionUser,
  caseId: string,
  input: UpdateSubsidyInput
): Promise<SubsidyCase> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  if ('status' in (input as Record<string, unknown>)) {
    throw new ServiceError(
      'Status changes must go through the status endpoint so the history is recorded',
      400
    )
  }

  const existing = await loadVisible<Pick<SubsidyCase, 'id' | 'assigned_to'>>(
    supabase,
    'subsidy_cases',
    caseId,
    'id, assigned_to',
    'Subsidy case'
  )

  if (input.assigned_to && input.assigned_to !== existing.assigned_to) {
    await assertDiscomEmployee(supabase, user, input.assigned_to)
  }

  const { data, error } = await supabase
    .from('subsidy_cases')
    .update(input)
    .eq('id', caseId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const reassigned = Boolean(input.assigned_to) && input.assigned_to !== existing.assigned_to

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: reassigned ? 'subsidy_reassigned' : 'subsidy_updated',
    entityType: 'subsidy_case',
    entityId: caseId,
    metadata: {
      changed: Object.keys(input),
      ...(reassigned ? { from_assignee: existing.assigned_to, to_assignee: input.assigned_to } : {}),
    },
  })

  return data as SubsidyCase
}

/**
 * Moves a subsidy case to a new status and records it in subsidy_status_history —
 * the subsidy twin of changeNetMeteringStatus, same rules and same reasoning.
 * applied_date / disbursed_date are stamped when their status is reached; the
 * disbursed AMOUNT is a money field entered through the ordinary update path, not
 * inferred here.
 */
export async function changeSubsidyStatus(
  user: SessionUser,
  caseId: string,
  input: SubsidyStatusChangeInput
): Promise<SubsidyCase> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<
    Pick<SubsidyCase, 'id' | 'status' | 'applied_date' | 'disbursed_date'>
  >(
    supabase,
    'subsidy_cases',
    caseId,
    'id, status, applied_date, disbursed_date',
    'Subsidy case'
  )

  if (existing.status === input.status) {
    throw new ServiceError(`This subsidy case is already ${input.status}`, 400)
  }

  const today = new Date().toISOString().slice(0, 10)
  const dateStamp: Partial<SubsidyCase> = {}
  if (input.status === 'applied' && !existing.applied_date) dateStamp.applied_date = today
  if (input.status === 'disbursed' && !existing.disbursed_date) dateStamp.disbursed_date = today

  const { data, error } = await supabase
    .from('subsidy_cases')
    .update({ status: input.status, ...dateStamp })
    .eq('id', caseId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const { error: histErr } = await supabase.from('subsidy_status_history').insert({
    subsidy_case_id: caseId,
    updated_by: user.id,
    status: input.status,
    note: input.note ?? null,
  })

  if (histErr) throw new ServiceError(histErr.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'subsidy_status_changed',
    entityType: 'subsidy_case',
    entityId: caseId,
    metadata: { from_status: existing.status, to_status: input.status },
  })

  return data as SubsidyCase
}

// ---------------------------------------------------------------------------
// Government documents
// ---------------------------------------------------------------------------

/**
 * Records an already-uploaded government document. The browser uploads straight to
 * the private discom-documents bucket, then calls this so the row exists and the
 * upload is audited. organization_id is stamped from the session, and the file must
 * live under the caller's org folder — otherwise a signed URL minted from it later
 * would hand out another org's document.
 *
 * At least one parent link (installation / net-metering application / subsidy case)
 * must be present; the DB check enforces the same. When a case link is given, RLS
 * requires the caller to own that case, so a liaison cannot attach a document to a
 * colleague's application.
 */
export async function addGovernmentDocument(
  user: SessionUser,
  input: CreateGovernmentDocumentInput
): Promise<GovernmentDocument> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  if (!input.file_path.startsWith(`${user.organization_id}/`)) {
    throw new ServiceError('File path does not belong to this organization', 400)
  }

  const { data, error } = await supabase
    .from('government_documents')
    .insert({
      organization_id: user.organization_id,
      installation_id: input.installation_id ?? null,
      net_metering_application_id: input.net_metering_application_id ?? null,
      subsidy_case_id: input.subsidy_case_id ?? null,
      document_type: input.document_type,
      file_path: input.file_path,
      file_name: input.file_name,
      uploaded_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'government_document_uploaded',
    entityType: 'government_document',
    entityId: data.id,
    metadata: {
      document_type: input.document_type,
      file_name: input.file_name,
      net_metering_application_id: input.net_metering_application_id ?? null,
      subsidy_case_id: input.subsidy_case_id ?? null,
    },
  })

  return data as GovernmentDocument
}

/**
 * Mints a short-lived signed URL for one document. These are personal documents —
 * consumer ID proofs, bank passbooks — so per the security blueprint every read is
 * logged as sensitive access, even the CEO's, not just writes. The row is loaded
 * under RLS first, so a document the caller cannot see is a 404 and no URL is minted.
 */
export async function signDocumentDownload(
  user: SessionUser,
  documentId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const doc = await loadVisible<
    Pick<GovernmentDocument, 'id' | 'file_path' | 'file_name' | 'document_type'>
  >(
    supabase,
    'government_documents',
    documentId,
    'id, file_path, file_name, document_type',
    'Document'
  )

  const { data, error } = await supabase.storage
    .from(DISCOM_DOCUMENTS_BUCKET)
    .createSignedUrl(doc.file_path, SIGNED_URL_TTL_SECONDS, { download: doc.file_name })

  if (error || !data) throw new ServiceError(error?.message ?? 'Could not sign the file', 400)

  await logSensitiveAccess(user.organization_id, user.id, 'government_document', doc.id, {
    document_type: doc.document_type,
    file_name: doc.file_name,
  })

  return { url: data.signedUrl, fileName: doc.file_name }
}

/**
 * Removes a document row. The stored object is left in the bucket — orphaned objects
 * are swept separately, and a hard storage delete here would race the audit write.
 * RLS decides whether the caller may delete this row at all.
 */
export async function deleteGovernmentDocument(
  user: SessionUser,
  documentId: string
): Promise<void> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const doc = await loadVisible<Pick<GovernmentDocument, 'id' | 'file_name'>>(
    supabase,
    'government_documents',
    documentId,
    'id, file_name',
    'Document'
  )

  const { error } = await supabase.from('government_documents').delete().eq('id', documentId)
  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'government_document_deleted',
    entityType: 'government_document',
    entityId: documentId,
    metadata: { file_name: doc.file_name },
  })
}

// ---------------------------------------------------------------------------
// Consumer verification
// ---------------------------------------------------------------------------

/**
 * Records a consumer-verification check against a completed installation. verified_by
 * is the session user — a verification is a statement by the person who made it, so
 * it is authored in their name, never assigned. customer_id is derived from the
 * installation server-side, matching the case-creation flows.
 */
export async function createConsumerVerification(
  user: SessionUser,
  input: CreateConsumerVerificationInput
): Promise<ConsumerVerification> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const install = await loadConvertibleInstallation(supabase, input.installation_id)

  const { data, error } = await supabase
    .from('consumer_verifications')
    .insert({
      installation_id: install.id,
      customer_id: install.customer_id,
      verified_by: user.id,
      consumer_number_verified: input.consumer_number_verified,
      identity_verified: input.identity_verified,
      address_verified: input.address_verified,
      notes: input.notes ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'consumer_verification_recorded',
    entityType: 'consumer_verification',
    entityId: data.id,
    metadata: {
      installation_id: install.id,
      consumer_number_verified: input.consumer_number_verified,
      identity_verified: input.identity_verified,
      address_verified: input.address_verified,
    },
  })

  return data as ConsumerVerification
}
