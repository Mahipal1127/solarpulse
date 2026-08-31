import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listSubmittedReports } from '@/lib/services/employee-reports'
import { listApplicationsForCeo, listApplicationsForHr } from '@/lib/services/applications'
import { homeRouteFor } from '@/lib/auth/home-route'
import type { SessionUser } from '@/lib/auth/guards'

/**
 * The notification feed behind the header bell.
 *
 * DERIVED, NOT STORED. There is no notifications table — and deliberately so. Every event worth
 * surfacing is ALREADY a row somewhere (a task assigned to you, a report someone submitted, an
 * application addressed to you), so we read those tables through the caller's own RLS-scoped client
 * and assemble a feed on the fly. That means:
 *   - nothing new to apply to the database (the live DB already carries an unapplied migration
 *     backlog; a notifications table would sit behind all of it),
 *   - no write path to keep in sync, no way for the feed to disagree with the source of truth,
 *   - and RLS decides what each viewer may see, exactly as it does on the pages themselves.
 *
 * UNREAD is NOT tracked here. "Read" is a per-viewer, per-device convenience, so the client keeps a
 * last-seen timestamp in localStorage and compares it against each item's `timestamp`. The server
 * only ever reports what exists; it has no opinion about what you have already looked at.
 *
 * GRACEFUL DEGRADATION. Each source is wrapped so a missing or not-yet-migrated table (employee
 * reports arrived in 0019, applications in 0024 — either may be unapplied on a given database)
 * yields zero items rather than throwing and blanking the whole bell. Tasks (0001) are always
 * present. A source that errors is simply absent from the feed, logged server-side.
 */

export type NotificationKind = 'task' | 'report' | 'application'

export interface NotificationItem {
  /** Stable per source row, so the client can de-dupe and key without collisions across kinds. */
  id: string
  kind: NotificationKind
  title: string
  detail: string
  /** Where clicking the item takes the viewer — always a route they can actually open. */
  href: string
  /** ISO 8601. Drives ordering and the client's unread comparison. */
  timestamp: string
}

/** Per-source cap; the merged feed is capped separately so no single kind can crowd out the rest. */
const PER_SOURCE_LIMIT = 15
const FEED_LIMIT = 30

/**
 * Assembles the notifications relevant to `user`, newest first. Role decides which sources are
 * even consulted; RLS then decides which rows come back within each. Safe for any active user —
 * an ordinary employee simply gets their assigned tasks and nothing else.
 */
export async function getNotificationsFor(user: SessionUser): Promise<NotificationItem[]> {
  const isCeo = user.roleName === 'CEO'
  const isHr = user.departmentSlug === 'hr'

  const sources: Promise<NotificationItem[]>[] = [
    // Everyone: tasks currently assigned to me.
    safe(() => tasksAssignedToMe(user)),
    // Everyone with a department: unclaimed tasks landing in my department's queue — this is how
    // the Finance "set up salary disbursement" task from onboarding surfaces, and it covers every
    // department's unclaimed CEO-assigned work too. RLS decides whether a given viewer may see
    // unclaimed department rows; if not, this yields nothing.
    safe(() => unclaimedDepartmentTasks(user)),
  ]

  // The CEO reviews submitted reports and receives applications addressed to the CEO. A department
  // manager also sees their team's submitted reports (RLS returns them); an ordinary employee's
  // report query returns only their own, which we filter out — so this line is harmless for them.
  sources.push(safe(() => submittedReportsFeed(user)))

  if (isCeo) sources.push(safe(() => ceoApplicationsFeed()))
  if (isHr) sources.push(safe(() => hrApplicationsFeed()))

  const groups = await Promise.all(sources)
  const merged = groups.flat()

  merged.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
  return merged.slice(0, FEED_LIMIT)
}

/** Runs a source, swallowing any failure (missing table, RLS, transient) into an empty group. */
async function safe(fn: () => Promise<NotificationItem[]>): Promise<NotificationItem[]> {
  try {
    return await fn()
  } catch (err) {
    console.error('[notifications] source failed', err instanceof Error ? err.message : err)
    return []
  }
}

