import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import type { SessionUser } from '@/lib/auth/guards'
import type { Application } from '@/lib/types'
import type {
  SubmitApplicationInput,
  UpdateApplicationStatusInput,
} from '@/lib/validation/schemas'

export { ServiceError }

/** An application row joined with its author's display name, for the HR/CEO inboxes. */
export interface ApplicationWithEmployee extends Application {
  employee: { full_name: string } | null
}

/**
 * The caller's own employees.id, or null. Every self-service write derives this from the
 * session rather than trusting a client-supplied id — an employee only ever files for
 * themselves. Mirrors ownEmployeeId() in lib/services/hr.ts (kept local to avoid coupling
 * the applications feature to the HR service's private helpers).
 */
async function ownEmployeeId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  user: SessionUser
): Promise<string | null> {
  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Files a free-text application for the signed-in employee, addressed to HR, the CEO, or
 * both. Open to every active user — the employee_id is derived here from the caller, never
 * the body, and RLS admits the insert only as the author's own 'submitted' row.
 */
export async function submitApplication(
  user: SessionUser,
  input: SubmitApplicationInput
): Promise<{ applicationId: string }> {
  const supabase = await createSupabaseServerClient()
  const employeeId = await ownEmployeeId(supabase, user)
  if (!employeeId) throw new ServiceError('No employee record for your account', 400)

  const { data, error } = await supabase
    .from('applications')
    .insert({
      employee_id: employeeId,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
      status: 'submitted',
    })
    .select('id')
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'application_submitted',
    entityType: 'application',
    entityId: data.id,
    metadata: { recipient: input.recipient, subject: input.subject },
  })

  return { applicationId: data.id }
}

/** The signed-in employee's own applications, newest first. Backed by RLS self-view. */
export async function listOwnApplications(user: SessionUser): Promise<Application[]> {
  const supabase = await createSupabaseServerClient()
  const employeeId = await ownEmployeeId(supabase, user)
  if (!employeeId) return []

  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) throw new ServiceError(error.message, 400)
  return (data ?? []) as Application[]
}

/**
 * The inbox for a recipient side. RLS already limits what the caller can read (HR sees
 * hr/both, CEO sees ceo/both), and the explicit recipient filter keeps the query aligned
 * with that so the result never depends on RLS alone. Joins the author's name for display.
 */
async function listApplicationsFor(
  recipients: readonly string[]
): Promise<ApplicationWithEmployee[]> {
  const supabase = await createSupabaseServerClient()
  // full_name lives on users, reached via employees.user_id — mirrors getLeaveQueue().
  const { data, error } = await supabase
    .from('applications')
    .select(
      '*, employee:employees!applications_employee_id_fkey(users!employees_user_id_fkey!inner(full_name))'
    )
    .in('recipient', recipients)
    .order('created_at', { ascending: false })

  if (error) throw new ServiceError(error.message, 400)

  return (data ?? []).map((row) => {
    const emp = row.employee as unknown as { users: { full_name: string } | null } | null
    return {
      ...(row as unknown as Application),
      employee: emp?.users ? { full_name: emp.users.full_name } : null,
    }
  })
}

/** Applications addressed to HR (recipient 'hr' or 'both'). */
export function listApplicationsForHr(): Promise<ApplicationWithEmployee[]> {
  return listApplicationsFor(['hr', 'both'])
}

/** Applications addressed to the CEO (recipient 'ceo' or 'both'). */
export function listApplicationsForCeo(): Promise<ApplicationWithEmployee[]> {
  return listApplicationsFor(['ceo', 'both'])
}

/**
 * The addressed side advances an application's lifecycle (submitted → acknowledged →
 * closed). Only the status changes; RLS confirms the caller is HR/CEO on the addressed
 * side (a would-be edit of an application not addressed to them updates zero rows). We
 * stamp who handled it and when for the audit trail.
 */
export async function updateApplicationStatus(
  user: SessionUser,
  applicationId: string,
  input: UpdateApplicationStatusInput
): Promise<Application> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('applications')
    .update({
      status: input.status,
      handled_by: user.id,
      handled_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .select()
    .maybeSingle()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('Application not found', 404)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'application_status_changed',
    entityType: 'application',
    entityId: applicationId,
    metadata: { status: input.status },
  })

  return data as Application
}
