import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { LEAD_OPEN_STAGES } from '@/lib/format'
import type { SalesTarget } from '@/lib/types'
import type { LeadRow } from '@/components/sales/LeadPipeline/LeadPipeline'
import type { QueuedFollowUp } from '@/components/sales/Dashboard/FollowUpQueue'
import type { TargetProgress } from '@/components/sales/Dashboard/TargetProgressCard'

/**
 * Read-side aggregations for the Sales dashboards.
 *
 * Every query here runs on the session client, so RLS decides the rows: an
 * executive gets their own, a manager gets the department's, from the exact same
 * code. None of these functions takes a "which user" filter for that reason —
 * adding one would move the access decision into the frontend, and would mask a
 * policy regression instead of surfacing it.
 *
 * The one exception is getTargetProgress, which takes a userId because a target
 * belongs to a specific person and the manager's team view has to ask about each
 * of them in turn.
 */

const LEAD_SELECT =
  'id, organization_id, name, phone, email, source, property_type, estimated_load_kw, status, assigned_to, assigned_by, notes, created_at, updated_at, assignee:users!leads_assigned_to_fkey(full_name)'

/** YYYY-MM-DD in the server's local zone, for comparing against date columns. */
function todayISODate(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Exclusive upper bound for "anything scheduled today or earlier". */
function endOfTodayISO(): string {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return end.toISOString()
}

/**
 * The row cap on the lead read.
 *
 * Named rather than inline so getSalesSummary can report whether it was hit — a
 * count computed in JS over a capped read describes what was read, and a figure that
 * silently understates the department's pipeline is worse than one that admits its
 * own limit.
 */
const LEAD_ROW_CAP = 500

/** Leads the caller can see, newest first. */
export async function getVisibleLeads(organizationId: string): Promise<LeadRow[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('leads')
    .select(LEAD_SELECT)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(LEAD_ROW_CAP)

  return (data ?? []) as unknown as LeadRow[]
}

/**
 * Pending follow-ups due today or already past due, soonest first.
 *
 * The cutoff is end of today rather than "scheduled_for = today", so a call
 * missed last Tuesday does not silently drop off the list once the day rolls
 * over — overdue work stays in front of whoever owns it.
 *
 * WHY ownerId EXISTS, GIVEN THE FILE HEADER SAYS THESE TAKE NO USER FILTER
 * Because the limit made the alternative wrong. The caller used to fetch the
 * soonest `limit` rows and then narrow them to "mine" in JS — and for a manager RLS
 * returns the whole department, so 25 colleagues' calls could fill the cap and leave
 * a manager's own queue rendering empty while their phone list was in fact full. A
 * personal to-do list that is silently empty is the worst possible failure for this
 * particular panel.
 *
 * So the narrowing has to happen before the limit, which means in SQL. This is a
 * display filter, not a permission: RLS has already decided which follow-ups exist
 * for this caller, and passing an ownerId can only ever narrow within that set. For
 * an executive it is a no-op, because sales_exec_own_follow_ups returned nothing but
 * their own rows anyway. Omit it and the behaviour is exactly as before.
 */
export async function getDueFollowUps(
  options: { limit?: number; ownerId?: string } = {}
): Promise<QueuedFollowUp[]> {
  const { limit = 25, ownerId } = options
  const supabase = await createSupabaseServerClient()

  /*
   * !inner is required to filter on the embedded lead: with a left join the
   * condition is applied after the fact and rows whose lead does not match come
   * back with lead = null rather than being excluded. It also drops any follow-up
   * whose parent lead RLS hid, which is the correct outcome — a follow-up with no
   * readable lead cannot be actioned and renders as "Lead unavailable".
   */
  const leadJoin = ownerId ? 'lead:leads!inner(id, name, assigned_to)' : 'lead:leads(id, name, assigned_to)'

  let query = supabase
    .from('follow_ups')
    .select(`*, ${leadJoin}`)
    .eq('status', 'pending')
    .lte('scheduled_for', endOfTodayISO())

  if (ownerId) query = query.eq('lead.assigned_to', ownerId)

  const { data } = await query.order('scheduled_for', { ascending: true }).limit(limit)

  return (data ?? []) as unknown as QueuedFollowUp[]
}

/**
 * How many pending follow-ups are due, and how many of those are already overdue.
 *
 * A count query rather than a slice of getDueFollowUps(), because the stat card and
 * the list answer different questions: the list shows the next 25 to work through,
 * the card states how many there are. Deriving the card from the list's length would
 * make it stop counting at 25 and read as "25 due" forever.
 *
 * `head: true` fetches no rows at all — Postgres answers from the index, so this
 * stays cheap even when the real number is in the thousands.
 */
export async function getDueFollowUpCounts(
  ownerId?: string
): Promise<{ due: number; overdue: number }> {
  const supabase = await createSupabaseServerClient()
  const nowISO = new Date().toISOString()

  const base = () => {
    let q = supabase
      .from('follow_ups')
      .select(ownerId ? 'id, lead:leads!inner(assigned_to)' : 'id', {
        count: 'exact',
        head: true,
      })
      .eq('status', 'pending')
    if (ownerId) q = q.eq('lead.assigned_to', ownerId)
    return q
  }

  const [dueResult, overdueResult] = await Promise.all([
    base().lte('scheduled_for', endOfTodayISO()),
    // Overdue is "scheduled before now", the same rule isFollowUpOverdue() applies
    // to a row in the list. Kept in step deliberately: the card and the red left
    // border on each row must not disagree about what counts as late.
    base().lt('scheduled_for', nowISO),
  ])

  return { due: dueResult.count ?? 0, overdue: overdueResult.count ?? 0 }
}

/**
 * The target covering today for one employee, plus what they have actually
 * closed inside it.
 *
 * Attribution is by closed_by, not by the lead's current owner: if a lead is
 * reassigned after closing, the person who closed it keeps the credit. That also
 * matches the (closed_by, closed_at) index the schema already carries.
 *
 * Returns null when no target covers today — an employee with no target set is
 * the normal state early on, not an error.
 */
export async function getTargetProgress(userId: string): Promise<TargetProgress | null> {
  const supabase = await createSupabaseServerClient()
  const today = todayISODate()

  const { data: targetData } = await supabase
    .from('sales_targets')
    .select('*')
    .eq('user_id', userId)
    .lte('period_start', today)
    .gte('period_end', today)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!targetData) return null
  const target = targetData as SalesTarget

  // period_end is a date and closed_at an instant, so the upper bound is the day
  // after — a deal closed at 18:00 on the final day still counts.
  const dayAfterEnd = new Date(`${target.period_end}T00:00:00`)
  dayAfterEnd.setDate(dayAfterEnd.getDate() + 1)

  const { data: closureData } = await supabase
    .from('deal_closures')
    .select('final_amount')
    .eq('closed_by', userId)
    .gte('closed_at', `${target.period_start}T00:00:00`)
    .lt('closed_at', dayAfterEnd.toISOString())

  const closures = (closureData ?? []) as { final_amount: number }[]

  return {
    target,
    achievedAmount: closures.reduce((sum, c) => sum + Number(c.final_amount), 0),
    achievedDeals: closures.length,
  }
}

