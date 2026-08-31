import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ServiceError } from '@/lib/services/tasks'
import { isHrLead } from '@/lib/services/hr'
import type { SessionUser } from '@/lib/auth/guards'

export { ServiceError }

/**
 * Employee performance summary — STRICT visibility tier, mirroring salary/appraisal (0015).
 *
 * WHO MAY SEE IT. Only the CEO, the HR lead, or the employee THEMSELF — the exact restriction the
 * user confirmed ("strict default", same as compensation). A regular HR Executive and a department
 * lead are turned away, even though the underlying attendance RLS (hr_member_manage_attendance)
 * would let an HR member read the raw rows. This gate is what turns "technically readable" into
 * "not yours to see": performance is sensitive-not-ownership data. RLS remains the backstop, but
 * the product rule lives here, as an explicit 403, so it is legible and auditable rather than an
 * accidental consequence of which policies happen to exist.
 *
 * WHY THE SESSION CLIENT (not service-role). Every legitimate viewer can already read the source
 * rows under RLS — the CEO and HR lead have full access, and the employee has self policies on
 * tasks and attendance. So we run as the caller and let RLS double-check us; no privilege
 * escalation is needed or wanted here (contrast id-cards, where qr_tokens has no readable policy
 * at all and the service client is unavoidable).
 */

export interface TaskStats {
  total: number
  completed: number
  /** 0–100, or null when there are no assigned tasks (so the UI shows "—", not "0%"). */
  completionRate: number | null
}

export interface AttendanceStats {
  present: number
  halfDay: number
  absent: number
  onLeave: number
  /**
   * Total worked hours over the window, summing (check_out − check_in) per record. Records with
   * a null check_out — someone checked in but never out — contribute ZERO, not a running clock:
   * an open shift is not evidence of hours worked, and counting "now − check_in" would inflate
   * the figure differently on every page load. openShifts surfaces the count so the UI can note
   * it honestly rather than silently dropping it.
   */
  totalHours: number
  openShifts: number
}

export interface PerformanceSummary {
  employeeId: string
  periodDays: number
  tasks: TaskStats
  attendance: AttendanceStats
}

/** Shape of a raw task row this module aggregates. */
interface TaskRow {
  status: string | null
}

/** Shape of a raw attendance row this module aggregates. */
interface AttendanceRow {
  status: string | null
  check_in: string | null
  check_out: string | null
}

/** Rolls a set of task rows into the headline completion figures. */
function summariseTasks(rows: TaskRow[]): TaskStats {
  const total = rows.length
  const completed = rows.filter((t) => t.status === 'completed').length
  return {
    total,
    completed,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : null,
  }
}

/**
 * Rolls a set of attendance rows into presence buckets and worked hours. Kept as a pure helper so
 * the single-employee summary and the team overview count identically — an open shift (check-in,
 * no check-out) is surfaced, never guessed at.
 */
function summariseAttendance(rows: AttendanceRow[]): AttendanceStats {
  let present = 0
  let halfDay = 0
  let absent = 0
  let onLeave = 0
  let totalMs = 0
  let openShifts = 0

  for (const row of rows) {
    switch (row.status) {
      case 'present':
        present++
        break
      case 'half_day':
        halfDay++
        break
      case 'absent':
        absent++
        break
      case 'on_leave':
        onLeave++
        break
      // 'holiday' and anything unexpected are not counted toward any bucket.
    }

    if (row.check_in && row.check_out) {
      const ms = new Date(row.check_out).getTime() - new Date(row.check_in).getTime()
      if (ms > 0) totalMs += ms
    } else if (row.check_in && !row.check_out) {
      openShifts++ // checked in, never out — contributes no hours (see the interface note).
    }
  }

  return {
    present,
    halfDay,
    absent,
    onLeave,
    totalHours: Math.round((totalMs / (1000 * 60 * 60)) * 10) / 10,
    openShifts,
  }
}

