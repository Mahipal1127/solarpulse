import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction, logSensitiveAccess } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { assertTransition } from '@/lib/services/transitions'
import type { SessionUser } from '@/lib/auth/guards'
import {
  SURVEY_TRANSITIONS,
  DESIGN_TRANSITIONS,
  IT_TICKET_TRANSITIONS,
  SURVEY_MEDIA_BUCKET,
  DESIGN_FILES_BUCKET,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/technical/constants'
import type {
  CreateSurveyInput,
  ConvertVisitRequestInput,
  UpdateSurveyInput,
  SurveyPhotoMetaInput,
  ElectricityBillInput,
  CreateDesignInput,
  UpdateDesignInput,
  DesignFileInput,
  CreateGenerationReportInput,
  CreateITTicketInput,
  UpdateITTicketInput,
} from '@/lib/validation/schemas'
import type {
  SiteSurvey,
  SurveyStatus,
  SurveyPhoto,
  Design,
  DesignStatus,
  GenerationReport,
  ITSupportTicket,
  ITTicketStatus,
} from '@/lib/types'

export { ServiceError }

/** Re-exported so a route can tell the caller how long its signed URL lasts. */
export { SIGNED_URL_TTL_SECONDS }

export const TECHNICAL_DEPARTMENT_SLUG = 'technical'

/**
 * The department-wide tier, matching auth_is_technical_lead() in migration 0008.
 *
 * Both names are accepted for the reason spelled out in that migration: the build
 * spec called this role "Technical Lead", but the '<Department> Manager' convention
 * that auth_is_department_manager() and isDepartmentManager() key off requires the
 * seeded role to be "Technical Manager". The guard has to agree with the policy, so
 * it honours either.
 */
export const TECHNICAL_LEAD_ROLE_NAMES = ['Technical Manager', 'Technical Lead']

export function isTechnicalLead(user: SessionUser): boolean {
  return (
    user.departmentSlug === TECHNICAL_DEPARTMENT_SLUG &&
    TECHNICAL_LEAD_ROLE_NAMES.includes(user.roleName)
  )
}

/**
 * Status text for API error messages. Local to this file rather than imported from
 * lib/format.ts on purpose: rewording a badge in the UI should not change what an
 * endpoint says.
 */
const SURVEY_STATUS_TEXT: Record<SurveyStatus, string> = {
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const DESIGN_STATUS_TEXT: Record<DesignStatus, string> = {
  draft: 'Draft',
  under_review: 'Under Review',
  approved: 'Approved',
  sent_to_sales: 'Sent to Sales',
}

const IT_TICKET_STATUS_TEXT: Record<ITTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

/**
 * Surveys, designs and generation reports are Technical's to write. The CEO reads
 * this module but does not write to it, the same rule the Tender, Sales and
 * Distribution services enforce.
 *
 * Deliberately NOT applied to it_support_tickets: those are raised by every other
 * department by design, which is this module's headline exception. See
 * createITTicket().
 */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== TECHNICAL_DEPARTMENT_SLUG) {
    throw new ServiceError('Technical records are read-only outside the department', 403)
  }
}

/**
 * Who a survey may be assigned to.
 *
 * A lead assigns work to anyone in the department; an engineer may only hold their
 * own. This mirrors the engineer_own_surveys policy, whose with-check requires
 * assigned_engineer_id = auth.uid() — without this the caller would get an opaque
 * "new row violates row-level security policy" instead of being told that handing
 * work to a colleague is the lead's call.
 */
function assertCanAssignTo(user: SessionUser, engineerId: string): void {
  if (isTechnicalLead(user)) return
  if (engineerId === user.id) return
  throw new ServiceError(
    'Only the Technical lead can assign a survey to another engineer',
    403
  )
}

/**
 * Loads a record the caller can see, letting RLS decide. A row outside the
 * caller's reach simply is not returned, which surfaces as the same 404 as a row
 * that does not exist — not leaking the difference is intentional.
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
// Site surveys
// ---------------------------------------------------------------------------

/**
 * Logs a survey directly, with no Sales request behind it. Use
 * convertVisitRequest() for the handoff case — it is the one that also marks the
 * source request scheduled, atomically.
 */