/**
 * getTargetProgress for a whole roster, in two queries instead of two per person.
 *
 * The team view previously called getTargetProgress() inside a Promise.all over every
 * employee — 2 round trips each, so a ten-person Sales department opened twenty
 * connections to render one card grid. The comment there said "the roster is small,
 * and if it outgrows that this becomes one grouped query". This is that query.
 *
 * Returns a Map keyed by user id, with null for anyone who has no target covering
 * today. Callers iterate their own employee list so the card order stays the roster
 * order rather than whatever Postgres returned.
 */
export async function getTeamTargetProgress(
  userIds: string[]
): Promise<Map<string, TargetProgress | null>> {
  const result = new Map<string, TargetProgress | null>()
  for (const id of userIds) result.set(id, null)
  if (userIds.length === 0) return result

  const supabase = await createSupabaseServerClient()
  const today = todayISODate()

  const { data: targetData } = await supabase
    .from('sales_targets')
    .select('*')
    .in('user_id', userIds)
    .lte('period_start', today)
    .gte('period_end', today)
    .order('period_start', { ascending: false })

  const targets = (targetData ?? []) as SalesTarget[]
  if (targets.length === 0) return result

  /*
   * First wins per user. The query is period_start descending, so that is the most
   * recently started target covering today — identical to the .limit(1) the
   * single-user version uses. Overlapping targets for one person are not supposed to
   * exist, but if they do, both functions pick the same one.
   */
  const targetFor = new Map<string, SalesTarget>()
  for (const target of targets) {
    if (!targetFor.has(target.user_id)) targetFor.set(target.user_id, target)
  }

  /*
   * One closures read spanning every target's period, then split per person in
   * memory. Each employee can have a different period, so the query takes the widest
   * window and the per-person filter below re-applies their own bounds — fetching
   * slightly more than needed once beats a query per employee.
   */
  const starts = [...targetFor.values()].map((t) => t.period_start).sort()
  const ends = [...targetFor.values()].map((t) => t.period_end).sort()
  const widestStart = starts[0]
  const dayAfterWidestEnd = new Date(`${ends[ends.length - 1]}T00:00:00`)
  dayAfterWidestEnd.setDate(dayAfterWidestEnd.getDate() + 1)

  const { data: closureData } = await supabase
    .from('deal_closures')
    .select('closed_by, final_amount, closed_at')
    .in('closed_by', [...targetFor.keys()])
    .gte('closed_at', `${widestStart}T00:00:00`)
    .lt('closed_at', dayAfterWidestEnd.toISOString())

  const closures = (closureData ?? []) as {
    closed_by: string
    final_amount: number | string
    closed_at: string
  }[]

  for (const [userId, target] of targetFor) {
    // period_end is a date and closed_at an instant, so the upper bound is the day
    // after — matching getTargetProgress exactly.
    const upper = new Date(`${target.period_end}T00:00:00`)
    upper.setDate(upper.getDate() + 1)
    const lower = new Date(`${target.period_start}T00:00:00`)

    const mine = closures.filter((c) => {
      if (c.closed_by !== userId) return false
      const at = new Date(c.closed_at).getTime()
      return at >= lower.getTime() && at < upper.getTime()
    })

    result.set(userId, {
      target,
      achievedAmount: mine.reduce((sum, c) => sum + Number(c.final_amount), 0),
      achievedDeals: mine.length,
    })
  }

  return result
}