/** Clamps a requested window to a sane range and returns the derived cut-off timestamps. */
function resolveWindow(periodDays: number): { days: number; sinceIso: string; sinceDate: string } {
  const days = Math.min(Math.max(periodDays, 1), 365)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return {
    days,
    sinceIso: since.toISOString(),
    sinceDate: since.toISOString().slice(0, 10), // attendance.date is a DATE column
  }
}

/** CEO, HR lead, or the employee themself. Anyone else is refused. */
async function assertCanViewPerformance(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  user: SessionUser,
  employeeId: string
): Promise<void> {
  if (user.roleName === 'CEO' || isHrLead(user)) return

  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) {
    throw new ServiceError('You do not have access to this performance summary', 403)
  }
}

/**
 * Gathers a performance summary for one employee over the trailing `periodDays` (default 30).
 * Returns null-safe zeros for an employee with no activity rather than throwing, so the panel
 * always renders. periodDays is clamped to a sane range.
 */
export async function getPerformanceSummary(
  user: SessionUser,
  employeeId: string,
  periodDays = 30
): Promise<PerformanceSummary> {
  const supabase = await createSupabaseServerClient()
  await assertCanViewPerformance(supabase, user, employeeId)

  const { days, sinceIso, sinceDate } = resolveWindow(periodDays)

  // The employee's user_id — tasks are assigned by user, attendance keyed by employee.
  const { data: emp } = await supabase
    .from('employees')
    .select('id, user_id')
    .eq('id', employeeId)
    .maybeSingle()
  if (!emp) throw new ServiceError('Employee not found', 404)

  // --- Tasks assigned to this user in the window ---
  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('status')
    .eq('assigned_user_id', emp.user_id)
    .gte('created_at', sinceIso)
  if (taskError) throw new ServiceError(taskError.message, 400)

  // --- Attendance in the window ---
  const { data: attendance, error: attError } = await supabase
    .from('attendance_records')
    .select('status, check_in, check_out')
    .eq('employee_id', employeeId)
    .gte('date', sinceDate)
  if (attError) throw new ServiceError(attError.message, 400)

  return {
    employeeId,
    periodDays: days,
    tasks: summariseTasks(tasks ?? []),
    attendance: summariseAttendance(attendance ?? []),
  }
}

/** One employee's line in the team performance overview. */
export interface TeamPerformanceRow {
  employeeId: string
  userId: string
  fullName: string
  designation: string | null
  departmentName: string | null
  tasks: TaskStats
  attendance: AttendanceStats
}

export interface TeamPerformanceOverview {
  periodDays: number
  rows: TeamPerformanceRow[]
  totals: {
    people: number
    tasksAssigned: number
    tasksCompleted: number
    /** Team-wide completion across all assigned tasks, or null when none were assigned. */
    completionRate: number | null
    present: number
    absent: number
    onLeave: number
    totalHours: number
  }
}

/**
 * A whole-team performance snapshot for the HR lead / CEO — the detailed analytics behind the
 * Performance page. STRICT TIER, same as the single-employee summary: only the CEO or HR lead may
 * call it (a plain HR Executive is refused with a 403), because this lays every person's task and
 * attendance record side by side, which is management information, not general HR-member data.
 *
 * WHY THREE BULK QUERIES, NOT ONE PER PERSON. The single-employee summary issues its own task and
 * attendance queries; looping it over the roster would be N×2 round-trips. Instead we read the
 * roster once, then all tasks and all attendance for the window in one query each, and bucket them
 * in memory by user / employee. RLS still scopes every row — the lead and CEO can read the whole
 * org (0015), so the bulk reads return exactly what a per-person call would, only far cheaper.
 *
 * Runs on the session client so RLS is the backstop; no service-role escalation (the caller can
 * already read these rows). Employees with no activity appear with honest zeros, not omitted.
 */