export async function createSurvey(
  user: SessionUser,
  input: CreateSurveyInput
): Promise<SiteSurvey> {
  assertCanWrite(user)
  assertCanAssignTo(user, input.assigned_engineer_id)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('site_surveys')
    .insert({
      organization_id: user.organization_id,
      site_visit_request_id: input.site_visit_request_id ?? null,
      lead_id: input.lead_id ?? null,
      assigned_engineer_id: input.assigned_engineer_id,
      scheduled_date: input.scheduled_date ?? null,
      notes: input.notes ?? null,
      is_drone_survey: input.is_drone_survey,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'site_survey_created',
    entityType: 'site_survey',
    entityId: data.id,
    metadata: {
      assigned_engineer_id: input.assigned_engineer_id,
      lead_id: input.lead_id ?? null,
      standalone: !input.site_visit_request_id,
      is_drone_survey: input.is_drone_survey,
    },
  })

  return data as SiteSurvey
}

/**
 * Converts Sales' site visit request into a survey — the handoff §3.2 calls the
 * module's central flow.
 *
 * One RPC, not a create-then-update pair: create_survey_from_visit_request()
 * inserts the survey and sets the request to 'scheduled' in a single transaction.
 * Split across two calls, a failure between them leaves either a survey Sales never
 * sees acknowledged, or a request marked scheduled with no survey behind it.
 *
 * The lead is read from the request server-side rather than accepted from the
 * caller, so a survey cannot be quietly attached to a different customer's project.
 */
export async function convertVisitRequest(
  user: SessionUser,
  input: ConvertVisitRequestInput
): Promise<SiteSurvey> {
  assertCanWrite(user)
  assertCanAssignTo(user, input.assigned_engineer_id)
  const supabase = await createSupabaseServerClient()

  const { data: surveyId, error } = await supabase.rpc('create_survey_from_visit_request', {
    p_request_id: input.site_visit_request_id,
    p_assigned_engineer_id: input.assigned_engineer_id,
    p_scheduled_date: input.scheduled_date ?? null,
    p_notes: input.notes ?? null,
  })

  if (error) {
    // Messages from inside the function are caller-facing: "Site visit request not
    // found or not visible", "This site visit request is already scheduled".
    // 23505 is the unique constraint on site_visit_request_id — two engineers
    // converting the same request at once, where the loser should be told plainly.
    if (error.code === '23505') {
      throw new ServiceError('A survey has already been created for this request', 409)
    }
    throw new ServiceError(error.message, 400)
  }

  const survey = await loadVisible<SiteSurvey>(
    supabase,
    'site_surveys',
    surveyId as string,
    '*',
    'Survey'
  )

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'site_survey_created_from_request',
    entityType: 'site_survey',
    entityId: survey.id,
    metadata: {
      site_visit_request_id: input.site_visit_request_id,
      lead_id: survey.lead_id,
      assigned_engineer_id: input.assigned_engineer_id,
      // Recorded because this write crosses into a Sales table, which is worth
      // being able to find in the audit trail later.
      source_request_marked: 'scheduled',
    },
  })

  return survey
}

export async function updateSurvey(
  user: SessionUser,
  surveyId: string,
  input: UpdateSurveyInput
): Promise<SiteSurvey> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<
    Pick<SiteSurvey, 'id' | 'status' | 'assigned_engineer_id' | 'lead_id' | 'scheduled_date'>
  >(
    supabase,
    'site_surveys',
    surveyId,
    'id, status, assigned_engineer_id, lead_id, scheduled_date',
    'Survey'
  )

  if (input.status) {
    assertTransition(SURVEY_TRANSITIONS, existing.status, input.status, SURVEY_STATUS_TEXT)
  }

  // Reassignment is the lead's call, checked here so the caller gets a reason
  // rather than an RLS rejection.
  if (
    input.assigned_engineer_id &&
    input.assigned_engineer_id !== existing.assigned_engineer_id
  ) {
    assertCanAssignTo(user, input.assigned_engineer_id)
  }

  const { data, error } = await supabase
    .from('site_surveys')
    .update(input)
    .eq('id', surveyId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const reassigned =
    Boolean(input.assigned_engineer_id) &&
    input.assigned_engineer_id !== existing.assigned_engineer_id

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: reassigned
      ? 'site_survey_reassigned'
      : input.status
        ? 'site_survey_status_changed'
        : 'site_survey_updated',
    entityType: 'site_survey',
    entityId: surveyId,
    metadata: {
      changed: Object.keys(input),
      ...(input.status ? { from_status: existing.status, to_status: input.status } : {}),
      ...(reassigned
        ? {
            from_engineer: existing.assigned_engineer_id,
            to_engineer: input.assigned_engineer_id,
          }
        : {}),
      // Whether a location was recorded, never the coordinates themselves — those
      // pinpoint a customer's home and the audit log is read by the whole C-suite.
      ...(input.gps_latitude !== undefined
        ? { gps_recorded: input.gps_latitude !== null }
        : {}),
    },
  })

  return data as SiteSurvey
}