export interface SalesSummary {
  /** Every lead RLS returned. Views over this array, never extra queries. */
  all: LeadRow[]
  total: number
  open: number
  won: number
  lost: number
  unassigned: number
  /** Open leads sitting in 'negotiation' — the stage that goes stale unchased. */
  inNegotiation: number
  /** Value closed since the first of this month, and how many deals. */
  revenueThisMonth: number
  dealsThisMonth: number
  /** True when the lead read hit its cap, so the counts describe a partial set. */
  capped: boolean
}

/**
 * Department-level Sales figures, from one lead read plus one closures read.
 *
 * Exists so the CEO's drill-down and the department's own dashboard cannot disagree:
 * both call this. That mattered here because the drill-down previously derived
 * nothing at all — it rendered ten lead rows and no counts, so "how is Sales doing"
 * had no answer on the CEO's side of the app.
 *
 * RLS scopes it: a manager gets the department, the CEO gets the organisation, an
 * executive gets their own rows. The same function therefore describes "the
 * department" or "my pipeline" depending on who asks, which is why the caller labels
 * the figures rather than this function.
 */
export async function getSalesSummary(organizationId: string): Promise<SalesSummary> {
  const supabase = await createSupabaseServerClient()

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const [leads, { data: closureData }] = await Promise.all([
    getVisibleLeads(organizationId),
    supabase
      .from('deal_closures')
      .select('final_amount')
      .gte('closed_at', startOfMonth.toISOString()),
  ])

  const closures = (closureData ?? []) as { final_amount: number | string }[]
  const open = leads.filter((l) => LEAD_OPEN_STAGES.includes(l.status))

  return {
    all: leads,
    total: leads.length,
    open: open.length,
    won: leads.filter((l) => l.status === 'won').length,
    lost: leads.filter((l) => l.status === 'lost').length,
    unassigned: leads.filter((l) => l.assigned_to === null).length,
    inNegotiation: leads.filter((l) => l.status === 'negotiation').length,
    // numeric(14,2) arrives as a string from supabase-js, so Number() is required
    // before adding — bare + would concatenate.
    revenueThisMonth: closures.reduce((sum, c) => sum + Number(c.final_amount), 0),
    dealsThisMonth: closures.length,
    capped: leads.length === LEAD_ROW_CAP,
  }
}

