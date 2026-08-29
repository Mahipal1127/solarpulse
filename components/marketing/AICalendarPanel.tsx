'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, Check, Sparkles, X } from 'lucide-react'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { formatDate, formatDateTime } from '@/lib/format'
import type { ContentPlan, PlanItem, PlanRangeKind } from '@/lib/marketing/creative-types'

/**
 * The "AI Calendar" — the AI proposes a week or month of content; you pick what to commit.
 *
 * NOTHING lands on the real calendar until you commit. The panel opens on the newest proposed
 * plan with every item pre-checked; you uncheck what you don't want and commit the rest, which
 * creates real content_calendar_items owned by you (the user's explicit "propose, then commit"
 * choice). A committed or discarded plan collapses to a one-line record.
 *
 * Lives here in Content Calendar rather than under AI Insights because this is where the team
 * already thinks about the schedule, and committed items appear in the grid right beside it.
 */

const RANGE_LABEL: Record<PlanRangeKind, string> = { week: 'Next 7 days', month: 'Next 30 days' }

export function AICalendarPanel({
  plans,
  readOnly,
}: {
  plans: ContentPlan[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [rangeKind, setRangeKind] = useState<PlanRangeKind>('week')
  const [brief, setBrief] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const proposed = plans.filter((plan) => plan.status === 'proposed')
  const past = plans.filter((plan) => plan.status !== 'proposed')

  async function generate() {
    setPending(true)
    setError(null)

    // Start from today, in the browser's local calendar date.
    const start = new Date()
    const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
      start.getDate()
    ).padStart(2, '0')}`

    const res = await fetch('/api/marketing/content-plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ range_kind: rangeKind, start_date: startDate, brief: brief.trim() || null }),
    })
    setPending(false)

    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not generate a plan.')
      return
    }
    setBrief('')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader
        icon={<CalendarPlus className="h-4 w-4" />}
        title="AI content calendar"
        subtitle="Let the AI plan a week or a month, grounded in your brand and Instagram audit. Review it, then commit what you want onto the calendar."
      />

      <div className="space-y-4 px-5 py-4">
        {!readOnly && (
          <div className="rounded-xl border border-border-subtle bg-surface-bg p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              {(['week', 'month'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setRangeKind(option)}
                  className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                    rangeKind === option
                      ? 'border-brand-gold text-brand-gold'
                      : 'border-border-subtle text-text-muted hover:border-brand-gold'
                  }`}
                >
                  {RANGE_LABEL[option]}
                </button>
              ))}
            </div>
            <input
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Any steer for the AI? (optional) e.g. 'push the subsidy offer, we have a site launch Thursday'"
              className="mt-2 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
              aria-label="Plan brief"
            />
            {error && <p className="mt-2 text-xs text-status-danger">⚠ {error}</p>}
            <button
              onClick={generate}
              disabled={pending}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {pending ? 'Planning…' : `Plan ${RANGE_LABEL[rangeKind].toLowerCase()}`}
            </button>
          </div>
        )}

        {proposed.length === 0 && past.length === 0 && (
          <EmptyState
            title="No plans yet"
            description="Generate a week or a month and the AI proposes one idea per day. You commit the ones you like."
          />
        )}

        {proposed.map((plan) => (
          <ProposedPlan key={plan.id} plan={plan} readOnly={readOnly} />
        ))}

        {past.length > 0 && (
          <div className="space-y-1.5">
            {past.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted"
              >
                <Badge className={plan.status === 'committed' ? 'badge-success' : 'badge-neutral'}>
                  {plan.status === 'committed' ? 'Committed' : 'Discarded'}
                </Badge>
                <span>
                  {RANGE_LABEL[plan.range_kind]} from {formatDate(plan.start_date)}
                </span>
                <span className="ml-auto">
                  {plan.committed_at ? formatDateTime(plan.committed_at) : formatDate(plan.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function ProposedPlan({ plan, readOnly }: { plan: ContentPlan; readOnly: boolean }) {
  const router = useRouter()
  // Every item pre-selected: the common path is "commit the whole plan", and unchecking a few
  // is less work than checking twenty.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(plan.items.map((_, index) => index))
  )
  const [pending, setPending] = useState<'commit' | 'discard' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function commit() {
    if (selected.size === 0) {
      setError('Select at least one item to add to the calendar.')
      return
    }
    setPending('commit')
    setError(null)
    const res = await fetch(`/api/marketing/content-plans/${plan.id}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item_indices: [...selected] }),
    })
    setPending(null)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not commit the plan.')
      return
    }
    router.refresh()
  }

  async function discard() {
    setPending('discard')
    setError(null)
    const res = await fetch(`/api/marketing/content-plans/${plan.id}/discard`, { method: 'POST' })
    setPending(null)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not discard the plan.')
      return
    }
    router.refresh()
  }

  if (!plan.ai_generated || plan.items.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-card p-4">
        <div className="flex items-center gap-2">
          <Badge className="badge-warning">Empty plan</Badge>
          <span className="text-sm text-brand-slate">
            {RANGE_LABEL[plan.range_kind]} from {formatDate(plan.start_date)}
          </span>
        </div>
        <p className="notice-warning mt-2 rounded-lg px-3 py-2 text-xs">
          {plan.unavailable_reason ??
            'The AI produced no items. Add calendar entries yourself, or try again.'}
        </p>
        {!readOnly && (
          <button
            onClick={discard}
            disabled={pending !== null}
            className="mt-2 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted hover:border-status-danger hover:text-status-danger disabled:opacity-60"
          >
            Discard
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-brand-gold/40 bg-surface-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
        <Badge className="badge-info">Proposed</Badge>
        <span className="text-sm font-medium text-brand-slate">
          {RANGE_LABEL[plan.range_kind]} from {formatDate(plan.start_date)}
        </span>
        <span className="ml-auto text-xs text-text-muted">
          {selected.size} of {plan.items.length} selected
        </span>
      </div>

      {plan.brief && (
        <p className="border-b border-border-subtle px-4 py-2 text-xs text-text-muted">
          Steer: <span className="text-brand-slate">{plan.brief}</span>
        </p>
      )}

      <ul className="divide-y divide-border-subtle">
        {plan.items.map((item, index) => (
          <PlanRow
            key={`${item.scheduled_date}-${index}`}
            item={item}
            checked={selected.has(index)}
            onToggle={() => !readOnly && toggle(index)}
            readOnly={readOnly}
          />
        ))}
      </ul>

      {error && <p className="px-4 pt-2 text-xs text-status-danger">⚠ {error}</p>}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <button
            onClick={commit}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" />
            {pending === 'commit' ? 'Adding…' : `Add ${selected.size} to calendar`}
          </button>
          <button
            onClick={discard}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:border-status-danger hover:text-status-danger disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" />
            Discard plan
          </button>
        </div>
      )}
    </div>
  )
}

function PlanRow({
  item,
  checked,
  onToggle,
  readOnly,
}: {
  item: PlanItem
  checked: boolean
  onToggle: () => void
  readOnly: boolean
}) {
  return (
    <li className="flex gap-3 px-4 py-3">
      {!readOnly && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-gold"
          aria-label={`Include ${item.title}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium text-brand-gold">{formatDate(item.scheduled_date)}</span>
          <Badge className="badge-neutral capitalize">{item.content_type}</Badge>
          <span className="text-sm font-medium text-brand-slate">{item.title}</span>
        </div>
        {item.hook && <p className="mt-1 text-xs text-text-muted">Hook: {item.hook}</p>}
        {item.caption_idea && (
          <p className="mt-0.5 text-xs text-text-muted">Caption: {item.caption_idea}</p>
        )}
        {item.rationale && (
          <p className="mt-0.5 text-xs italic text-text-muted">Why: {item.rationale}</p>
        )}
      </div>
    </li>
  )
}
