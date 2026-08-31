import 'server-only'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction, logSensitiveAccess } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { isDepartmentManager } from '@/lib/auth/guards'
import {
  HR_DOCUMENTS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  SENSITIVE_DOCUMENT_TYPES,
  MAX_UPLOAD_BYTES,
} from '@/lib/hr/constants'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateCandidateInput,
  UpdateCandidateInput,
  CreateInterviewInput,
  UpdateInterviewInput,
  CreateEmployeeInput,
  OnboardEmployeeInput,
  OnboardingDocumentInput,
  UpdateEmployeeInput,
  ProcessExitInput,
  CreateEmployeeDocumentInput,
  SubmitLeaveInput,
  CreateSalaryRecordInput,
  UpdateSalaryRecordInput,
  CreateKpiInput,
  UpdateKpiInput,
  CreateAppraisalInput,
} from '@/lib/validation/schemas'
import type {
  Employee,
  Candidate,
  Interview,
  EmployeeDocument,
  AttendanceRecord,
  LeaveRequest,
  SalaryRecord,
  PerformanceKpi,
  Appraisal,
  EmployeeDocumentType,
} from '@/lib/types'

export { ServiceError }

/** Re-exported so a route can tell the caller how long its signed URL lasts. */
export { SIGNED_URL_TTL_SECONDS }

/** The slug migration 0002 seeds the HR department under, and every RLS helper keys off. */
export const HR_DEPARTMENT_SLUG = 'hr'

/**
 * The HR-lead tier, matching auth_is_hr_lead() in migration 0015. Both names accepted
 * for the reason spelled out there: the '<Department> Manager' convention that
 * auth_is_department_manager() (0006) and isDepartmentManager() (guards.ts) key off
 * requires the seeded role to end in "Manager", so the seeded role is 'HR Manager'.
 * 'HR Lead' is honoured too for a hand-made role.
 */
export const HR_LEAD_ROLE_NAMES = ['HR Manager', 'HR Lead']

/** An active member of the HR department (any HR role). Mirrors auth_is_hr_member(). */
export function isHrMember(user: SessionUser): boolean {
  return user.departmentSlug === HR_DEPARTMENT_SLUG
}

/** The HR lead (or CEO-as-lead via the Manager convention). Mirrors auth_is_hr_lead(). */
export function isHrLead(user: SessionUser): boolean {
  return (
    user.departmentSlug === HR_DEPARTMENT_SLUG &&
    (isDepartmentManager(user) || HR_LEAD_ROLE_NAMES.includes(user.roleName))
  )
}

/** The CEO reads every module but the CEO role is 'CEO'. */
function isCeo(user: SessionUser): boolean {
  return user.roleName === 'CEO'
}

/**
 * The FOURTH, tighter tier — the whole reason this module exists as it does. Salary,
 * appraisal, and exit data may be READ for another employee, or WRITTEN at all, only by
 * the HR lead or the CEO. A regular HR Executive is deliberately excluded: a colleague's
 * pay is never theirs to see. Self-reads of one's OWN salary/appraisal go through a
 * separate ownership path (loadOwnSalary etc.), never this gate.
 *
 * This is intentionally NOT assertHrCanWrite — it is stricter, and the two must not be
 * collapsed. RLS in 0015 enforces the same split at the database; this turns a would-be
 * opaque RLS rejection into a clear 403 and keeps the reason auditable.
 */
function assertSensitiveAccess(user: SessionUser): void {
  if (!isHrLead(user) && !isCeo(user)) {
    throw new ServiceError('Only the HR lead or CEO may access compensation and appraisal data', 403)
  }
}

/**
 * Operational HR writes (recruitment, attendance marking, document filing) — any HR
 * member may perform these. The CEO reads this module but does not do HR's data entry,
 * matching every prior module's read-only-for-outsiders rule.
 */
function assertHrCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== HR_DEPARTMENT_SLUG) {
    throw new ServiceError('HR records are read-only outside the department', 403)
  }
}

/** Writes only the HR lead (or CEO) may perform, but which are not sensitive-tier reads. */
function assertHrLead(user: SessionUser): void {
  if (!isHrLead(user) && !isCeo(user)) {
    throw new ServiceError('Only the HR lead or CEO may perform this action', 403)
  }
}

/**
 * Loads a record the caller can see, letting RLS decide. A row outside the caller's
 * reach is not returned, surfacing as the same 404 as a row that does not exist — not
 * leaking the difference is intentional, and doubly so here where the difference could
 * itself be sensitive (whether a given employee has a salary row, say).
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
 * The caller's own employees.id, or null if they have no employee row. Every
 * self-service path (check-in, leave, my-payslips) resolves this rather than trusting a
 * client-supplied employee_id — an employee can only ever act on their own record.
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

/** Confirms an employee_id belongs to an active user in the caller's org. */
async function assertEmployeeInOrg(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  user: SessionUser,
  employeeId: string
): Promise<void> {
  const { data } = await supabase
    .from('employees')
    .select('id, users!employees_user_id_fkey!inner(organization_id)')
    .eq('id', employeeId)
    .maybeSingle()
  if (!data) throw new ServiceError('Employee not found in this organization', 400)
  const owner = data.users as unknown as { organization_id: string } | null
  if (owner?.organization_id !== user.organization_id) {
    throw new ServiceError('Employee not found in this organization', 400)
  }
}

