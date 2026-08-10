import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
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

/** Leads the caller can see, newest first. */
export async function getVisibleLeads(organizationId: string): Promise<LeadRow[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('leads')
    .select(LEAD_SELECT)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(500)

  return (data ?? []) as unknown as LeadRow[]
}

/**
 * Pending follow-ups due today or already past due, soonest first.
 *
 * The cutoff is end of today rather than "scheduled_for = today", so a call
 * missed last Tuesday does not silently drop off the list once the day rolls
 * over — overdue work stays in front of whoever owns it.
 */
export async function getDueFollowUps(limit = 25): Promise<QueuedFollowUp[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('follow_ups')
    .select('*, lead:leads(id, name, assigned_to)')
    .eq('status', 'pending')
    .lte('scheduled_for', endOfTodayISO())
    .order('scheduled_for', { ascending: true })
    .limit(limit)

  return (data ?? []) as unknown as QueuedFollowUp[]
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
