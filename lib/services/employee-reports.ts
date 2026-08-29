import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { REPORT_BUCKET, SIGNED_URL_TTL_SECONDS } from '@/lib/reports/constants'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateEmployeeReportInput,
  UpdateEmployeeReportInput,
} from '@/lib/validation/schemas'
import type { EmployeeReport, ReportPeriod } from '@/lib/types'

export { ServiceError }
export { REPORT_BUCKET }

/**
 * Employee report submissions — the service layer for 0019.
 *
 * WHO CAN DO WHAT is settled by RLS, not here. This layer exists for the three things
 * RLS cannot do: derive the fields the client must not supply, enforce the state machine
 * (a submitted report is final), and write the audit row.
 *
 * EVERY REPORT IS FILED AS THE SESSION USER. user_id, organization_id and department_id
 * are read off the session and never off the request body, so there is no shape of
 * payload that files a report under someone else's name — which matters more here than
 * usual, because the CEO reads these as "what this person said about their own work".
 *
 * SUBMITTED IS FINAL. Nothing in this file updates a report whose status is 'submitted',
 * and the update path refuses one explicitly. The CEO reports page promises "their words,
 * not edits made here"; the own-rows RLS policy is broad enough (for all) that only this
 * check keeps an author from quietly rewriting history after their lead read it.
 */

/**
 * The window a period covers, ending today (inclusive on both ends).
 *
 *   daily   → today only
 *   weekly  → the last 7 days including today
 *   monthly → the last 30 days including today
 *
 * Rolling windows, deliberately, not calendar ones: someone filing a weekly report on a
 * Wednesday means "the last week of my work", not "since Monday", and a monthly report
 * filed on the 3rd would otherwise cover three days. Both the AI facts collector and the
 * stored period_start/period_end use this one function, so the numbers in a report always
 * describe exactly the range printed on it.
 *
 * Dates are computed in UTC to match the DATE columns and the ISO slicing used elsewhere.
 */
