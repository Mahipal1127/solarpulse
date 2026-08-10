'use client'

import { useState } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { AwaitingModule } from '@/components/ui/primitives'
import { tabClass } from '@/components/shared/chrome'
import type {
  RevenueSnapshot,
  AttendanceSnapshot,
  SalesTrendPoint,
  ProjectPortfolio,
} from '@/lib/departments/contracts'
import type { PendingDataSource } from '@/lib/types'

interface Props {
  taskStats: {
    total: number
    pending: number
    inProgress: number
    delayed: number
    completed: number
    overdue: number
  }
  priorityBreakdown: { urgent: number; high: number; medium: number; low: number }
  topDelayed: { name: string; count: number }[]
  revenueSnapshot: RevenueSnapshot | null
  attendance: AttendanceSnapshot | null
  salesTrend: SalesTrendPoint[] | null
  projectPortfolio: ProjectPortfolio | null
  pendingSources: Record<string, PendingDataSource>
}

const TABS = ['Tasks', 'Sales', 'Finance', 'Projects'] as const
type Tab = (typeof TABS)[number]

const TAB_ICONS: Record<Tab, string> = {
  Tasks: '📋', Sales: '📈', Finance: '💰', Projects: '🏗️',
}

/*
 * Status and priority hues come from the locked palette, via the same custom
 * properties the rest of the app uses. These were Tailwind-default indigo, emerald
 * and rose literals — a second palette living alongside the real one, which is how
 * the same "delayed" state ended up a different orange here than in a status badge
 * two screens away.
 *
 * The meanings are unchanged: only the hex behind each meaning moves onto the token.
 */
const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--neutral-text-muted)',
  inProgress: 'var(--status-info)',
  delayed: 'var(--status-warning)',
  overdue: 'var(--status-danger)',
  completed: 'var(--status-success)',
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--status-danger)',
  high: 'var(--status-warning)',
  medium: 'var(--status-info)',
  low: 'var(--neutral-text-muted)',
}