// ===========================================================================
// Recruitment — candidates & interviews (standard three-tier: any HR member)
// ===========================================================================

export async function createCandidate(
  user: SessionUser,
  input: CreateCandidateInput
): Promise<Candidate> {
  assertHrCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('candidates')
    .insert({
      organization_id: user.organization_id,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email || null,
      applied_for_department_id: input.applied_for_department_id ?? null,
      applied_for_role: input.applied_for_role ?? null,
      source: input.source ?? null,
      status: input.status,
      added_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'candidate_created',
    entityType: 'candidate',
    entityId: data.id,
    metadata: { name: input.name, status: input.status },
  })

  return data as Candidate
}

export async function updateCandidate(
  user: SessionUser,
  candidateId: string,
  input: UpdateCandidateInput
): Promise<Candidate> {
  assertHrCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<{ id: string }>(supabase, 'candidates', candidateId, 'id', 'Candidate')

  const { data, error } = await supabase
    .from('candidates')
    .update(input)
    .eq('id', candidateId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'candidate_updated',
    entityType: 'candidate',
    entityId: candidateId,
    metadata: { changed: Object.keys(input) },
  })

  return data as Candidate
}

export async function createInterview(
  user: SessionUser,
  input: CreateInterviewInput
): Promise<Interview> {
  assertHrCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // The candidate must be visible to the caller (RLS) — you cannot schedule an
  // interview against a candidate you cannot see.
  await loadVisible<{ id: string }>(supabase, 'candidates', input.candidate_id, 'id', 'Candidate')

  const { data, error } = await supabase
    .from('interviews')
    .insert({
      candidate_id: input.candidate_id,
      scheduled_date: input.scheduled_date ?? null,
      interviewer_id: input.interviewer_id ?? null,
      round: input.round ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'interview_scheduled',
    entityType: 'interview',
    entityId: data.id,
    metadata: { candidate_id: input.candidate_id, round: input.round ?? null },
  })

  return data as Interview
}

export async function updateInterview(
  user: SessionUser,
  interviewId: string,
  input: UpdateInterviewInput
): Promise<Interview> {
  assertHrCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<{ id: string }>(supabase, 'interviews', interviewId, 'id', 'Interview')

  const { data, error } = await supabase
    .from('interviews')
    .update(input)
    .eq('id', interviewId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'interview_updated',
    entityType: 'interview',
    entityId: interviewId,
    metadata: { changed: Object.keys(input) },
  })

  return data as Interview
}

// ===========================================================================
// Employee management
// ===========================================================================

/**
 * Onboards a new employee: an auth login, the public.users row that binds it to the
 * org/department/role, and the employees personnel row — all together.
 *
 * Runs on the SERVICE-ROLE client behind an explicit HR-lead/CEO guard, for the same
 * reason process_employee_exit() is security definer: creating an auth account and a
 * users row is a privileged action the users-table RLS keeps to the CEO, and widening
 * that RLS would leak across every module. The guard here IS the access control; the
 * service client is used only after it passes.
 *
 * Best-effort atomicity: if the users/employees insert fails, the just-created auth
 * user is deleted so a half-provisioned login cannot linger. (supabase-js has no
 * cross-table transaction from the client; the two inserts are ordered so the cheaper-
 * to-unwind step — the auth user — is created first.)
 */
export async function hireEmployee(
  user: SessionUser,
  input: CreateEmployeeInput
): Promise<Employee> {
  assertHrLead(user)
  const service = createSupabaseServiceClient()

  // The role must exist in this org and belong to a department (so the new hire lands
  // somewhere). Read with the service client — roles has no broad SELECT policy.
  const { data: role } = await service
    .from('roles')
    .select('id, organization_id, department_id')
    .eq('id', input.role_id)
    .eq('organization_id', user.organization_id)
    .maybeSingle()
  if (!role) throw new ServiceError('Role not found in this organization', 400)
  if (!role.department_id) {
    throw new ServiceError('Cannot onboard into a role with no department', 400)
  }

  // Create the auth login. HR assigns the password in the onboarding form and hands it
  // to the employee; when none is supplied we generate one nobody ever sees, leaving the
  // account reachable only through a password reset. Either way the value goes straight
  // to Supabase auth — we never store it, and it never reaches the audit log below.
  const password = input.password ?? `Sp!${crypto.randomUUID()}`
  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  })
  if (authError || !created?.user) {
    throw new ServiceError(authError?.message ?? 'Could not create the login', 400)
  }
  const authId = created.user.id

  // From here, unwind the auth user if anything fails.
  try {
    const { error: userError } = await service.from('users').insert({
      id: authId,
      organization_id: user.organization_id,
      department_id: role.department_id,
      role_id: input.role_id,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone ?? null,
      is_active: true,
    })
    if (userError) throw new ServiceError(userError.message, 400)

    const { data: employee, error: empError } = await service
      .from('employees')
      .insert({
        user_id: authId,
        designation: input.designation ?? null,
        employee_code: input.employee_code ?? null,
        date_joined: input.date_joined ?? null,
        reporting_to: input.reporting_to ?? null,
        phone: input.phone ?? null,
        emergency_contact: input.emergency_contact ?? null,
        employment_status: 'active',
      })
      .select()
      .single()
    if (empError) throw new ServiceError(empError.message, 400)

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'employee_onboarded',
      entityType: 'employee',
      entityId: employee.id,
      metadata: { new_user_id: authId, role_id: input.role_id, email: input.email },
    })

    return employee as Employee
  } catch (err) {
    // Roll back the orphaned login so a failed onboard leaves no ghost account. Delete
    // the users row first (if the employees insert was what failed), then the auth user;
    // both are best-effort and must not mask the original error.
    try {
      await service.from('users').delete().eq('id', authId)
    } catch {
      /* best-effort cleanup */
    }
    try {
      await service.auth.admin.deleteUser(authId)
    } catch {
      /* best-effort cleanup */
    }
    throw err
  }
}

