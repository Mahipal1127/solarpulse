'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface MonthPoint {
  month: string
  value: number  // completion rate 0-100
  total: number
}

interface Props {
  data: MonthPoint[]
  currentRate: number
  totalTasks: number
  completedTasks: number
}

export function KPIPerformanceChart({ data, currentRate, totalTasks, completedTasks }: Props) {
  const hasData = totalTasks > 0
  const trend = data.length >= 2
    ? currentRate - (data[data.length - 2]?.value ?? currentRate)
    : 0

  return (
    <div className="dashboard-card flex flex-col justify-between p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-brand-slate uppercase tracking-wider">
          Task Completion Rate
        </h2>
        <span className="text-[10px] font-medium text-text-muted/60 bg-surface-bg border border-border-subtle rounded-lg px-2 py-1">
          Last 12 months
        </span>
      </div>

      <div className="mt-4 mb-2">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-extrabold text-brand-slate tracking-tight">
            {hasData ? `${currentRate}%` : '—'}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {hasData ? (
            <>
              <span className={`inline-flex items-center gap-0.5 rounded-md px-2 py-0.5 text-xs font-semibold border ${
                trend >= 0
                  ? 'bg-status-success/5 text-status-success border-status-success/15'
                  : 'bg-status-danger/5 text-status-danger border-status-danger/15'
              }`}>
                {trend >= 0 ? '+' : ''}{trend}%
              </span>
              <span className="text-xs text-text-muted/60">
                {completedTasks} of {totalTasks} tasks completed
              </span>
            </>
          ) : (
            <span className="text-xs text-text-muted/60">No tasks yet — create one to see trends</span>
          )}
        </div>
      </div>

      <div className="h-44 w-full mt-4">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <defs>
                {/*
                  One series, so the gradient runs gold to transparent rather than
                  between two hues — the old indigo-to-purple fade implied a second
                  variable that does not exist.
                */}
                <linearGradient id="kpiGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--brand-gold)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--brand-orange)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--chart-tooltip-bg)',
                  borderRadius: '12px',
                  border: 'none',
                  color: 'var(--chart-tooltip-text)',
                  fontSize: '12px',
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
                }}
                formatter={(val, _name, props) => [
                  `${val ?? 0}% (${(props?.payload as MonthPoint | undefined)?.total ?? 0} tasks)`,
                  'Completion',
                ]}
              />
              {/*
                Gold, per the token mapping for a primary data series. Worth knowing:
                gold on white is a low-contrast pairing (2.03:1), so this relies on
                being a 3px stroke over a tinted fill rather than fine detail. A
                thinner line in this colour would need brand-navy instead.
              */}
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--brand-gold)"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#kpiGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl bg-surface-bg border border-dashed border-border-subtle">
            <p className="text-xs text-text-muted/60 text-center px-4">
              Chart will populate as tasks are created and completed
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
