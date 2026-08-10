'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/primitives'

export function AISummaryCard({
  narrative,
  unavailableReason,
  date,
}: {
  narrative: string | null
  unavailableReason: string | null
  date: string
}) {
  const [open, setOpen] = useState(true)

  return (
    <Card>
      <CardHeader
        title="Today's AI Briefing"
        subtitle={`${date} · refreshes daily`}
        /*
          The notice-card treatment from the design system: a soft gold circle with a
          gold glyph. This card is the one genuine announcement on the dashboard, which
          is what earns the accent — the stat cards below it stay neutral.
        */
        icon={<Sparkles className="h-4 w-4" />}
        action={
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Collapse briefing' : 'Expand briefing'}
            className="rounded p-1 text-text-muted/60 hover:bg-surface-bg hover:text-text-muted transition-colors"
          >
            <svg
              className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        }
      />
      {open && (
        <div className="px-5 py-4">
          {narrative ? (
            <p className="text-sm leading-relaxed text-text-muted">{narrative}</p>
          ) : (
            <p className="text-sm text-text-muted">
              {unavailableReason ?? 'AI briefing is not available.'}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