/**
 * Records an uploaded photo's metadata. The file itself goes to the private
 * survey-media bucket from the route handler; this row is what makes it findable.
 */
export async function addSurveyPhoto(
  user: SessionUser,
  surveyId: string,
  input: SurveyPhotoMetaInput
): Promise<SurveyPhoto> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // Confirms the survey is visible to this caller before attaching anything to it.
  await loadVisible<Pick<SiteSurvey, 'id'>>(
    supabase,
    'site_surveys',
    surveyId,
    'id',
    'Survey'
  )

  const { data, error } = await supabase
    .from('survey_photos')
    .insert({
      survey_id: surveyId,
      file_path: input.file_path,
      file_name: input.file_name,
      photo_type: input.photo_type ?? null,
      uploaded_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'survey_photo_uploaded',
    entityType: 'survey_photo',
    entityId: data.id,
    metadata: { survey_id: surveyId, photo_type: input.photo_type ?? null },
  })

  return data as SurveyPhoto
}

/**
 * Attaches the customer's electricity bill and, optionally, the monthly average
 * read off it. Two fields on the survey rather than a table of its own — there is
 * one bill per survey.
 */
export async function setElectricityBill(
  user: SessionUser,
  surveyId: string,
  input: ElectricityBillInput
): Promise<SiteSurvey> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<SiteSurvey, 'id'>>(supabase, 'site_surveys', surveyId, 'id', 'Survey')

  const { data, error } = await supabase
    .from('site_surveys')
    .update({
      electricity_bill_file_path: input.file_path,
      ...(input.avg_units !== undefined && input.avg_units !== null
        ? { electricity_bill_avg_units: input.avg_units }
        : {}),
    })
    .eq('id', surveyId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'electricity_bill_uploaded',
    entityType: 'site_survey',
    entityId: surveyId,
    // The path, not the contents: a bill is a customer document.
    metadata: { avg_units_recorded: input.avg_units != null },
  })

  return data as SiteSurvey
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

/**
 * Creates a design against a completed survey.
 *
 * The survey must be complete: a design drawn from measurements still being taken
 * rests on numbers that may change. This is a rule the database does not express —
 * no trigger enforces it — so it lives here, and the UI only offers the button on a
 * completed survey.
 */
export async function createDesign(
  user: SessionUser,
  surveyId: string,
  input: CreateDesignInput
): Promise<Design> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const survey = await loadVisible<Pick<SiteSurvey, 'id' | 'status'>>(
    supabase,
    'site_surveys',
    surveyId,
    'id, status',
    'Survey'
  )

  if (survey.status !== 'completed') {
    throw new ServiceError(
      `A design needs a completed survey behind it — this one is ${SURVEY_STATUS_TEXT[survey.status]}`,
      400
    )
  }

  const { data, error } = await supabase
    .from('designs')
    .insert({
      survey_id: surveyId,
      // From the session, not the request body: authorship is not the caller's to
      // assign, and engineer_own_designs keys its write check off this column.
      designed_by: user.id,
      system_size_kw: input.system_size_kw ?? null,
      panel_count: input.panel_count ?? null,
      panel_wattage: input.panel_wattage ?? null,
      inverter_spec: input.inverter_spec ?? null,
      boq_data: input.boq_data ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'design_created',
    entityType: 'design',
    entityId: data.id,
    metadata: {
      survey_id: surveyId,
      system_size_kw: input.system_size_kw ?? null,
      boq_line_count: input.boq_data?.length ?? 0,
    },
  })

  return data as Design
}

export async function updateDesign(
  user: SessionUser,
  designId: string,
  input: UpdateDesignInput
): Promise<Design> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<Design, 'id' | 'status' | 'survey_id'>>(
    supabase,
    'designs',
    designId,
    'id, status, survey_id',
    'Design'
  )

  if (input.status) {
    assertTransition(DESIGN_TRANSITIONS, existing.status, input.status, DESIGN_STATUS_TEXT)
  }

  /**
   * Once a design has gone to Sales its figures are frozen. A quotation may already
   * rest on them, and silently revising the numbers underneath it would leave Sales
   * quoting a system that no longer exists. DESIGN_TRANSITIONS makes 'sent_to_sales'
   * terminal for the same reason; this covers the field edits it cannot.
   */
  if (existing.status === 'sent_to_sales') {
    throw new ServiceError(
      'This design has been sent to Sales and can no longer be edited. Create a revision instead.',
      400
    )
  }

  const { data, error } = await supabase
    .from('designs')
    .update(input)
    .eq('id', designId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: input.status ? 'design_status_changed' : 'design_updated',
    entityType: 'design',
    entityId: designId,
    metadata: {
      survey_id: existing.survey_id,
      changed: Object.keys(input),
      ...(input.status ? { from_status: existing.status, to_status: input.status } : {}),
    },
  })

  return data as Design
}

