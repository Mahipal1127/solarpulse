import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPurchaseOrderOverdue, isDispatchRunningLate } from '@/lib/format'
import type {
  PurchaseOrder,
  MaterialDispatch,
  MaterialAllocation,
  MaterialReturn,
  Task,
} from '@/lib/types'

/**
 * Read-side aggregations for the Distribution dashboard.
 *
 * Every query here runs on the session client, so RLS decides which rows come
 * back — none of these functions takes a "which user" filter, because this module
 * has no per-employee tier: material movement is a shared department operation and
 * every Distribution member sees the same board. Adding an owner filter would move
 * an access decision into the frontend, and would mask a policy regression rather
 * than expose it.
 *
 * Overdue and running-late counts are computed here from the same helpers the
 * lists use, never read from a stored flag — there is no 'overdue' value in any of
 * this module's status enums by design.
 */

export interface PurchaseOrderSummary {
  total: number
  awaitingApproval: number
  awaitingApprovalValue: number
  approved: number
  ordered: number
  overdue: PurchaseOrder[]
  committedValue: number
  /**
   * Distinct orders that are either awaiting Finance or past their expected
   * delivery date, counted once each.
   *
   * These two sets overlap — an order can sit unapproved while its delivery date
   * passes, and isPurchaseOrderOverdue() rightly still calls that late. Adding the
   * two counts in a headline figure would show one order as two, so the union is
   * computed here where the rows are rather than in the page.
   */
  needingAttention: number
  recent: (PurchaseOrder & { vendor: { name: string } | null })[]
}

export async function getPurchaseOrderSummary(
  organizationId: string
): Promise<PurchaseOrderSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('purchase_orders')
    .select('*, vendor:vendors(name)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(500)

  const orders = (data ?? []) as unknown as (PurchaseOrder & { vendor: { name: string } | null })[]

  const awaiting = orders.filter((po) => po.status === 'pending_finance_approval')
  const overdue = orders.filter(isPurchaseOrderOverdue)

  return {
    total: orders.length,
    awaitingApproval: awaiting.length,
    awaitingApprovalValue: awaiting.reduce((sum, po) => sum + Number(po.total_amount), 0),
    approved: orders.filter((po) => po.status === 'approved').length,
    ordered: orders.filter(
      (po) => po.status === 'ordered' || po.status === 'partially_received'
    ).length,
    overdue,
    // Union, not a sum: an unapproved order whose delivery date has passed is in
    // both sets, and it is still one order needing one person's attention.
    needingAttention: new Set([...awaiting, ...overdue].map((po) => po.id)).size,
    // Approved and beyond only. A draft or an order still with Finance is not money
    // committed, and counting it would overstate what the department has spent.
    committedValue: orders
      .filter(
        (po) =>
          po.status !== 'draft' &&
          po.status !== 'pending_finance_approval' &&
          po.status !== 'cancelled'
      )
      .reduce((sum, po) => sum + Number(po.total_amount), 0),
    recent: orders.slice(0, 5),
  }
}

export interface DispatchSummary {
  preparing: number
  inTransit: number
  delivered: number
  cancelled: number
  runningLate: (MaterialDispatch & { lead: { name: string } | null })[]
  active: (MaterialDispatch & { lead: { name: string } | null })[]
}

export async function getDispatchSummary(organizationId: string): Promise<DispatchSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('material_dispatches')
    .select('*, lead:leads(name)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(500)

  const dispatches = (data ?? []) as unknown as (MaterialDispatch & {
    lead: { name: string } | null
  })[]

  return {
    preparing: dispatches.filter((d) => d.status === 'preparing').length,
    inTransit: dispatches.filter((d) => d.status === 'in_transit' || d.status === 'delayed').length,
    delivered: dispatches.filter((d) => d.status === 'delivered').length,
    cancelled: dispatches.filter((d) => d.status === 'cancelled').length,
    runningLate: dispatches.filter(isDispatchRunningLate),
    // What is on the road or about to be — the only rows worth a dashboard row,
    // since a delivered dispatch needs no attention.
    active: dispatches
      .filter((d) => d.status === 'preparing' || d.status === 'in_transit' || d.status === 'delayed')
      .slice(0, 8),
  }
}

export interface AllocationSummary {
  awaitingDispatch: number
  dispatched: number
  projectsWithPending: number
  /** Projects with material still to send, most-planned first. */
  pendingByProject: { leadId: string; project: string; items: number }[]
}

export async function getAllocationSummary(organizationId: string): Promise<AllocationSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('material_allocations')
    .select('*, lead:leads(id, name)')
    .eq('organization_id', organizationId)
    .limit(1000)

  const allocations = (data ?? []) as unknown as (MaterialAllocation & {
    lead: { id: string; name: string } | null
  })[]

  const pending = allocations.filter((a) => a.status === 'allocated')

  const byProject = new Map<string, { leadId: string; project: string; items: number }>()
  for (const row of pending) {
    const existing = byProject.get(row.lead_id)
    if (existing) {
      existing.items += 1
    } else {
      byProject.set(row.lead_id, {
        leadId: row.lead_id,
        // A missing name means RLS hid the lead — it is no longer closed-won. The
        // allocation is still real, so it is counted rather than dropped.
        project: row.lead?.name ?? 'Project not visible',
        items: 1,
      })
    }
  }

  return {
    awaitingDispatch: pending.length,
    dispatched: allocations.filter((a) => a.status === 'dispatched').length,
    projectsWithPending: byProject.size,
    pendingByProject: [...byProject.values()].sort((a, b) => b.items - a.items).slice(0, 6),
  }
}

export interface ReturnSummary {
  pending: number
  received: number
  damaged: number
  recent: (MaterialReturn & { lead: { name: string } | null })[]
}

export async function getReturnSummary(organizationId: string): Promise<ReturnSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('material_returns')
    .select('*, lead:leads(name)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(300)

  const returns = (data ?? []) as unknown as (MaterialReturn & {
    lead: { name: string } | null
  })[]

  return {
    pending: returns.filter((r) => r.status === 'pending').length,
    received: returns.filter((r) => r.status === 'received_by_store').length,
    damaged: returns.filter((r) => r.condition !== 'good').length,
    recent: returns.slice(0, 5),
  }
}

export type DepartmentTask = Task & {
  assignee: { full_name: string } | null
  creator: { full_name: string } | null
  department: { name: string } | null
}

/**
 * Tasks the CEO has assigned to this department, the same inbox the Sales
 * dashboard carries. Read from `tasks` rather than audit_logs — audit_logs is
 * CEO-read-only by policy, so a Distribution employee would get an empty panel
 * from it and never learn why.
 *
 * Selects creator and department as well as assignee so the rows satisfy
 * AssignedTask, which the shared inbox and task board both expect.
 */
export async function getDepartmentTasks(
  organizationId: string,
  departmentId: string | null
): Promise<DepartmentTask[]> {
  if (!departmentId) return []

  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('tasks')
    .select(
      '*, assignee:users!tasks_assigned_user_id_fkey(full_name), creator:users!tasks_created_by_fkey(full_name), department:departments!tasks_assigned_department_id_fkey(name)'
    )
    .eq('organization_id', organizationId)
    .eq('assigned_department_id', departmentId)
    .neq('status', 'archived')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(20)

  return (data ?? []) as unknown as DepartmentTask[]
}
