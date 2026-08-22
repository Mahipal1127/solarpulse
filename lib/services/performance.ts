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

export interface PerformanceSummary {
  employeeId: string
  periodDays: number
  tasks: {
    total: number
    completed: number
    /** 0–100, or null when there are no assigned tasks (so the UI shows "—", not "0%"). */
    completionRate: number | null
  }
  attendance: {
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

  const days = Math.min(Math.max(periodDays, 1), 365)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const sinceDate = since.toISOString().slice(0, 10) // attendance.date is a DATE column

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
    .gte('created_at', since.toISOString())
  if (taskError) throw new ServiceError(taskError.message, 400)

  const taskRows = tasks ?? []
  const completed = taskRows.filter((t) => t.status === 'completed').length
  const total = taskRows.length

  // --- Attendance in the window ---
  const { data: attendance, error: attError } = await supabase
    .from('attendance_records')
    .select('status, check_in, check_out')
    .eq('employee_id', employeeId)
    .gte('date', sinceDate)
  if (attError) throw new ServiceError(attError.message, 400)

  let present = 0
  let halfDay = 0
  let absent = 0
  let onLeave = 0
  let totalMs = 0
  let openShifts = 0

  for (const row of attendance ?? []) {
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
    employeeId,
    periodDays: days,
    tasks: {
      total,
      completed,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : null,
    },
    attendance: {
      present,
      halfDay,
      absent,
      onLeave,
      totalHours: Math.round((totalMs / (1000 * 60 * 60)) * 10) / 10,
      openShifts,
    },
  }
}
