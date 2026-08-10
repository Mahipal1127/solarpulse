import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, StatCard, ProgressBar, EmptyState } from '@/components/ui/primitives'
import { TargetForm } from '@/components/sales/Reports/TargetForm'
import { getSalesEmployees } from '@/lib/sales/queries'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'
import {
  formatCurrency,
  formatDate,
  LEAD_PIPELINE_ORDER,
  LEAD_OPEN_STAGES,
  LEAD_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
} from '@/lib/format'
import type { LeadStatus, SalesTarget } from '@/lib/types'

export const dynamic = 'force-dynamic'

type TargetRow = SalesTarget & { employee: { full_name: string } | null }

export default async function SalesReportsPage() {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  const canSetTargets = isSalesManager(user) || user.roleName === 'CEO'

  const supabase = await createSupabaseServerClient()

  // Every read here is RLS-scoped, so this same page is a personal report for an
  // executive and a department report for a manager. No role branch decides the
  // numbers — only whether the target form renders.
  const [
    { data: leadData },
    { data: closureData },
    { data: quotationData },
    { data: targetData },
    employees,
  ] = await Promise.all([
    supabase.from('leads').select('status, source, estimated_load_kw').limit(2000),
    supabase.from('deal_closures').select('final_amount, closed_at, closed_by').limit(2000),
    supabase.from('quotations').select('id, amount, status').limit(2000),
    supabase
      .from('sales_targets')
      .select('*, employee:users!sales_targets_user_id_fkey(full_name)')
      .order('period_start', { ascending: false })
      .limit(100),
    canSetTargets ? getSalesEmployees(user.organization_id) : Promise.resolve([]),
  ])

  const leads = (leadData ?? []) as {
    status: LeadStatus
    source: string | null
    estimated_load_kw: number | null
  }[]
  const closures = (closureData ?? []) as {
    final_amount: number
    closed_at: string
    closed_by: string
  }[]
  const quotations = (quotationData ?? []) as { id: string; amount: number; status: string }[]
  const targets = (targetData ?? []) as unknown as TargetRow[]

  const wonCount = leads.filter((l) => l.status === 'won').length
  const lostCount = leads.filter((l) => l.status === 'lost').length
  const openCount = leads.filter((l) => LEAD_OPEN_STAGES.includes(l.status)).length

  // Only decided leads belong in a conversion rate. Counting still-open leads as
  // losses would make the number drift down every time someone adds a lead.
  const decided = wonCount + lostCount
  const conversionRate = decided > 0 ? (wonCount / decided) * 100 : null

  const closedValue = closures.reduce((sum, c) => sum + Number(c.final_amount), 0)
  const averageDeal = closures.length > 0 ? closedValue / closures.length : 0

  const quotedValue = quotations
    .filter((q) => q.status !== 'rejected' && q.status !== 'expired')
    .reduce((sum, q) => sum + Number(q.amount), 0)

  const funnel = LEAD_PIPELINE_ORDER.map((stage) => ({
    stage,
    count: leads.filter((l) => l.status === stage).length,
  }))
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count))

  const bySource = groupBySource(leads)

  // Achieved-per-target computed from the one closures read above rather than a
  // query per row. Attribution is by closed_by, so credit stays with whoever
  // closed the deal even if the lead is reassigned afterwards.
  //
  // Compared as instants, not as strings: period_end is a date while closed_at is
  // a timestamptz, so the bound is the start of the following day — a deal closed
  // at 18:00 on the final day still counts.
  const targetRows = targets.map((target) => {
    const from = new Date(`${target.period_start}T00:00:00`).getTime()
    const until = new Date(`${target.period_end}T00:00:00`)
    until.setDate(until.getDate() + 1)
    const untilMs = until.getTime()

    const matching = closures.filter((c) => {
      if (c.closed_by !== target.user_id) return false
      const at = new Date(c.closed_at).getTime()
      return at >= from && at < untilMs
    })

    const achieved = matching.reduce((sum, c) => sum + Number(c.final_amount), 0)
    return { target, achieved, deals: matching.length }
  })

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Reports</h1>
        <p className="mt-1 text-sm text-text-muted">
          {canSetTargets
            ? "The department's numbers, and the targets behind them."
            : 'Your numbers. Targets are set by your Sales Manager and shown read-only.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Closed Value" value={formatCurrency(closedValue)} tone="success" />
        <StatCard
          label="Deals Won"
          value={wonCount}
          hint={`${closures.length} closure record${closures.length === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Conversion Rate"
          value={conversionRate === null ? '—' : `${Math.round(conversionRate)}%`}
          hint={
            conversionRate === null
              ? 'No decided leads yet'
              : `${wonCount} won of ${decided} decided`
          }
        />
        <StatCard
          label="Average Deal"
          value={closures.length > 0 ? formatCurrency(averageDeal) : '—'}
          hint={`${openCount} leads still open`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Pipeline funnel"
            subtitle="Where every lead currently sits, won and lost included"
          />
          <div className="space-y-3 px-5 py-4">
            {funnel.map(({ stage, count }) => (
              <div key={stage}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-text-muted">{LEAD_STATUS_LABELS[stage]}</span>
                  <span className="text-text-muted">{count}</span>
                </div>
                <div className="mt-1">
                  <ProgressBar value={(count / funnelMax) * 100} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Leads by source"
            subtitle="Which channels are actually producing"
          />
          {bySource.length === 0 ? (
            <EmptyState
              title="No leads recorded yet"
              description="Source is optional on a lead, so this fills in as the team records it."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {bySource.map(({ source, count, won }) => (
                <li key={source} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-brand-slate">
                    {LEAD_SOURCE_LABELS[source] ?? source}
                  </span>
                  <span className="text-xs text-text-muted">
                    {count} lead{count === 1 ? '' : 's'}
                    {won > 0 && <span className="font-medium text-status-success"> · {won} won</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Quoted pipeline value
            </p>
            <p className="mt-1 text-xl font-semibold text-brand-slate">
              {formatCurrency(quotedValue)}
            </p>
          </div>
          <p className="max-w-md text-xs text-text-muted">
            Sum of live quotations — rejected and expired excluded. Not revenue: a quotation is what
            was offered, not what was agreed.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Sales targets"
          subtitle={
            canSetTargets
              ? 'One target per employee per period. Achievement follows whoever closed the deal.'
              : 'Set by your Sales Manager or the CEO. Read-only here.'
          }
          action={canSetTargets ? <TargetForm employees={employees} /> : undefined}
        />

        {targetRows.length === 0 ? (
          <EmptyState
            title="No targets set"
            description={
              canSetTargets
                ? 'Set a target for an employee to start tracking achievement against it.'
                : 'Once your manager sets a target for the period it appears here with your progress.'
            }
          />
        ) : (
          <div className="divide-y divide-border-subtle">
            {targetRows.map(({ target, achieved, deals }) => {
              const pct =
                target.target_amount > 0 ? (achieved / target.target_amount) * 100 : 0
              const met = achieved >= target.target_amount

              return (
                <div key={target.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-brand-slate">
                        {target.employee?.full_name ?? 'Unknown employee'}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {formatDate(target.period_start)} — {formatDate(target.period_end)}
                        {target.target_deals !== null &&
                          ` · ${deals}/${target.target_deals} deals`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-brand-slate">
                        {formatCurrency(achieved)}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        of {formatCurrency(target.target_amount)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="flex-1">
                      <ProgressBar value={pct} />
                    </div>
                    <span
                      className={`w-10 shrink-0 text-right text-xs font-semibold ${
                        met ? 'text-status-success' : 'text-text-muted'
                      }`}
                    >
                      {Math.round(pct)}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function groupBySource(
  leads: { status: LeadStatus; source: string | null }[]
): { source: string; count: number; won: number }[] {
  const map = new Map<string, { count: number; won: number }>()

  for (const lead of leads) {
    const key = lead.source ?? 'unrecorded'
    const entry = map.get(key) ?? { count: 0, won: 0 }
    entry.count += 1
    if (lead.status === 'won') entry.won += 1
    map.set(key, entry)
  }

  return [...map.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.count - a.count)
}
