'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CONTENT_TYPES } from '@/lib/marketing/constants'
import { CONTENT_TYPE_LABELS } from '@/lib/format'
import type { MarketingEmployee } from '@/lib/marketing/dashboard'
import type { ContentType } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Creates a content calendar item. The assignee must be a Marketing person (the
 * service checks); platform is free text with an Instagram default since that is the
 * v1 focus, but kept editable for the Facebook/LinkedIn future the blueprint notes.
 */
export function ContentItemForm({ employees }: { employees: MarketingEmployee[] }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [contentType, setContentType] = useState<ContentType>(CONTENT_TYPES[0])
  const [platform, setPlatform] = useState('instagram')
  const [scheduledDate, setScheduledDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [captionDraft, setCaptionDraft] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!title.trim()) return setError('Give the item a title.')
    if (!scheduledDate) return setError('Pick a date to schedule it.')
    if (!assignedTo) return setError('Assign someone to produce it.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/content-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        content_type: contentType,
        platform: platform.trim() || 'instagram',
        scheduled_date: scheduledDate,
        assigned_to: assignedTo,
        caption_draft: captionDraft.trim() || null,
        notes: notes.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create the item.')
      return
    }

    router.push(`/marketing/content-calendar/${body.item.id}`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ci-title" className={labelClass}>
          Title
        </label>
        <input
          id="ci-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Rooftop install time-lapse"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ci-type" className={labelClass}>
            Content type
          </label>
          <select
            id="ci-type"
            value={contentType}
            onChange={(e) => setContentType(e.target.value as ContentType)}
            className={inputClass}
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ci-platform" className={labelClass}>
            Platform
          </label>
          <input
            id="ci-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ci-date" className={labelClass}>
            Scheduled date
          </label>
          <input
            id="ci-date"
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ci-assignee" className={labelClass}>
            Assign to
          </label>
          <select
            id="ci-assignee"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="ci-caption" className={labelClass}>
          Caption draft
        </label>
        <textarea
          id="ci-caption"
          value={captionDraft}
          onChange={(e) => setCaptionDraft(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="ci-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="ci-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Add to calendar'}
      </button>
    </div>
  )
}