export interface ActivityEntry {
  id: string
  at: string
  kind: 'quotation' | 'proposal' | 'closure' | 'follow_up'
  summary: string
  leadId: string | null
  leadName: string | null
  amount: number | null
}

/**
 * Recent movement on the caller's leads, assembled from the sales tables rather
 * than from audit_logs — audit_logs is CEO-read-only by policy, so a Sales
 * executive would get an empty feed from it and never know why.
 *
 * Each source query is bounded and the merge happens in memory: four small
 * indexed reads beat one union view that RLS would have to re-derive per branch.
 */
export async function getRecentActivity(limit = 12): Promise<ActivityEntry[]> {
  const supabase = await createSupabaseServerClient()

  const [{ data: quotations }, { data: proposals }, { data: closures }, { data: followUps }] =
    await Promise.all([
      supabase
        .from('quotations')
        .select('id, amount, status, created_at, lead:leads(id, name)')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('proposals')
        .select('id, amount, status, created_at, lead:leads(id, name)')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('deal_closures')
        .select('id, final_amount, closed_at, lead:leads(id, name)')
        .order('closed_at', { ascending: false })
        .limit(limit),
      supabase
        .from('follow_ups')
        .select('id, type, status, completed_at, lead:leads(id, name)')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(limit),
    ])

  type LeadRef = { id: string; name: string } | null

  const entries: ActivityEntry[] = [
    ...((quotations ?? []) as unknown as {
      id: string
      amount: number
      status: string
      created_at: string
      lead: LeadRef
    }[]).map((q) => ({
      id: `quotation-${q.id}`,
      at: q.created_at,
      kind: 'quotation' as const,
      summary: q.status === 'draft' ? 'Quotation drafted' : `Quotation ${q.status}`,
      leadId: q.lead?.id ?? null,
      leadName: q.lead?.name ?? null,
      amount: Number(q.amount),
    })),

    ...((proposals ?? []) as unknown as {
      id: string
      amount: number
      status: string
      created_at: string
      lead: LeadRef
    }[]).map((p) => ({
      id: `proposal-${p.id}`,
      at: p.created_at,
      kind: 'proposal' as const,
      summary: p.status === 'draft' ? 'Proposal drafted' : `Proposal ${p.status}`,
      leadId: p.lead?.id ?? null,
      leadName: p.lead?.name ?? null,
      amount: Number(p.amount),
    })),

    ...((closures ?? []) as unknown as {
      id: string
      final_amount: number
      closed_at: string
      lead: LeadRef
    }[]).map((c) => ({
      id: `closure-${c.id}`,
      at: c.closed_at,
      kind: 'closure' as const,
      summary: 'Deal won',
      leadId: c.lead?.id ?? null,
      leadName: c.lead?.name ?? null,
      amount: Number(c.final_amount),
    })),

    ...((followUps ?? []) as unknown as {
      id: string
      type: string
      completed_at: string
      lead: LeadRef
    }[]).map((f) => ({
      id: `follow-up-${f.id}`,
      at: f.completed_at,
      kind: 'follow_up' as const,
      summary: `${f.type.replace(/_/g, ' ')} completed`,
      leadId: f.lead?.id ?? null,
      leadName: f.lead?.name ?? null,
      amount: null,
    })),
  ]

  return entries
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
}