/**
 * The onboarding-wizard flow: everything hireEmployee does, plus a WhatsApp number, an optional
 * profile photo, and the must_change_password flag — the provisioning half of the feature.
 *
 * TRANSACTION BOUNDARY. A Supabase auth user cannot be created inside a Postgres transaction, so
 * "one transaction" is really "provision, and unwind the orphan if the DB half fails" — the same
 * best-effort atomicity hireEmployee documents, and the guarantee the acceptance criterion names:
 * a failed onboard leaves NO ghost login. The auth user is created first (cheapest to unwind), the
 * users + employees rows next; any failure through the employees insert deletes both.
 *
 * The photo is uploaded AFTER the employee row exists (its storage path is '{employee_id}/...',
 * which needs the id) and is BEST-EFFORT: a failed photo upload does not roll back a provisioned
 * employee — the card simply renders an initials tile until HR adds one. must_change_password is
 * left at its DB default (true) but set explicitly here so the intent is legible at the call site.
 *
 * The QR token and card IMAGE are deliberately NOT minted here — the route calls
 * generateAndStoreCard after this returns. Two reasons: it keeps card rendering (which pulls in
 * next/og) out of this service and breaks an import cycle, and a card that fails to render is
 * independently regenerable, whereas an orphaned auth login is not. collectCardData mints the
 * token lazily on first render, so nothing is lost.
 */
export async function onboardEmployee(
  user: SessionUser,
  input: OnboardEmployeeInput
): Promise<Employee> {
  assertHrLead(user)
  const service = createSupabaseServiceClient()

  const { data: role } = await service
    .from('roles')
    .select('id, organization_id, department_id')
    .eq('id', input.role_id)
    .eq('organization_id', user.organization_id)
    .maybeSingle()
  if (!role) throw new ServiceError('Role not found in this organization', 400)
  if (!role.department_id) {
    throw new ServiceError('Cannot onboard into a role with no department', 400)
  }

  // HR-assigned password, or a generated one nobody sees when HR left it blank. Never stored here;
  // must_change_password below still forces a reset on first sign-in.
  const password = input.password ?? `Sp!${crypto.randomUUID()}`
  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  })
  if (authError || !created?.user) {
    throw new ServiceError(authError?.message ?? 'Could not create the login', 400)
  }
  const authId = created.user.id

  try {
    const { error: userError } = await service.from('users').insert({
      id: authId,
      organization_id: user.organization_id,
      department_id: role.department_id,
      role_id: input.role_id,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone ?? null,
      is_active: true,
    })
    if (userError) throw new ServiceError(userError.message, 400)

    const { data: employee, error: empError } = await service
      .from('employees')
      .insert({
        user_id: authId,
        designation: input.designation ?? null,
        employee_code: input.employee_code ?? null,
        date_joined: input.date_joined ?? null,
        reporting_to: input.reporting_to ?? null,
        phone: input.phone ?? null,
        emergency_contact: input.emergency_contact ?? null,
        employment_status: 'active',
        whatsapp_number: input.whatsapp_number ?? null,
        must_change_password: true,
      })
      .select()
      .single()
    if (empError) throw new ServiceError(empError.message, 400)

    // Best-effort photo upload, now that the employee id (and its storage folder) exists.
    let photoPath: string | null = null
    if (input.profile_photo) {
      photoPath = await uploadProfilePhoto(service, employee.id, input.profile_photo)
      if (photoPath) {
        await service
          .from('employees')
          .update({ profile_photo_path: photoPath })
          .eq('id', employee.id)
      }
    }

    // Best-effort document uploads, same reasoning as the photo — the id (and its storage
    // folder) exist now. The onboarding caller is already the HR lead / CEO (assertHrLead
    // above), which is the tier allowed to file even sensitive documents, so no extra gate
    // is needed here. A single failed document never rolls back a provisioned employee; HR
    // can add or retry from the profile board.
    let documentsStored = 0
    for (const doc of input.documents ?? []) {
      const stored = await storeOnboardingDocument(service, employee.id, user.id, doc)
      if (stored) documentsStored += 1
    }

    // Optional starting salary. If the HR lead entered one, create the employee's first
    // salary_records row so pay is captured at hire time rather than re-entered later, and hand
    // Finance a task to set up the disbursement. Both are BEST-EFFORT for the same reason as the
    // photo/documents above: a transient failure here must not ghost an already-provisioned login —
    // HR can set salary from the payroll page and re-notify. See onboardStartingSalary for why the
    // salary figure never reaches Finance (the compensation wall).
    let salaryCreated = false
    if (input.base_salary !== undefined && input.base_salary !== null) {
      salaryCreated = await onboardStartingSalary(
        service,
        user,
        employee.id,
        input.full_name,
        input.base_salary,
        input.date_joined ?? null
      )
    }

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'employee_onboarded',
      entityType: 'employee',
      entityId: employee.id,
      metadata: {
        new_user_id: authId,
        role_id: input.role_id,
        email: input.email,
        has_photo: Boolean(photoPath),
        documents: documentsStored,
        // Whether, not how much — the amount is never written to the audit trail.
        salary_set: salaryCreated,
      },
    })

    return { ...(employee as Employee), profile_photo_path: photoPath }
  } catch (err) {
    // Unwind the orphan login — users row first (if the employees insert failed), then the auth
    // user. Both best-effort; neither may mask the original error.
    try {
      await service.from('users').delete().eq('id', authId)
    } catch {
      /* best-effort cleanup */
    }
    try {
      await service.auth.admin.deleteUser(authId)
    } catch {
      /* best-effort cleanup */
    }
    throw err
  }
}