export function periodRange(period: ReportPeriod, today = new Date()): {
  start: string
  end: string
} {
  const end = new Date(today)
  const start = new Date(today)
  const back = period === 'daily' ? 0 : period === 'weekly' ? 6 : 29
  start.setUTCDate(start.getUTCDate() - back)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export interface ReportAuthor {
  full_name: string
  email: string
  departments: { name: string } | null
}

export interface EmployeeReportWithAuthor extends EmployeeReport {
  users: ReportAuthor | null
}

/** The author's own reports, newest period first. Drafts included — they are theirs. */
export async function listOwnReports(user: SessionUser): Promise<EmployeeReport[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('employee_reports')
    .select('*')
    .eq('user_id', user.id)
    .order('period_start', { ascending: false })
    .order('created_at', { ascending: false })

  // A rejected query and an empty table both arrive as no rows, so the page would say
  // "no reports yet" either way and the real cause would stay invisible.
  if (error) console.error('[reports] own list failed', error.message, error.details ?? '')
  return (data ?? []) as EmployeeReport[]
}

/**
 * Submitted reports the caller is allowed to read, newest submission first.
 *
 * No role check here on purpose: this is the CEO's list and a department manager's list
 * at the same time, and which rows come back is decided by the two SELECT policies in
 * 0019. A regular employee calling this gets only their own submitted rows, which is
 * correct rather than a leak — but nothing in the app routes them here.
 */
export async function listSubmittedReports(
  user: SessionUser,
  filters: { departmentId?: string | null; userId?: string | null } = {}
): Promise<EmployeeReportWithAuthor[]> {
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('employee_reports')
    .select('*, users!employee_reports_user_id_fkey(full_name, email, departments(name))')
    .eq('organization_id', user.organization_id)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(300)

  if (filters.departmentId) query = query.eq('department_id', filters.departmentId)
  if (filters.userId) query = query.eq('user_id', filters.userId)

  const { data, error } = await query
  if (error) console.error('[reports] submitted list failed', error.message, error.details ?? '')
  return (data ?? []) as unknown as EmployeeReportWithAuthor[]
}

/**
 * Everyone who has ever SUBMITTED a report the caller can read, for the CEO's employee
 * picker. Name and department only.
 *
 * Built from the reports rather than from the roster on purpose. The dropdown then lists
 * exactly the people whose reports are readable — no name appears that would filter to an
 * empty list, and nobody's presence in the org is disclosed by a picker.
 *
 * Deriving it from the ALREADY-FILTERED list would collapse the dropdown to one name the
 * moment a person was picked, leaving no way back. So this runs its own unfiltered read.
 */
export async function listReportAuthors(
  user: SessionUser
): Promise<{ id: string; name: string; departmentId: string | null }[]> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('employee_reports')
    .select('user_id, department_id, users!employee_reports_user_id_fkey(full_name)')
    .eq('organization_id', user.organization_id)
    .eq('status', 'submitted')
    .limit(1000)

  if (error) console.error('[reports] author list failed', error.message, error.details ?? '')

  const seen = new Map<string, { id: string; name: string; departmentId: string | null }>()
  for (const row of (data ?? []) as unknown as {
    user_id: string
    department_id: string | null
    users: { full_name: string } | null
  }[]) {
    if (!row.users?.full_name || seen.has(row.user_id)) continue
    seen.set(row.user_id, {
      id: row.user_id,
      name: row.users.full_name,
      // The department they filed under, which is the one the department filter matches.
      departmentId: row.department_id,
    })
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Creates a report. Starts as a draft unless `submit` is asked for, so the two-step
 * "generate → review → submit" flow and a one-shot submission share this one path.
 */
export async function createEmployeeReport(
  user: SessionUser,
  input: CreateEmployeeReportInput,
  options: { submit?: boolean; aiGenerated?: boolean } = {}
): Promise<EmployeeReport> {
  assertNotEmpty(input.content, input.attachment_path)

  const supabase = await createSupabaseServerClient()
  const { start, end } = periodRange(input.period)
  const submitting = options.submit === true

  const { data, error } = await supabase
    .from('employee_reports')
    .insert({
      organization_id: user.organization_id,
      user_id: user.id,
      // Where they are NOW. Copied at write time so a later transfer does not move the
      // report; see the column comment in 0019.
      department_id: user.department_id ?? null,
      period: input.period,
      period_start: start,
      period_end: end,
      content: input.content ?? null,
      attachment_path: input.attachment_path ?? null,
      attachment_name: input.attachment_name ?? null,
      ai_generated: options.aiGenerated === true,
      status: submitting ? 'submitted' : 'draft',
      submitted_at: submitting ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new ServiceError(error?.message ?? 'Could not save the report', 400)
  }

  const report = data as EmployeeReport
  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: submitting ? 'employee_report.submitted' : 'employee_report.drafted',
    entityType: 'employee_report',
    entityId: report.id,
    // The report TEXT is deliberately not logged — it is already stored in the row, and
    // duplicating a personal account of someone's work into the audit trail would put it
    // somewhere the author's own RLS policy no longer governs.
    metadata: {
      period: report.period,
      period_start: report.period_start,
      period_end: report.period_end,
      ai_generated: report.ai_generated,
      has_attachment: report.attachment_path !== null,
    },
  })

  return report
}

/**
 * Edits a draft, and optionally submits it.
 *
 * Refuses outright once the report is submitted. RLS lets the author write their own
 * rows in any status — that breadth is what makes drafts work — so this check is the only
 * thing standing between "a record of what I reported" and "whatever I last felt like
 * saying". The 404-shaped message for a missing row avoids confirming that someone
 * else's report id exists.
 */
export async function updateEmployeeReport(
  user: SessionUser,
  reportId: string,
  input: UpdateEmployeeReportInput
): Promise<EmployeeReport> {
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('employee_reports')
    .select('*')
    .eq('id', reportId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Report not found', 404)
  const current = existing as EmployeeReport

  if (current.status === 'submitted') {
    throw new ServiceError('This report has already been submitted and cannot be changed', 409)
  }

  // Undefined means "leave it alone"; null means "clear it". Resolving both before the
  // empty check so submitting cannot slip an empty report through by clearing the text
  // in the same request.
  const nextContent = input.content === undefined ? current.content : input.content
  const nextPath =
    input.attachment_path === undefined ? current.attachment_path : input.attachment_path
  const nextName =
    input.attachment_name === undefined ? current.attachment_name : input.attachment_name

  const submitting = input.submit === true
  if (submitting) assertNotEmpty(nextContent, nextPath)

  const { data, error } = await supabase
    .from('employee_reports')
    .update({
      content: nextContent,
      attachment_path: nextPath,
      attachment_name: nextName,
      ...(submitting ? { status: 'submitted', submitted_at: new Date().toISOString() } : {}),
    })
    .eq('id', reportId)
    .select('*')
    .single()

  if (error || !data) {
    throw new ServiceError(error?.message ?? 'Could not update the report', 400)
  }

  const report = data as EmployeeReport
  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: submitting ? 'employee_report.submitted' : 'employee_report.updated',
    entityType: 'employee_report',
    entityId: report.id,
    metadata: {
      period: report.period,
      ai_generated: report.ai_generated,
      has_attachment: report.attachment_path !== null,
    },
  })

  return report
}