/**
 * Attaches the solar layout or the single line diagram. Both are uploaded
 * documents: this module records a design, it does not draw one.
 */
export async function setDesignFile(
  user: SessionUser,
  designId: string,
  input: DesignFileInput
): Promise<Design> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<Design, 'id' | 'status'>>(
    supabase,
    'designs',
    designId,
    'id, status',
    'Design'
  )

  if (existing.status === 'sent_to_sales') {
    throw new ServiceError(
      'This design has been sent to Sales and can no longer be edited. Create a revision instead.',
      400
    )
  }

  const column = input.kind === 'layout' ? 'layout_file_path' : 'sld_file_path'

  const { data, error } = await supabase
    .from('designs')
    .update({ [column]: input.file_path })
    .eq('id', designId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'design_file_uploaded',
    entityType: 'design',
    entityId: designId,
    metadata: { kind: input.kind },
  })

  return data as Design
}

// ---------------------------------------------------------------------------
// Generation reports
// ---------------------------------------------------------------------------

/**
 * Records generation figures for a design.
 *
 * Nothing here calculates them. Estimating solar yield is a real engineering
 * calculation involving irradiance data, shading geometry and system losses — this
 * system stores what an engineer produced in PVsyst or PVWatts rather than
 * simulating it badly and presenting the result as fact.
 */
export async function createGenerationReport(
  user: SessionUser,
  designId: string,
  input: CreateGenerationReportInput
): Promise<GenerationReport> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Design, 'id'>>(supabase, 'designs', designId, 'id', 'Design')

  const { data, error } = await supabase
    .from('generation_reports')
    .insert({
      design_id: designId,
      estimated_annual_generation_kwh: input.estimated_annual_generation_kwh ?? null,
      estimated_monthly_generation_kwh: input.estimated_monthly_generation_kwh ?? null,
      report_file_path: input.report_file_path ?? null,
      generated_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'generation_report_created',
    entityType: 'generation_report',
    entityId: data.id,
    metadata: {
      design_id: designId,
      annual_kwh: input.estimated_annual_generation_kwh ?? null,
      has_monthly_breakdown: input.estimated_monthly_generation_kwh != null,
      externally_generated: Boolean(input.report_file_path),
    },
  })

  return data as GenerationReport
}

// ---------------------------------------------------------------------------
// File downloads
//
// Both buckets are private, so a signed URL is the only way to read anything in
// them — there is no public path to fall back on. No assertCanWrite on any of
// these: the CEO reads this module, and storage RLS decides what a caller can
// reach regardless of what the row lookup returned.
//
// Every download is logged. Survey photos and electricity bills are customer
// property, and the security blueprint requires access to personal documents to be
// recorded even for the CEO.
// ---------------------------------------------------------------------------

/** Last path segment, used as the download filename where no column stores one. */
function fileNameFromPath(path: string): string {
  return path.split('/').pop() || 'download'
}

async function signBucketPath(
  bucket: string,
  path: string,
  downloadName: string
): Promise<string> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: downloadName })

  if (error || !data) {
    throw new ServiceError(error?.message ?? 'Could not sign the file', 400)
  }
  return data.signedUrl
}

export async function signSurveyPhotoDownload(
  user: SessionUser,
  photoId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const photo = await loadVisible<
    Pick<SurveyPhoto, 'id' | 'survey_id' | 'file_path' | 'file_name'>
  >(supabase, 'survey_photos', photoId, 'id, survey_id, file_path, file_name', 'Photo')

  const url = await signBucketPath(SURVEY_MEDIA_BUCKET, photo.file_path, photo.file_name)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'survey_photo_downloaded',
    entityType: 'survey_photo',
    entityId: photoId,
    metadata: { survey_id: photo.survey_id, file_name: photo.file_name },
  })

  return { url, fileName: photo.file_name }
}

/**
 * The customer's electricity bill. Logged as a sensitive access rather than a
 * routine one: it is a household's consumption history, not project paperwork.
 */
export async function signElectricityBillDownload(
  user: SessionUser,
  surveyId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const survey = await loadVisible<Pick<SiteSurvey, 'id' | 'electricity_bill_file_path'>>(
    supabase,
    'site_surveys',
    surveyId,
    'id, electricity_bill_file_path',
    'Survey'
  )

  if (!survey.electricity_bill_file_path) {
    throw new ServiceError('No electricity bill has been uploaded for this survey', 404)
  }

  const fileName = fileNameFromPath(survey.electricity_bill_file_path)
  const url = await signBucketPath(
    SURVEY_MEDIA_BUCKET,
    survey.electricity_bill_file_path,
    fileName
  )

  await logSensitiveAccess(user.organization_id, user.id, 'site_survey', surveyId, {
    document: 'electricity_bill',
  })

  return { url, fileName }
}