/**
 * Creates the new hire's first salary_records row and hands Finance a task to set up the
 * disbursement. Called only from onboardEmployee, only when the HR lead entered a salary.
 *
 * THE COMPENSATION WALL. Finance cannot read salary_records — that is enforced by RLS (0015/0016)
 * and deliberately never widened. So Finance is NOT told the amount here: instead it gets a plain
 * department task ("Set up salary disbursement for {name}") that carries no figure. The task is
 * something Finance can actually read (tasks RLS admits the assigned department), so it both
 * notifies them and gives them an actionable item, while the number stays behind the wall — visible
 * only to the CEO, the HR lead, and the employee themselves via the payroll surfaces.
 *
 * Runs on the SERVICE client (like the rest of onboardEmployee), so it bypasses RLS; the control is
 * that onboardEmployee already gated on assertHrLead, which is exactly the salary sensitive tier.
 * Best-effort and self-contained: any failure is logged and swallowed with a false return, never
 * thrown — a hiccup here must not roll back an already-provisioned employee. Returns whether the
 * salary row was created (the Finance task is a secondary notification, not part of the result).
 */
async function onboardStartingSalary(
  service: ReturnType<typeof createSupabaseServiceClient>,
  user: SessionUser,
  employeeId: string,
  employeeName: string,
  baseSalary: number,
  dateJoined: string | null
): Promise<boolean> {
  try {
    // First of the joining month (or the current month when no join date was given), matching the
    // unique(employee_id, effective_month) shape createSalaryRecord normalises to.
    const basis = dateJoined ? new Date(dateJoined) : new Date()
    const effectiveMonth = `${basis.toISOString().slice(0, 7)}-01`

    const { data, error } = await service
      .from('salary_records')
      .insert({
        employee_id: employeeId,
        effective_month: effectiveMonth,
        base_salary: baseSalary,
        bonus: 0,
        incentives: 0,
        deductions: 0,
        status: 'draft', // HR/CEO finalise it on the payroll page before it is ever paid.
        processed_by: user.id,
        // net_payable is a generated column — never sent.
      })
      .select('id')
      .single()

    if (error) {
      console.error('[hr] onboarding salary insert failed', error.message)
      return false
    }

    // The audit trail records THAT a starting salary was set, never the amount (mirrors
    // createSalaryRecord, which logs via logSensitiveAccess without the figure).
    await logSensitiveAccess(user.organization_id, user.id, 'salary_record', data.id, {
      employee_id: employeeId,
      effective_month: effectiveMonth,
      action: 'salary_record_created',
      via: 'onboarding',
    })

    // Notify Finance to set up the disbursement — a department task with NO amount (the wall).
    await notifyFinanceOfNewSalary(service, user, employeeName)

    return true
  } catch (err) {
    console.error('[hr] onboarding salary step failed', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Files a Finance-department task asking them to set up the new hire's salary disbursement. No
 * amount — see the wall note on onboardStartingSalary. Best-effort: if Finance has no department in
 * this org, or the insert fails, we log and move on rather than failing the salary step. The task
 * lands unclaimed (assigned_user_id null), the same shape every department task takes; a Finance
 * member sees it in their queue and their header bell.
 */
async function notifyFinanceOfNewSalary(
  service: ReturnType<typeof createSupabaseServiceClient>,
  user: SessionUser,
  employeeName: string
): Promise<void> {
  const { data: finance } = await service
    .from('departments')
    .select('id')
    .eq('organization_id', user.organization_id)
    .eq('slug', 'finance')
    .maybeSingle()

  if (!finance) {
    console.error('[hr] no finance department to notify of new salary')
    return
  }

  const { data: task, error } = await service
    .from('tasks')
    .insert({
      organization_id: user.organization_id,
      title: `Set up salary disbursement for ${employeeName}`,
      description:
        'A new employee was onboarded with a starting salary. Set up their monthly ' +
        'disbursement. The salary amount is on the HR payroll record (visible to HR/CEO).',
      created_by: user.id,
      assigned_department_id: finance.id,
      assigned_user_id: null,
      priority: 'medium',
      status: 'pending',
      progress_percent: 0,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[hr] finance salary-notify task failed', error.message)
    return
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'task.created',
    entityType: 'task',
    entityId: task.id,
    metadata: { source: 'onboarding_salary', department_id: finance.id },
  })
}

/**
 * Decodes a 'data:image/...;base64,...' URI and uploads it as the employee's profile photo,
 * returning the storage path or null on any failure (best-effort — a missing photo never blocks
 * onboarding). Enforces MAX_UPLOAD_BYTES on the DECODED size, since the schema only bounds the
 * base64 string. Path is '{employee_id}/profile-{n}.{ext}', the same employee-id-first convention
 * every HR object uses so the existing storage policies apply unchanged.
 */
async function uploadProfilePhoto(
  service: ReturnType<typeof createSupabaseServiceClient>,
  employeeId: string,
  dataUri: string
): Promise<string | null> {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUri)
  if (!match) return null
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null

  const path = `${employeeId}/profile-${Date.now()}.${ext}`
  const { error } = await service.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: `image/${match[1]}`, upsert: true })
  if (error) return null
  return path
}

