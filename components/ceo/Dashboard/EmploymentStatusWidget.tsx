'use client'

interface TaskStats {
  total: number
  pending: number
  inProgress: number
  delayed: number
  completed: number
  overdue: number
}

interface DeptOverdue {
  name: string
  count: number
}

interface Props {
  taskStats: TaskStats
  topDeptOverdue: DeptOverdue[]
  maxOverdue: number
}

const SEGMENTS = [
  { key: 'completed', label: 'Completed', color: 'bg-brand-gradient', dot: 'bg-brand-gold' },
  { key: 'inProgress', label: 'In Progress', color: 'bg-brand-gradient', dot: 'bg-status-success' },
  { key: 'pending', label: 'Pending', color: 'bg-brand-gradient', dot: 'bg-status-warning/70' },
  { key: 'delayed', label: 'Delayed', color: 'bg-brand-gradient', dot: 'bg-status-danger' },
] as const

export function EmploymentStatusWidget({ taskStats, topDeptOverdue, maxOverdue }: Props) {
  const total = taskStats.total || 1 // avoid divide-by-zero

  const pct = (n: number) => Math.max(4, Math.round((n / total) * 100)) // min 4% so thin bars show

  return (
    <div className="dashboard-card flex flex-col justify-between p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-brand-slate uppercase tracking-wider">
          Task Status
        </h2>
        <span className="text-[11px] text-text-muted/60 font-medium">{taskStats.total} total</span>
      </div>

      {/* Stacked progress bar */}
      <div className="my-6">
        {taskStats.total === 0 ? (
          <div className="flex h-10 w-full items-center justify-center rounded-2xl bg-surface-bg text-xs text-text-muted/60">
            No tasks yet
          </div>
        ) : (
          <div className="flex h-10 w-full items-center gap-1 overflow-hidden rounded-2xl bg-surface-bg p-1">
            {SEGMENTS.map(({ key, color }) => {
              const count = taskStats[key]
              if (count === 0) return null
              return (
                <div
                  key={key}
                  className={`flex h-full items-center justify-center rounded-xl bg-gradient-to-r ${color} transition-all shadow-sm`}
                  style={{ width: `${pct(count)}%` }}
                />
              )
            })}
          </div>
        )}
        <div className="mt-2 flex justify-between px-1 text-[11px] font-semibold text-text-muted/60">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Legend grid */}
      <div className="grid grid-cols-2 gap-3 border-t border-border-subtle pt-4">
        {SEGMENTS.map(({ key, label, dot }) => {
          const count = taskStats[key]
          const rate = taskStats.total > 0 ? Math.round((count / taskStats.total) * 100) : 0
          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-md ${dot} shrink-0`} />
                <span className="text-[11px] font-medium text-text-muted truncate">{label}</span>
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-xl font-bold text-brand-slate leading-none">{count}</span>
                <span className="text-[10px] font-semibold text-text-muted/60">{rate}%</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Dept overdue section */}
      {topDeptOverdue.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-4">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">
            Overdue by Department
          </p>
          <div className="space-y-2">
            {topDeptOverdue.map((dept) => (
              <div key={dept.name} className="flex items-center gap-2">
                <span className="w-20 text-[11px] text-text-muted font-medium truncate shrink-0">
                  {dept.name}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-surface-bg overflow-hidden">
                  <div
                    className="h-full rounded-full bg-status-danger/70 transition-all"
                    style={{ width: `${Math.round((dept.count / maxOverdue) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-status-danger w-4 text-right shrink-0">
                  {dept.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