export async function signDesignFileDownload(
  user: SessionUser,
  designId: string,
  kind: 'layout' | 'sld'
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const design = await loadVisible<
    Pick<Design, 'id' | 'layout_file_path' | 'sld_file_path'>
  >(supabase, 'designs', designId, 'id, layout_file_path, sld_file_path', 'Design')

  const path = kind === 'layout' ? design.layout_file_path : design.sld_file_path
  if (!path) {
    throw new ServiceError(
      `No ${kind === 'layout' ? 'layout' : 'single line diagram'} has been uploaded for this design`,
      404
    )
  }

  const fileName = fileNameFromPath(path)
  const url = await signBucketPath(DESIGN_FILES_BUCKET, path, fileName)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'design_file_downloaded',
    entityType: 'design',
    entityId: designId,
    metadata: { kind, file_name: fileName },
  })

  return { url, fileName }
}

export async function signGenerationReportDownload(
  user: SessionUser,
  reportId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const report = await loadVisible<
    Pick<GenerationReport, 'id' | 'design_id' | 'report_file_path'>
  >(supabase, 'generation_reports', reportId, 'id, design_id, report_file_path', 'Report')

  if (!report.report_file_path) {
    throw new ServiceError('This report has no attached file', 404)
  }

  const fileName = fileNameFromPath(report.report_file_path)
  const url = await signBucketPath(DESIGN_FILES_BUCKET, report.report_file_path, fileName)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'generation_report_downloaded',
    entityType: 'generation_report',
    entityId: reportId,
    metadata: { design_id: report.design_id, file_name: fileName },
  })

  return { url, fileName }
}

// ---------------------------------------------------------------------------
// IT support
// ---------------------------------------------------------------------------

/**
 * Raises an IT support ticket. Deliberately NOT gated by assertCanWrite() — this is
 * the module's one deliberate exception to the department-scoped pattern.
 *
 * ERP problems are reported by Sales, Finance, HR and everyone else; a queue only
 * Technical could write to would be a queue nobody files into. The
 * org_member_raise_it_ticket policy permits the insert, and
 * raiser_read_own_it_ticket lets the reporter follow their own ticket without
 * seeing the rest of the queue.
 */
export async function createITTicket(
  user: SessionUser,
  input: CreateITTicketInput
): Promise<ITSupportTicket> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('it_support_tickets')
    .insert({
      organization_id: user.organization_id,
      raised_by: user.id,
      issue_type: input.issue_type ?? null,
      description: input.description,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'it_ticket_raised',
    entityType: 'it_support_ticket',
    entityId: data.id,
    metadata: {
      issue_type: input.issue_type ?? null,
      raised_by_department: user.departmentSlug,
    },
  })

  return data as ITSupportTicket
}

/**
 * Triages a ticket. Technical-only: raising one is open to the organization,
 * managing the queue is not.
 *
 * resolved_at is stamped server-side, and cleared if the ticket reopens — a
 * resolution date on an unresolved ticket would misreport how long the fix took.
 */
export async function updateITTicket(
  user: SessionUser,
  ticketId: string,
  input: UpdateITTicketInput
): Promise<ITSupportTicket> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<ITSupportTicket, 'id' | 'status' | 'issue_type'>>(
    supabase,
    'it_support_tickets',
    ticketId,
    'id, status, issue_type',
    'Ticket'
  )

  if (input.status) {
    assertTransition(
      IT_TICKET_TRANSITIONS,
      existing.status,
      input.status,
      IT_TICKET_STATUS_TEXT
    )
  }

  const resolving = input.status === 'resolved'
  const reopening = input.status === 'in_progress' && existing.status === 'resolved'

  const { data, error } = await supabase
    .from('it_support_tickets')
    .update({
      ...input,
      ...(resolving ? { resolved_at: new Date().toISOString() } : {}),
      ...(reopening ? { resolved_at: null } : {}),
    })
    .eq('id', ticketId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: reopening
      ? 'it_ticket_reopened'
      : resolving
        ? 'it_ticket_resolved'
        : 'it_ticket_updated',
    entityType: 'it_support_ticket',
    entityId: ticketId,
    metadata: {
      changed: Object.keys(input),
      ...(input.status ? { from_status: existing.status, to_status: input.status } : {}),
    },
  })

  return data as ITSupportTicket
}