/** Open tasks assigned to the caller — the "you have work" feed every employee gets. */
async function tasksAssignedToMe(user: SessionUser): Promise<NotificationItem[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, priority, due_date, created_at, updated_at')
    .eq('assigned_user_id', user.id)
    .not('status', 'in', '(completed,archived)')
    .order('updated_at', { ascending: false })
    .limit(PER_SOURCE_LIMIT)
  if (error) throw new Error(error.message)

  const home = homeRouteFor(user)
  return (data ?? []).map((t) => ({
    id: `task:${t.id as string}`,
    kind: 'task' as const,
    title: 'Task assigned to you',
    detail: (t.title as string) ?? 'Untitled task',
    href: home,
    // updated_at moves when the task is delegated to you or its status changes, so it is the
    // closest signal to "when this became your concern"; created_at is the fallback.
    timestamp: (t.updated_at as string) ?? (t.created_at as string),
  }))
}

/**
 * Unclaimed tasks sitting in the caller's own department queue (assigned to the department, not yet
 * to a person). This is what surfaces the onboarding "set up salary disbursement" task to Finance,
 * and equally every department's unclaimed CEO-assigned work. Skipped for a user with no department
 * (e.g. the CEO, who has their own feeds). RLS on tasks decides who actually sees these rows — a
 * lead/manager does; if a plain member does not, the query simply returns nothing.
 */
async function unclaimedDepartmentTasks(user: SessionUser): Promise<NotificationItem[]> {
  if (!user.department_id) return []

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, created_at, updated_at')
    .eq('assigned_department_id', user.department_id)
    .is('assigned_user_id', null)
    .not('status', 'in', '(completed,archived)')
    .order('created_at', { ascending: false })
    .limit(PER_SOURCE_LIMIT)
  if (error) throw new Error(error.message)

  const home = homeRouteFor(user)
  return (data ?? []).map((t) => ({
    id: `task:${t.id as string}`,
    kind: 'task' as const,
    title: 'New task for your team',
    detail: (t.title as string) ?? 'Untitled task',
    href: home,
    timestamp: (t.created_at as string) ?? (t.updated_at as string),
  }))
}

/**
 * Submitted reports the caller is entitled to review. Own-authored reports are dropped — you are
 * not notified about your own submission — so an employee (who can only ever see their own) gets
 * an empty feed here, while a manager sees their team's and the CEO sees the organization's.
 */
async function submittedReportsFeed(user: SessionUser): Promise<NotificationItem[]> {
  const reports = await listSubmittedReports(user)
  const isCeo = user.roleName === 'CEO'
  // The CEO has a dedicated reports desk; anyone else lands on their own module home, which is the
  // one route we know they can open.
  const href = isCeo ? '/reports' : homeRouteFor(user)

  return reports
    .filter((r) => r.user_id !== user.id && r.submitted_at)
    .slice(0, PER_SOURCE_LIMIT)
    .map((r) => {
      const author = r.users?.full_name ?? 'An employee'
      return {
        id: `report:${r.id}`,
        kind: 'report' as const,
        title: 'Report submitted',
        detail: `${author} · ${r.period ?? 'report'}`,
        href,
        timestamp: r.submitted_at as string,
      }
    })
}

/** Applications addressed to the CEO (recipient 'ceo' or 'both'). */
async function ceoApplicationsFeed(): Promise<NotificationItem[]> {
  const apps = await listApplicationsForCeo()
  return apps.slice(0, PER_SOURCE_LIMIT).map((a) => ({
    id: `application:${a.id}`,
    kind: 'application' as const,
    title: 'New application',
    detail: `${a.employee?.full_name ?? 'An employee'} · ${a.subject}`,
    href: '/applications',
    timestamp: a.created_at,
  }))
}

/** Applications addressed to HR (recipient 'hr' or 'both'). */
async function hrApplicationsFeed(): Promise<NotificationItem[]> {
  const apps = await listApplicationsForHr()
  return apps.slice(0, PER_SOURCE_LIMIT).map((a) => ({
    id: `application:${a.id}`,
    kind: 'application' as const,
    title: 'New application',
    detail: `${a.employee?.full_name ?? 'An employee'} · ${a.subject}`,
    href: '/hr/applications',
    timestamp: a.created_at,
  }))
}
