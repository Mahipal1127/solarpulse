import { EmptyState } from '@/components/ui/primitives'
import { formatDate } from '@/lib/format'
import type { MarketSurveyNote } from '@/lib/types'

/**
 * The market-survey field log — a lightweight list of area observations, not a research tool
 * (per scope). Presentational; RLS decides which rows arrive.
 */
export function MarketSurveyList({ notes }: { notes: MarketSurveyNote[] }) {
  if (notes.length === 0) {
    return (
      <EmptyState
        title="No survey notes yet"
        description="Log an observation from the field to start the record."
      />
    )
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {notes.map((note) => (
        <li key={note.id} className="px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-brand-slate">{note.area}</p>
            <span className="shrink-0 text-xs text-text-muted">{formatDate(note.survey_date)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{note.observations}</p>
        </li>
      ))}
    </ul>
  )
}