export async function getTeamPerformanceOverview(
  user: SessionUser,
  periodDays = 30
): Promise<TeamPerformanceOverview> {
  if (user.roleName !== 'CEO' && !isHrLead(user)) {
    throw new ServiceError('You do not have access to team performance', 403)
  }

  const supabase = await createSupabaseServerClient()
  const { days, sinceIso, sinceDate } = resolveWindow(periodDays)

  // Active roster with names + department, one query. 'exited' staff are dropped — a departed
  // employee's trailing-window figures are noise on a "who is performing" board.
  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select(
      'id, user_id, designation, employment_status, users!employees_user_id_fkey!inner(full_name, departments(name))'
    )
    .neq('employment_status', 'exited')
  if (empError) throw new ServiceError(empError.message, 400)

  const roster = (employees ?? []).map((row) => {
    const u = row.users as unknown as {
      full_name: string
      departments: { name: string } | null
    }
    return {
      employeeId: row.id as string,
      userId: row.user_id as string,
      designation: (row.designation as string | null) ?? null,
      fullName: u?.full_name ?? '—',
      departmentName: u?.departments?.name ?? null,
    }
  })

  if (roster.length === 0) {
    return {
      periodDays: days,
      rows: [],
      totals: {
        people: 0,
        tasksAssigned: 0,
        tasksCompleted: 0,
        completionRate: null,
        present: 0,
        absent: 0,
        onLeave: 0,
        totalHours: 0,
      },
    }
  }

  const userIds = roster.map((r) => r.userId)
  const employeeIds = roster.map((r) => r.employeeId)

  // All tasks + all attendance for the window in one query each, then bucket in memory.
  const [taskRes, attRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('assigned_user_id, status')
      .in('assigned_user_id', userIds)
      .gte('created_at', sinceIso),
    supabase
      .from('attendance_records')
      .select('employee_id, status, check_in, check_out')
      .in('employee_id', employeeIds)
      .gte('date', sinceDate),
  ])
  if (taskRes.error) throw new ServiceError(taskRes.error.message, 400)
  if (attRes.error) throw new ServiceError(attRes.error.message, 400)

  const tasksByUser = new Map<string, TaskRow[]>()
  for (const row of taskRes.data ?? []) {
    const key = row.assigned_user_id as string
    const list = tasksByUser.get(key)
    if (list) list.push({ status: row.status as string | null })
    else tasksByUser.set(key, [{ status: row.status as string | null }])
  }

  const attByEmployee = new Map<string, AttendanceRow[]>()
  for (const row of attRes.data ?? []) {
    const key = row.employee_id as string
    const rec: AttendanceRow = {
      status: row.status as string | null,
      check_in: row.check_in as string | null,
      check_out: row.check_out as string | null,
    }
    const list = attByEmployee.get(key)
    if (list) list.push(rec)
    else attByEmployee.set(key, [rec])
  }

  const rows: TeamPerformanceRow[] = roster
    .map((r) => ({
      employeeId: r.employeeId,
      userId: r.userId,
      fullName: r.fullName,
      designation: r.designation,
      departmentName: r.departmentName,
      tasks: summariseTasks(tasksByUser.get(r.userId) ?? []),
      attendance: summariseAttendance(attByEmployee.get(r.employeeId) ?? []),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))

  const totals = rows.reduce(
    (acc, r) => {
      acc.tasksAssigned += r.tasks.total
      acc.tasksCompleted += r.tasks.completed
      acc.present += r.attendance.present
      acc.absent += r.attendance.absent
      acc.onLeave += r.attendance.onLeave
      acc.totalHours += r.attendance.totalHours
      return acc
    },
    { tasksAssigned: 0, tasksCompleted: 0, present: 0, absent: 0, onLeave: 0, totalHours: 0 }
  )

  return {
    periodDays: days,
    rows,
    totals: {
      people: rows.length,
      tasksAssigned: totals.tasksAssigned,
      tasksCompleted: totals.tasksCompleted,
      completionRate:
        totals.tasksAssigned > 0
          ? Math.round((totals.tasksCompleted / totals.tasksAssigned) * 100)
          : null,
      present: totals.present,
      absent: totals.absent,
      onLeave: totals.onLeave,
      totalHours: Math.round(totals.totalHours * 10) / 10,
    },
  }
}