/**
 * Uploads one inline onboarding document to '{employee_id}/doc-{type}-{n}.{ext}' and records
 * its employee_documents row. Best-effort: returns false on any failure (bad data URI,
 * oversize, upload or insert error) without throwing, so one bad document never rolls back a
 * provisioned employee. Mirrors uploadProfilePhoto — decode, bound the DECODED size against
 * MAX_UPLOAD_BYTES, upload with the service client (the hr-documents bucket has no client-write
 * policy), then insert. The gate is the caller's (assertHrLead in onboardEmployee).
 */
async function storeOnboardingDocument(
  service: ReturnType<typeof createSupabaseServiceClient>,
  employeeId: string,
  uploadedBy: string,
  doc: OnboardingDocumentInput
): Promise<boolean> {
  const match = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(doc.file_data)
  if (!match) return false
  const mime = match[1]
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return false

  const ext = mime === 'application/pdf' ? 'pdf' : mime.slice('image/'.length).replace('jpeg', 'jpg')
  const path = `${employeeId}/doc-${doc.document_type}-${Date.now()}.${ext}`

  const { error: uploadError } = await service.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: true })
  if (uploadError) return false

  const { error: rowError } = await service.from('employee_documents').insert({
    employee_id: employeeId,
    document_type: doc.document_type,
    file_path: path,
    file_name: doc.file_name,
    uploaded_by: uploadedBy,
  })
  if (rowError) {
    // Row failed — remove the orphaned object so storage does not accrue unreferenced files.
    await service.storage.from(HR_DOCUMENTS_BUCKET).remove([path]).catch(() => {})
    return false
  }
  return true
}

export async function updateEmployee(
  user: SessionUser,
  employeeId: string,
  input: UpdateEmployeeInput
): Promise<Employee> {
  // Editing personnel fields (designation, code, reporting line) is an HR-lead action —
  // the employees RLS added in 0015 grants HR-lead full and HR-member view-only.
  assertHrLead(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<{ id: string }>(supabase, 'employees', employeeId, 'id', 'Employee')

  const { data, error } = await supabase
    .from('employees')
    .update(input)
    .eq('id', employeeId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'employee_updated',
    entityType: 'employee',
    entityId: employeeId,
    metadata: { changed: Object.keys(input) },
  })

  return data as Employee
}

/**
 * Processes an exit atomically via the process_employee_exit() RPC (migration 0015):
 * the exits row, employees.employment_status = 'exited', and users.is_active = false —
 * all in one transaction. The RPC is security definer with an internal HR-lead/CEO
 * guard (deactivating another user's account is beyond HR-lead RLS on users), so this
 * gate is defence-in-depth ahead of it, and the audit row is written here.
 *
 * A half-completed exit — record made but account still active, or the reverse — is a
 * genuine security and payroll risk, which is exactly why it is one transaction and not
 * three client calls.
 */
