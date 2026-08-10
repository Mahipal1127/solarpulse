'use client'

import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip } from 'recharts'

interface DayPoint {
  day: string
  completed: number
  created: number
}

interface Props {
  data: DayPoint[]
  completedThisWeek: number
}

export function TimeWorkedChart({ data, completedThisWeek }: Props) {
  const hasActivity = data.some((d) => d.completed > 0 || d.created > 0)

  return (
    <div className="dashboard-card flex flex-col justify-between p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-brand-slate uppercase tracking-wider">
          Task Activity
        </h2>
        <span className="text-[10px] font-medium text-text-muted/60 bg-surface-bg border border-border-subtle rounded-lg px-2 py-1">
          This Week
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-extrabold text-brand-slate tracking-tight">
            {completedThisWeek}
          </span>
          <span className="text-sm text-text-muted/60">tasks completed</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {completedThisWeek > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-status-success/5 px-2 py-0.5 text-xs font-semibold text-status-success border border-status-success/15">
              Active week
            </span>
          ) : (
            <span className="text-xs text-text-muted/60">No completions yet this week</span>
          )}
        </div>
      </div>

      <div className="h-32 w-full mt-4">
        {hasActivity ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, left: -25, bottom: 0 }} barSize={8} barGap={3}>
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--chart-tooltip-bg)',
                  borderRadius: '12px',
                  border: 'none',
                  color: 'var(--chart-tooltip-text)',
                  fontSize: '12px',
                }}
                formatter={(val, name) => [val ?? 0, name === 'completed' ? 'Completed' : 'Created']}
              />
              {/*
                Muted series plus one highlight, per the design system: `created` is
                the supporting series and recedes to neutral grey, `completed` is what
                this card is about and carries a soft gold, and today's completed bar
                alone is solid gold.
                A neutral against a warm rather than two golds at different
                opacities — these two bars sit side by side for every day and have to
                be told apart, which a warm pair does poorly.
                `data` is built server-side, oldest-first, ending at today, so the
                last element is the current day. No date arithmetic here: doing it in
                render would be an impure call and would not survive lint.
              */}
              <Bar dataKey="created" fill="var(--chart-bar-muted)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completed" radius={[4, 4, 0, 0]}>
                {data.map((point, i) => (
                  <Cell
                    key={`${point.day}-${i}`}
                    fill={
                      i === data.length - 1
                        ? 'var(--chart-bar-highlight)'
                        : 'var(--chart-bar-soft)'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl bg-surface-bg border border-dashed border-border-subtle">
            <p className="text-xs text-text-muted/60">Activity will appear as tasks are worked on</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-text-muted/60 border-t border-border-subtle pt-2">
        {/*
          Swatches read the same custom properties as the <Cell> fills above rather
          than restating them as Tailwind classes. A legend that hardcodes its own
          colours drifts the first time a bar changes, which is exactly what happened
          here before — gold swatches over indigo bars.
        */}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: 'var(--chart-bar-muted)' }}
          />
          Created
          <span
            className="ml-2 inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: 'var(--chart-bar-soft)' }}
          />
          Completed
          <span
            className="ml-2 inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: 'var(--chart-bar-highlight)' }}
          />
          Today
        </span>
        <span className="font-semibold text-text-muted">
          {data.reduce((s, d) => s + d.created, 0)} total created
        </span>
      </div>
    </div>
  )
}