export function AnalyticsTabs({
  taskStats,
  priorityBreakdown,
  topDelayed,
  revenueSnapshot,
  attendance,
  salesTrend,
  projectPortfolio,
  pendingSources,
}: Props) {
  const [tab, setTab] = useState<Tab>('Tasks')

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      {/* Tab bar */}
      {/*
        Underline tabs rather than pills: this strip sits on the card's own top edge,
        where a filled pill would collide with the border already drawn there.
      */}
      <div className="flex gap-1 border-b border-border-subtle px-3 pt-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'true' : undefined}
            className={`flex items-center gap-1.5 ${tabClass(tab === t)}`}
          >
            <span>{TAB_ICONS[t]}</span>
            {t}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'Tasks' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartBox title="Status Breakdown">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Pending', value: taskStats.pending, key: 'pending' },
                      { name: 'In Progress', value: taskStats.inProgress, key: 'inProgress' },
                      { name: 'Delayed', value: taskStats.delayed, key: 'delayed' },
                      { name: 'Overdue', value: taskStats.overdue, key: 'overdue' },
                      { name: 'Completed', value: taskStats.completed, key: 'completed' },
                    ].filter((d) => d.value > 0)}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={85}
                    paddingAngle={3} dataKey="value"
                  >
                    {['pending', 'inProgress', 'delayed', 'overdue', 'completed']
                      .filter((k) => (taskStats as Record<string, number>)[k] > 0)
                      .map((k) => <Cell key={k} fill={STATUS_COLORS[k]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} tasks`, '']} />
                  <Legend iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </ChartBox>

            <ChartBox title="Priority Breakdown">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={[
                    { name: 'Urgent', value: priorityBreakdown.urgent },
                    { name: 'High',   value: priorityBreakdown.high },
                    { name: 'Medium', value: priorityBreakdown.medium },
                    { name: 'Low',    value: priorityBreakdown.low },
                  ]}
                  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                >
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} tasks`, 'Count']} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {['urgent', 'high', 'medium', 'low'].map((k) => (
                      <Cell key={k} fill={PRIORITY_COLORS[k]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartBox>

            {topDelayed.length > 0 && (
              <ChartBox title="Overdue by Department" className="lg:col-span-2">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={topDelayed.map((d) => ({ name: d.name, overdue: d.count }))}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 80 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} tasks`, 'Overdue']} />
                    {/*
                      The reference's mute-all-but-one pattern, with the highlight in
                      danger rather than gold. `topDelayed` arrives sorted worst-first,
                      so index 0 is the department to look at.

                      Gold would be the literal reading of the design system, but gold
                      means "active / primary / current" everywhere else in the app, and
                      the worst overdue backlog is not a thing to celebrate. The system
                      also says status colours keep their meanings and only the
                      pattern is adopted — so the pattern is here and the semantics win
                      on colour.
                    */}
                    <Bar dataKey="overdue" radius={[0, 6, 6, 0]}>
                      {topDelayed.map((d, i) => (
                        <Cell
                          key={`${d.name}-${i}`}
                          fill={i === 0 ? 'var(--status-danger)' : 'var(--chart-bar-muted)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartBox>
            )}
          </div>
        )}

        {tab === 'Sales' && (
          salesTrend ? (
            <ChartBox title="Monthly Sales Trend">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={salesTrend} margin={{ top: 4, right: 16, bottom: 0, left: -10 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconSize={8} />
                  {/*
                    Muted series plus one highlight: orders recede to neutral, revenue
                    carries soft gold, and the most recent month is solid gold. The
                    series arrives oldest-first, so the last element is current.
                  */}
                  <Bar dataKey="ordersWon" name="Orders Won" fill="var(--chart-bar-muted)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="revenue" name="Revenue (₹)" radius={[4, 4, 0, 0]}>
                    {salesTrend.map((point, i) => (
                      <Cell
                        key={`${point.month}-${i}`}
                        fill={
                          i === salesTrend.length - 1
                            ? 'var(--chart-bar-highlight)'
                            : 'var(--chart-bar-soft)'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartBox>
          ) : (
            <AwaitingModule department={pendingSources.salesTrend.awaitingDepartment} metric={pendingSources.salesTrend.metric} />
          )
        )}

        {tab === 'Finance' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {revenueSnapshot ? (
              <>
                <StatBox label="Month-to-Date Revenue" value={`₹${revenueSnapshot.monthToDate.toLocaleString('en-IN')}`} sub={`Previous: ₹${revenueSnapshot.previousMonth.toLocaleString('en-IN')}`} />
                {attendance
                  ? <StatBox label={`Attendance — ${attendance.date}`} value={`${attendance.percentPresent.toFixed(1)}%`} sub={`${attendance.presentCount} of ${attendance.totalCount} present`} />
                  : <AwaitingModule department={pendingSources.attendance.awaitingDepartment} metric={pendingSources.attendance.metric} />}
              </>
            ) : (
              <div className="sm:col-span-2">
                <AwaitingModule department={pendingSources.revenue.awaitingDepartment} metric={pendingSources.revenue.metric} />
              </div>
            )}
          </div>
        )}

        {tab === 'Projects' && (
          projectPortfolio ? (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Active',    value: projectPortfolio.active,    color: 'text-brand-slate',  bg: 'bg-brand-gold/10' },
                { label: 'Pending',   value: projectPortfolio.pending,   color: 'text-status-warning',   bg: 'bg-status-warning/5' },
                { label: 'Completed', value: projectPortfolio.completed, color: 'text-status-success', bg: 'bg-status-success/5' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className={`rounded-xl ${bg} px-5 py-6 text-center`}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
                  <p className={`mt-2 text-4xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          ) : (
            <AwaitingModule department={pendingSources.projects.awaitingDepartment} metric={pendingSources.projects.metric} />
          )
        )}
      </div>
    </div>
  )
}

/**
 * Dark tooltip on a light chart, matching the other two dashboard charts: a white
 * tooltip over white cards needs a border to exist at all, where a dark panel reads
 * instantly as an overlay. brand-slate rather than black, and rather than navy —
 * navy is a reserved token and must not back anything.
 */
const tooltipStyle = {
  backgroundColor: 'var(--chart-tooltip-bg)',
  color: 'var(--chart-tooltip-text)',
  borderRadius: '12px',
  border: 'none',
  fontSize: '12px',
}

function ChartBox({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border-subtle bg-surface-bg p-4 ${className}`}>
      <p className="mb-3 text-sm font-semibold text-text-muted">{title}</p>
      {children}
    </div>
  )
}

function StatBox({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-bg p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold text-brand-slate">{value}</p>
      <p className="mt-1 text-sm text-text-muted">{sub}</p>
    </div>
  )
}
