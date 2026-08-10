import type { ReactNode } from 'react'

/**
 * Flat and calm: a hairline border rather than a shadow. The page canvas is
 * `surface-bg` (off-white) and cards are `surface-card` (pure white), so the
 * surface change alone lifts a card off the page — a drop shadow on top of that
 * reads as clutter once there are eight of them on a dashboard.
 *
 * The border is a navy mix rather than a grey, so it sits in the same family as
 * the rest of the chrome instead of introducing an unrelated neutral.
 */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-border-subtle bg-surface-card ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  /**
   * Optional leading glyph, shown in a soft gold circle. For cards that are
   * genuinely an announcement or a notice — the AI briefing — not for every card,
   * since a circle on all of them spends the accent on nothing in particular.
   */
  icon?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
      <div className="flex items-start gap-3">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gold/10 text-brand-gold">
            {icon}
          </span>
        )}
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function Badge({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string
  description?: string
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon}
      <p className="text-sm font-medium text-brand-slate">{title}</p>
      {description && <p className="max-w-md text-xs text-text-muted">{description}</p>}
    </div>
  )
}

/**
 * Shown wherever a metric has no department module feeding it yet. Deliberately
 * distinct from a generic "no data" state — this says the pipe does not exist,
 * not that it is empty.
 */
export function AwaitingModule({ department, metric }: { department: string; metric: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-subtle bg-surface-bg px-6 py-10 text-center">
      <p className="text-sm font-medium text-brand-slate">Awaiting {department} module</p>
      <p className="text-xs text-text-muted">
        {metric} will populate once the {department} module ships.
      </p>
    </div>
  )
}

/**
 * Fills with the brand gradient. Progress is one of the few things in the app that
 * is genuinely about the brand rather than about status — a task 60% done is not
 * "warning" or "success", it is just underway — so the warm gradient belongs here
 * and the status palette does not.
 */
export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-bg">
      <div
        className="h-full rounded-full bg-brand-gradient transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'brand' | 'warning' | 'danger' | 'success'
  /**
   * Optional glyph beside the label, muted grey. Supporting/functional, not
   * decorative — it should say what the figure counts (people, folders, tickets).
   *
   * Deliberately no expand/open arrow here: a StatCard does not navigate anywhere,
   * and an arrow in the corner of something inert promises a click that does
   * nothing. The dashboard cards that *are* links carry that arrow instead.
   */
  icon?: ReactNode
}) {
  /**
   * 'default' is brand-slate, not gold. A dashboard is mostly default StatCards, and
   * a grid of large gold numbers would spend the accent on everything and so
   * highlight nothing. Gold is reserved for the figure a page is actually about,
   * which callers opt into with tone="brand".
   */
  const tones = {
    default: 'text-brand-slate',
    brand: 'text-brand-gold',
    warning: 'text-status-warning',
    danger: 'text-status-danger',
    success: 'text-status-success',
  }
  return (
    <Card className="px-5 py-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
        {icon && <span className="shrink-0 text-text-muted">{icon}</span>}
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </Card>
  )
}