/**
 * Deletes a draft and its attachment. Submitted reports are not deletable by anyone —
 * the same reasoning as the update guard.
 */
export async function deleteDraftReport(user: SessionUser, reportId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('employee_reports')
    .select('id, status, attachment_path')
    .eq('id', reportId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Report not found', 404)
  if (existing.status === 'submitted') {
    throw new ServiceError('A submitted report cannot be deleted', 409)
  }

  const { error } = await supabase.from('employee_reports').delete().eq('id', reportId)
  if (error) throw new ServiceError(error.message, 400)

  // Best-effort: the row is already gone, and a stranded private object is a smaller
  // problem than failing the delete the caller has been told succeeded.
  if (existing.attachment_path) {
    await supabase.storage
      .from(REPORT_BUCKET)
      .remove([existing.attachment_path as string])
      .catch(() => {})
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'employee_report.draft_deleted',
    entityType: 'employee_report',
    entityId: reportId,
  })
}

/** The shared "a report must say something" rule. Mirrors the CHECK in 0019. */
function assertNotEmpty(content: string | null | undefined, path: string | null | undefined) {
  if (!content?.trim() && !path) {
    throw new ServiceError('Write something or attach a file — a report cannot be empty', 400)
  }
}

/**
 * Mints a short-lived download link for a report's attachment.
 *
 * The row is loaded under RLS FIRST, so a report the caller cannot see is a 404 and no
 * URL is ever minted — the same order the other private buckets use. That matters here
 * because a signed URL is a bearer token: checking after signing would hand out a
 * working link and then refuse the request.
 *
 * The storage policies would refuse a bad path independently, so this is two
 * independent gates rather than one; either alone would be sufficient, which is the
 * point.
 */
export async function signReportAttachment(
  user: SessionUser,
  reportId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const { data: report } = await supabase
    .from('employee_reports')
    .select('id, attachment_path, attachment_name')
    .eq('id', reportId)
    .maybeSingle()

  if (!report?.attachment_path) throw new ServiceError('No attachment on that report', 404)

  const fileName = (report.attachment_name as string | null) ?? 'report-attachment'
  const { data, error } = await supabase.storage
    .from(REPORT_BUCKET)
    .createSignedUrl(report.attachment_path as string, SIGNED_URL_TTL_SECONDS, {
      download: fileName,
    })

  if (error || !data) throw new ServiceError(error?.message ?? 'Could not sign the file', 400)

  // Logged as an access, not a mutation: the CEO and a lead reading someone's report
  // attachment is exactly the kind of read worth having a record of.
  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'employee_report.attachment_downloaded',
    entityType: 'employee_report',
    entityId: reportId,
    metadata: { file_name: fileName },
  })

  return { url: data.signedUrl, fileName }
}
