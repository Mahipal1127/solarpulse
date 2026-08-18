import { EmptyState } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'

export type TimelineEntry = {
  id: string
  label: string
  note: string | null
  created_at: string
  author: { full_name: string } | null
}

/**
 * The append-only status history, newest first — the audit trail behind the aging
 * clock. Each transition shows what it moved to, who moved it, when, and any note.
 * This is the "where has this case been, and for how long at each step" story the
 * module exists to tell, so it sits on every case detail page.
 *
 * `openedAt` is the case's created_at: before any real transition, a case has been
 * sitting in its initial status since it was created, and the timeline says so
 * rather than looking empty.
 */
export function StatusTimeline({
  entries,
  openedAt,
}: {
  entries: TimelineEntry[]
  openedAt: string
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No status changes yet"
        description={`Opened ${formatDateTime(openedAt)}. Status changes will appear here as the case moves.`}
      />
    )
  }

  return (
    <ol className="relative space-y-4 pl-6">
      <span className="absolute left-[7px] top-1 h-[calc(100%-0.5rem)] w-px bg-border-subtle" aria-hidden />
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-brand-gold bg-surface-card" aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-brand-slate">{entry.label}</p>
            <span className="text-xs text-text-muted">{formatDateTime(entry.created_at)}</span>
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            {entry.author?.full_name ?? 'Unknown'}
            {entry.note ? ` · ${entry.note}` : ''}
          </p>
        </li>
      ))}
      <li className="relative">
        <span className="absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-border-subtle bg-surface-card" aria-hidden />
        <p className="text-sm text-text-muted">Case opened</p>
        <p className="mt-0.5 text-xs text-text-muted">{formatDateTime(openedAt)}</p>
      </li>
    </ol>
  )
}