export async function processExit(
  user: SessionUser,
  employeeId: string,
  input: ProcessExitInput
): Promise<{ exitId: string }> {
  assertHrLead(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('process_employee_exit', {
    p_employee_id: employeeId,
    p_exit_date: input.exit_date,
    p_exit_type: input.exit_type ?? null,
    p_reason: input.reason ?? null,
    p_notes: input.notes ?? null,
  })

  if (error) throw new ServiceError(error.message, 400)
  const exitId = data as unknown as string

  // Exit data is sensitive-tier — log the access, not just the mutation.
  await logSensitiveAccess(user.organization_id, user.id, 'exit', exitId, {
    employee_id: employeeId,
    exit_type: input.exit_type ?? null,
    action: 'employee_exit_processed',
  })

  return { exitId }
}

// ---------------------------------------------------------------------------
// Employee documents
// ---------------------------------------------------------------------------

/**
 * Records an already-uploaded employee document. The path is '{employee_id}/{filename}'
 * (employee id is the first segment), matching the storage policy. The employee must be
 * visible to the caller; ordinary paperwork (id_proof, address_proof) is HR-member
 * work, but offer letters/contracts/exit letters are sensitive-tier and only the HR
 * lead may file them.
 */
export async function addEmployeeDocument(
  user: SessionUser,
  employeeId: string,
  input: CreateEmployeeDocumentInput
): Promise<EmployeeDocument> {
  const sensitive = SENSITIVE_DOCUMENT_TYPES.includes(input.document_type)
  if (sensitive) {
    assertSensitiveAccess(user)
  } else {
    assertHrCanWrite(user)
  }

  const supabase = await createSupabaseServerClient()
  await assertEmployeeInOrg(supabase, user, employeeId)

  if (!input.file_path.startsWith(`${employeeId}/`)) {
    throw new ServiceError('File path does not belong to this employee', 400)
  }

  const { data, error } = await supabase
    .from('employee_documents')
    .insert({
      employee_id: employeeId,
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
    action: 'employee_document_uploaded',
    entityType: 'employee_document',
    entityId: data.id,
    metadata: { employee_id: employeeId, document_type: input.document_type },
  })

  return data as EmployeeDocument
}

/**
 * Mints a short-lived signed URL for one employee document. Loaded under RLS first, so
 * a document the caller cannot see is a 404 and no URL is minted. Sensitive document
 * types (offer letter, contract, exit letter) are logged with logSensitiveAccess — the
 * same treatment salary reads get, per the security blueprint; ordinary paperwork is
 * logged with logAction.
 */
export async function signDocumentDownload(
  user: SessionUser,
  documentId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const doc = await loadVisible<
    Pick<EmployeeDocument, 'id' | 'employee_id' | 'file_path' | 'file_name' | 'document_type'>
  >(
    supabase,
    'employee_documents',
    documentId,
    'id, employee_id, file_path, file_name, document_type',
    'Document'
  )

  const { data, error } = await supabase.storage
    .from(HR_DOCUMENTS_BUCKET)
    .createSignedUrl(doc.file_path, SIGNED_URL_TTL_SECONDS, { download: doc.file_name })

  if (error || !data) throw new ServiceError(error?.message ?? 'Could not sign the file', 400)

  const sensitive = SENSITIVE_DOCUMENT_TYPES.includes(doc.document_type as EmployeeDocumentType)
  if (sensitive) {
    await logSensitiveAccess(user.organization_id, user.id, 'employee_document', doc.id, {
      employee_id: doc.employee_id,
      document_type: doc.document_type,
    })
  } else {
    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'employee_document_downloaded',
      entityType: 'employee_document',
      entityId: doc.id,
      metadata: { file_name: doc.file_name, document_type: doc.document_type },
    })
  }

  return { url: data.signedUrl, fileName: doc.file_name }
}

// ===========================================================================
// Attendance
// ===========================================================================

// Attendance is WRITTEN in exactly ONE place: the QR attendance kiosk (built separately),
// which resolves an employee's allotted card via /api/qr/resolve and stamps their in/out
// through its own endpoint. Nothing in the app marks attendance from a personal dashboard
// any more — the former selfCheckIn/selfCheckOut writers and their /api/attendance/check-*
// routes were removed, so /me/attendance is now read-only history (listOwnAttendance).
//
// HR is likewise READ-ONLY here (see /hr/attendance): the former markAttendance() writer was
// removed with 0024, which also narrowed HR's grant on attendance_records to FOR SELECT.

// ===========================================================================
// Leave
// ===========================================================================

/**
 * Submits a leave request for the signed-in employee via submit_leave_request()
 * (migration 0015): the leave_requests row AND a linked approvals row (type 'leave') in
 * one transaction. The RPC runs as the caller (not security definer), so RLS governs
 * both inserts and an employee can only ever file their own. The employee_id is derived
 * here from the caller — never taken from the request body — so this is open to every
 * active user, HR or not.
 *
 * The DECISION on that approval is made on the CEO's existing Approvals page and
 * propagates back to leave_requests.status through decideApproval() in
 * lib/services/approvals.ts — see the commented step there.
 */
export async function submitLeave(
  user: SessionUser,
  input: SubmitLeaveInput
): Promise<{ leaveId: string }> {
  const supabase = await createSupabaseServerClient()
  const employeeId = await ownEmployeeId(supabase, user)
  if (!employeeId) throw new ServiceError('No employee record for your account', 400)

  const { data, error } = await supabase.rpc('submit_leave_request', {
    p_employee_id: employeeId,
    p_leave_type: input.leave_type,
    p_start_date: input.start_date,
    p_end_date: input.end_date,
    p_reason: input.reason ?? null,
  })

  if (error) throw new ServiceError(error.message, 400)
  const leaveId = data as unknown as string

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'leave_requested',
    entityType: 'leave_request',
    entityId: leaveId,
    metadata: { leave_type: input.leave_type, start_date: input.start_date, end_date: input.end_date },
  })

  return { leaveId }
}

