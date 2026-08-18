'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import {
  formatDate,
  CONTENT_STATUS_STYLES,
  CONTENT_STATUS_LABELS,
  CONTENT_TYPE_LABELS,
} from '@/lib/format'
import type { ContentItemRow } from '@/lib/marketing/dashboard'
import type { ContentType } from '@/lib/types'

/**
 * The content calendar's two views. The month grid is the primary layout — scheduling
 * is inherently calendar-shaped, and this is the one place in the app a grid beats a
 * list — with a list toggle for anyone who prefers scanning a table. Deliberately not
 * a full scheduling tool: no drag-to-reschedule, no time-of-day slots. A day cell
 * shows its items as small status-coloured chips; a chip links to the item's detail
 * where status and assets are managed.
 *
 * Dates are 'YYYY-MM-DD' strings compared as strings, never parsed through `new
 * Date(str)` — that reads the string as UTC midnight and can shift the day across a
 * timezone. The grid is built from plain year/month/day arithmetic instead.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 'YYYY-MM-DD' for a given y/m(0-based)/d, matching how scheduled_date is stored. */
function isoFor(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`
}

export function ContentCalendarView({
  items,
  initialMonth,
}: {
  items: ContentItemRow[]
  /** 'YYYY-MM' the grid opens on — the page passes the current month. */
  initialMonth: string
}) {
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [year, month] = initialMonth.split('-').map(Number)
  const [cursor, setCursor] = useState<{ year: number; monthIndex: number }>({
    year,
    monthIndex: month - 1,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className={SEGMENT_TRACK}>
          <button className={segmentClass(view === 'calendar')} onClick={() => setView('calendar')}>
            Calendar
          </button>
          <button className={segmentClass(view === 'list')} onClick={() => setView('list')}>
            List
          </button>
        </div>

        {view === 'calendar' && (
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                setCursor((c) => {
                  const m = c.monthIndex - 1
                  return m < 0 ? { year: c.year - 1, monthIndex: 11 } : { year: c.year, monthIndex: m }
                })
              }
              className="rounded-lg border border-border-subtle p-1.5 text-text-muted transition-colors hover:bg-surface-bg"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-40 text-center text-sm font-semibold text-brand-slate">
              {MONTHS[cursor.monthIndex]} {cursor.year}
            </span>
            <button
              onClick={() =>
                setCursor((c) => {
                  const m = c.monthIndex + 1
                  return m > 11 ? { year: c.year + 1, monthIndex: 0 } : { year: c.year, monthIndex: m }
                })
              }
              className="rounded-lg border border-border-subtle p-1.5 text-text-muted transition-colors hover:bg-surface-bg"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {view === 'calendar' ? (
        <MonthGrid items={items} year={cursor.year} monthIndex={cursor.monthIndex} />
      ) : (
        <ContentTable items={items} />
      )}
    </div>
  )
}

function MonthGrid({
  items,
  year,
  monthIndex,
}: {
  items: ContentItemRow[]
  year: number
  monthIndex: number
}) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  // Day of week the 1st falls on (0=Sun), for the leading blanks.
  const leadingBlanks = new Date(year, monthIndex, 1).getDay()

  // Group items by their scheduled_date string.
  const byDate = new Map<string, ContentItemRow[]>()
  for (const item of items) {
    const list = byDate.get(item.scheduled_date) ?? []
    list.push(item)
    byDate.set(item.scheduled_date, list)
  }

  const cells: Array<{ day: number; iso: string } | null> = []
  for (let i = 0; i < leadingBlanks; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, iso: isoFor(year, monthIndex, d) })

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[42rem] rounded-2xl border border-border-subtle bg-surface-card">
        <div className="grid grid-cols-7 border-b border-border-subtle">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-xs font-semibold text-text-muted">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => (
            <div
              key={i}
              className="min-h-24 border-b border-r border-border-subtle p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0"
            >
              {cell && (
                <>
                  <div className="mb-1 px-1 text-xs font-medium text-text-muted">{cell.day}</div>
                  <div className="space-y-1">
                    {(byDate.get(cell.iso) ?? []).map((item) => (
                      <Link
                        key={item.id}
                        href={`/marketing/content-calendar/${item.id}`}
                        className={`block truncate rounded px-1.5 py-0.5 text-xs font-medium ${CONTENT_STATUS_STYLES[item.status]}`}
                        title={`${item.title} — ${CONTENT_STATUS_LABELS[item.status]}`}
                      >
                        {item.needsAttention && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
                        {item.title}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ContentTable({ items }: { items: ContentItemRow[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No content scheduled"
        description="Planned reels, posts and stories will show up here."
      />
    )
  }

  // Newest scheduled first is how the query already returns them.
  return (
    <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
      <ul className="divide-y divide-border-subtle">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <Link
                href={`/marketing/content-calendar/${item.id}`}
                className="flex items-center gap-1.5 truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
              >
                {item.needsAttention && (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-warning" />
                )}
                {item.title}
              </Link>
              <p className="mt-0.5 text-xs text-text-muted">
                {CONTENT_TYPE_LABELS[item.content_type as ContentType] ?? item.content_type} ·{' '}
                {formatDate(item.scheduled_date)}
                {item.assignee?.full_name ? ` · ${item.assignee.full_name}` : ''}
              </p>
            </div>
            <Badge className={CONTENT_STATUS_STYLES[item.status]}>
              {CONTENT_STATUS_LABELS[item.status]}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  )
}
