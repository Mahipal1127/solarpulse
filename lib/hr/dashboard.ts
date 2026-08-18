import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import type {
  Candidate,
  Interview,
  AttendanceRecord,
  LeaveRequest,
  PerformanceKpi,
} from '@/lib/types'

/**
 * Server-side read helpers for the HR pages. Every query runs on the session-bound
 * client, so RLS (migration 0015) decides which rows come back — these helpers add no
 * permission logic of their own beyond what the caller's role already grants at the
 * database. In particular NOTHING here reads salary_records or appraisals: those are the
 * sensitive tier and are fetched only through lib/services/hr.ts, which gates and logs
 * the access. Keeping them out of the general dashboard loaders is deliberate — a
 * convenience join here would be exactly the "salary in a table without a role check"
 * the security blueprint forbids.
 */

/** An org member as a roster option (assignees, interviewers, reporting lines). */
export interface HrEmployeeOption {
  employee_id: string
  user_id: string
  full_name: string
  designation: string | null
  department_name: string | null
  employment_status: string
}

/**
 * The employee roster the HR pages pick from. Joins employees → users for the name and
 * department. RLS lets HR members view employees org-wide (0015), so this is the roster
 * for onboarding reporting-lines, attendance marking, payroll, and KPIs.
 */
export async function getEmployeeRoster(): Promise<HrEmployeeOption[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('employees')
    .select(
      'id, user_id, designation, employment_status, users!inner(full_name, is_active, departments(name))'
    )
    .order('employment_status', { ascending: true })

  return (data ?? []).map((row) => {
    const u = row.users as unknown as {
      full_name: string
      is_active: boolean
      departments: { name: string } | null
    }
    return {
      employee_id: row.id as string,
      user_id: row.user_id as string,
      full_name: u?.full_name ?? '—',
      designation: (row.designation as string | null) ?? null,
      department_name: u?.departments?.name ?? null,
      employment_status: row.employment_status as string,
    }
  })
}

/** Active org members as onboarding role/reporting options — reads users directly. */
export interface UserOption {
  id: string
  full_name: string
}

export async function getActiveUsers(): Promise<UserOption[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, is_active')
    .eq('is_active', true)
    .order('full_name', { ascending: true })
  return (data ?? []).map((u) => ({ id: u.id as string, full_name: u.full_name as string }))
}

/** Roles in the org, for the onboarding role picker. HR lead reads these via RLS. */
export interface RoleOption {
  id: string
  name: string
  department_name: string | null
}

export async function getRoleOptions(): Promise<RoleOption[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('roles')
    .select('id, name, departments(name)')
    .order('name', { ascending: true })
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    department_name: (r.departments as unknown as { name: string } | null)?.name ?? null,
  }))
}

export interface CandidateWithInterviews extends Candidate {
  interviews: Interview[]
}

/** The recruitment board: candidates the caller can see, each with its interviews. */
export async function getCandidates(): Promise<CandidateWithInterviews[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('candidates')
    .select('*, interviews(*)')
    .order('created_at', { ascending: false })
  return (data ?? []) as unknown as CandidateWithInterviews[]
}

/** All leave requests visible to the caller — the HR processing queue. */
export interface LeaveWithEmployee extends LeaveRequest {
  employee: { full_name: string } | null
}

export async function getLeaveQueue(): Promise<LeaveWithEmployee[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('leave_requests')
    .select('*, employee:employees!leave_requests_employee_id_fkey(users!inner(full_name))')
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => {
    const emp = row.employee as unknown as { users: { full_name: string } | null } | null
    return {
      ...(row as unknown as LeaveRequest),
      employee: emp?.users ? { full_name: emp.users.full_name } : null,
    }
  })
}

/** Attendance for a given date across the org (HR overview). */
export interface AttendanceWithEmployee extends AttendanceRecord {
  employee: { full_name: string } | null
}

export async function getAttendanceForDate(date: string): Promise<AttendanceWithEmployee[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('attendance_records')
    .select('*, employee:employees!attendance_records_employee_id_fkey(users!inner(full_name))')
    .eq('date', date)
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => {
    const emp = row.employee as unknown as { users: { full_name: string } | null } | null
    return {
      ...(row as unknown as AttendanceRecord),
      employee: emp?.users ? { full_name: emp.users.full_name } : null,
    }
  })
}

/** KPIs the caller can see, most recent first — the performance overview list. */
export interface KpiWithEmployee extends PerformanceKpi {
  employee: { full_name: string } | null
}

export async function getKpis(): Promise<KpiWithEmployee[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('performance_kpis')
    .select('*, employee:employees!performance_kpis_employee_id_fkey(users!inner(full_name))')
    .order('period_end', { ascending: false })

  return (data ?? []).map((row) => {
    const emp = row.employee as unknown as { users: { full_name: string } | null } | null
    return {
      ...(row as unknown as PerformanceKpi),
      employee: emp?.users ? { full_name: emp.users.full_name } : null,
    }
  })
}

/** Headline counts for the HR dashboard. Each query is RLS-scoped. */
export interface HrDashboardStats {
  activeEmployees: number
  openCandidates: number
  pendingLeave: number
  presentToday: number
}

/** The HR department's id, to scope the CEO-assigned task queries. */
export async function getHrDepartmentId(organizationId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', 'hr')
    .maybeSingle()
  return data?.id ?? null
}

/** Active HR-department members, for the lead's delegation picker. */
export async function getHrEmployees(
  organizationId: string
): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, is_active, departments!inner(slug)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .eq('departments.slug', 'hr')
    .order('full_name')
  return (data ?? []).map((r) => ({ id: r.id as string, full_name: r.full_name as string }))
}

/** CEO tasks assigned to HR without a named owner — the lead's delegation inbox. */
export async function getUnownedHrTasks(
  organizationId: string,
  departmentId: string | null
): Promise<unknown[]> {
  if (!departmentId) return []
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tasks')
    .select(
      '*, assignee:users!tasks_assigned_user_id_fkey(full_name), creator:users!tasks_created_by_fkey(full_name), department:departments!tasks_assigned_department_id_fkey(name)'
    )
    .eq('organization_id', organizationId)
    .eq('assigned_department_id', departmentId)
    .is('assigned_user_id', null)
    .neq('status', 'archived')
    .order('due_date', { ascending: true, nullsFirst: false })
  return data ?? []
}

export async function getHrDashboardStats(): Promise<HrDashboardStats> {
  const supabase = await createSupabaseServerClient()
  const today = new Date().toISOString().slice(0, 10)

  const [emp, cand, leave, present] = await Promise.all([
    supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('employment_status', 'active'),
    supabase
      .from('candidates')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '(hired,rejected)'),
    supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('date', today)
      .eq('status', 'present'),
  ])

  return {
    activeEmployees: emp.count ?? 0,
    openCandidates: cand.count ?? 0,
    pendingLeave: leave.count ?? 0,
    presentToday: present.count ?? 0,
  }
}