// ===========================================================================
// Payroll — SENSITIVE TIER. Every read and write gates on assertSensitiveAccess,
// and every read of another employee's pay is logged with logSensitiveAccess.
// ===========================================================================

export async function createSalaryRecord(
  user: SessionUser,
  input: CreateSalaryRecordInput
): Promise<SalaryRecord> {
  assertSensitiveAccess(user)
  const supabase = await createSupabaseServerClient()
  await assertEmployeeInOrg(supabase, user, input.employee_id)

  // Normalise to the first of the month so the unique(employee, effective_month) holds
  // regardless of which day the HR lead picked.
  const effectiveMonth = `${input.effective_month.slice(0, 7)}-01`

  const { data, error } = await supabase
    .from('salary_records')
    .insert({
      employee_id: input.employee_id,
      effective_month: effectiveMonth,
      base_salary: input.base_salary,
      bonus: input.bonus,
      incentives: input.incentives,
      deductions: input.deductions,
      status: input.status,
      processed_by: user.id,
      // net_payable is a generated column — never sent.
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logSensitiveAccess(user.organization_id, user.id, 'salary_record', data.id, {
    employee_id: input.employee_id,
    effective_month: effectiveMonth,
    action: 'salary_record_created',
  })

  return data as SalaryRecord
}

export async function updateSalaryRecord(
  user: SessionUser,
  salaryId: string,
  input: UpdateSalaryRecordInput
): Promise<SalaryRecord> {
  assertSensitiveAccess(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<{ id: string }>(supabase, 'salary_records', salaryId, 'id', 'Salary record')

  const { data, error } = await supabase
    .from('salary_records')
    .update(input)
    .eq('id', salaryId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logSensitiveAccess(user.organization_id, user.id, 'salary_record', salaryId, {
    changed: Object.keys(input),
    action: 'salary_record_updated',
  })

  return data as SalaryRecord
}

/**
 * Lists an employee's salary records for the HR lead / CEO. This reads ANOTHER
 * employee's pay, so it gates on the sensitive tier and logs the access. For an
 * employee reading their OWN payslips, use listOwnPayslips instead.
 */
export async function listSalaryForEmployee(
  user: SessionUser,
  employeeId: string
): Promise<SalaryRecord[]> {
  assertSensitiveAccess(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('salary_records')
    .select('*')
    .eq('employee_id', employeeId)
    .order('effective_month', { ascending: false })

  if (error) throw new ServiceError(error.message, 400)

  await logSensitiveAccess(user.organization_id, user.id, 'salary_record', null, {
    employee_id: employeeId,
    action: 'salary_records_viewed',
    count: data?.length ?? 0,
  })

  return (data ?? []).map(coerceSalaryNumbers)
}

/**
 * The signed-in employee's OWN payslips — the company-wide personal surface. Does NOT
 * gate on the sensitive tier: reading your own pay is always allowed, and RLS
 * (employee_view_own_salary) backs that. The read is still logged as sensitive, because
 * salary data is salary data even when it is your own.
 */
export async function listOwnPayslips(user: SessionUser): Promise<SalaryRecord[]> {
  const supabase = await createSupabaseServerClient()
  const employeeId = await ownEmployeeId(supabase, user)
  if (!employeeId) return []

  const { data, error } = await supabase
    .from('salary_records')
    .select('*')
    // finalized/paid only — a draft the HR lead is still preparing is not a payslip yet.
    .in('status', ['finalized', 'paid'])
    .eq('employee_id', employeeId)
    .order('effective_month', { ascending: false })

  if (error) throw new ServiceError(error.message, 400)

  await logSensitiveAccess(user.organization_id, user.id, 'salary_record', null, {
    employee_id: employeeId,
    action: 'own_payslips_viewed',
    count: data?.length ?? 0,
  })

  return (data ?? []).map(coerceSalaryNumbers)
}

/**
 * Recent salary records across the org for the payroll overview — SENSITIVE TIER. Gates
 * on the sensitive access check and logs the bulk view, then joins the employee name so
 * the table is readable. Only the HR lead / CEO ever reach this; a plain HR Executive is
 * turned away before the page renders any of it.
 */
export interface SalaryWithEmployee extends SalaryRecord {
  employeeName: string
}

export async function listRecentSalaryRecords(
  user: SessionUser,
  limit = 50
): Promise<SalaryWithEmployee[]> {
  assertSensitiveAccess(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('salary_records')
    .select('*, employee:employees!salary_records_employee_id_fkey(users!employees_user_id_fkey!inner(full_name))')
    .order('effective_month', { ascending: false })
    .limit(limit)

  if (error) throw new ServiceError(error.message, 400)

  await logSensitiveAccess(user.organization_id, user.id, 'salary_record', null, {
    action: 'salary_overview_viewed',
    count: data?.length ?? 0,
  })

  return (data ?? []).map((row) => {
    const emp = row.employee as unknown as { users: { full_name: string } | null } | null
    return {
      ...coerceSalaryNumbers(row as Record<string, unknown>),
      employeeName: emp?.users?.full_name ?? '—',
    }
  })
}

/** numeric(14,2) columns arrive from supabase-js as strings — Number() them for the app. */
function coerceSalaryNumbers(row: Record<string, unknown>): SalaryRecord {
  return {
    ...(row as unknown as SalaryRecord),
    base_salary: Number(row.base_salary),
    bonus: Number(row.bonus),
    incentives: Number(row.incentives),
    deductions: Number(row.deductions),
    net_payable: Number(row.net_payable),
  }
}

// ===========================================================================
// Performance — KPIs (HR lead sets; employee reads own) and appraisals (SENSITIVE)
// ===========================================================================

export async function createKpi(user: SessionUser, input: CreateKpiInput): Promise<PerformanceKpi> {
  assertHrLead(user)
  const supabase = await createSupabaseServerClient()
  await assertEmployeeInOrg(supabase, user, input.employee_id)

  const { data, error } = await supabase
    .from('performance_kpis')
    .insert({
      employee_id: input.employee_id,
      period_start: input.period_start,
      period_end: input.period_end,
      kpi_description: input.kpi_description,
      target_value: input.target_value ?? null,
      actual_value: input.actual_value ?? null,
      status: input.status,
      set_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'kpi_created',
    entityType: 'performance_kpi',
    entityId: data.id,
    metadata: { employee_id: input.employee_id },
  })

  return data as PerformanceKpi
}

export async function updateKpi(
  user: SessionUser,
  kpiId: string,
  input: UpdateKpiInput
): Promise<PerformanceKpi> {
  assertHrLead(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<{ id: string }>(supabase, 'performance_kpis', kpiId, 'id', 'KPI')

  const { data, error } = await supabase
    .from('performance_kpis')
    .update(input)
    .eq('id', kpiId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'kpi_updated',
    entityType: 'performance_kpi',
    entityId: kpiId,
    metadata: { changed: Object.keys(input) },
  })

  return data as PerformanceKpi
}

/**
 * Creates an appraisal — SENSITIVE TIER. An appraisal is as private as pay: only the HR
 * lead or CEO may write one, and the access is logged. The employee reads their own via
 * RLS (employee_view_own_appraisals).
 */
export async function createAppraisal(
  user: SessionUser,
  input: CreateAppraisalInput
): Promise<Appraisal> {
  assertSensitiveAccess(user)
  const supabase = await createSupabaseServerClient()
  await assertEmployeeInOrg(supabase, user, input.employee_id)

  const { data, error } = await supabase
    .from('appraisals')
    .insert({
      employee_id: input.employee_id,
      review_period: input.review_period,
      rating: input.rating ?? null,
      strengths: input.strengths ?? null,
      areas_of_improvement: input.areas_of_improvement ?? null,
      reviewed_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logSensitiveAccess(user.organization_id, user.id, 'appraisal', data.id, {
    employee_id: input.employee_id,
    review_period: input.review_period,
    action: 'appraisal_created',
  })

  return data as Appraisal
}

/**
 * Lists another employee's appraisals for the HR lead / CEO — sensitive tier, logged.
 * The employee's own appraisals come back through their profile read under RLS.
 */
export async function listAppraisalsForEmployee(
  user: SessionUser,
  employeeId: string
): Promise<Appraisal[]> {
  assertSensitiveAccess(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('appraisals')
    .select('*')
    .eq('employee_id', employeeId)
    .order('reviewed_at', { ascending: false })

  if (error) throw new ServiceError(error.message, 400)

  await logSensitiveAccess(user.organization_id, user.id, 'appraisal', null, {
    employee_id: employeeId,
    action: 'appraisals_viewed',
    count: data?.length ?? 0,
  })

  return (data ?? []) as Appraisal[]
}

// ---------------------------------------------------------------------------
// Personal self-service reads (company-wide, any active user)
// ---------------------------------------------------------------------------

/** The signed-in employee's own attendance history. RLS (employee_own_attendance) backs it. */
export async function listOwnAttendance(user: SessionUser, days = 60): Promise<AttendanceRecord[]> {
  const supabase = await createSupabaseServerClient()
  const employeeId = await ownEmployeeId(supabase, user)
  if (!employeeId) return []

  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('date', since)
    .order('date', { ascending: false })

  if (error) throw new ServiceError(error.message, 400)
  return (data ?? []) as AttendanceRecord[]
}

/** The signed-in employee's own leave requests. RLS (employee_own_leave) backs it. */
export async function listOwnLeave(user: SessionUser): Promise<LeaveRequest[]> {
  const supabase = await createSupabaseServerClient()
  const employeeId = await ownEmployeeId(supabase, user)
  if (!employeeId) return []

  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) throw new ServiceError(error.message, 400)
  return (data ?? []) as LeaveRequest[]
}
