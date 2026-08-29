'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Plus, Trash2, Sparkles } from 'lucide-react'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { formatDate } from '@/lib/format'
import type { ScriptLibraryEntry, ScriptSource } from '@/lib/marketing/creative-types'

/**
 * The reference library — the two upload lanes the AI compares and learns from.
 *
 * Two add forms, side by side, exactly as asked: one for OUR OWN past scripts, one for
 * COMPETITORS & INSPIRATIONS. They land in the same table told apart by `source`, and the
 * generator shows the model each bucket with different instructions — mirror our own, contrast
 * the competitors. A third bucket, 'ai_approved', appears here read-only: those are the scripts
 * the team approved, which the model now writes from. You can delete any of them — curating
 * what the AI learns is the point.
 *
 * "Upload" here is paste-the-text, not a file picker: a script is text, the model needs text,
 * and a paste box avoids a whole file-parsing and storage path for no gain. The label still
 * reads as the two "bars" the user pictured.
 */

const SOURCE_META: Record<ScriptSource, { label: string; badge: string }> = {
  own: { label: 'Our script', badge: 'badge-info' },
  competitor: { label: 'Competitor', badge: 'badge-warning' },
  inspiration: { label: 'Inspiration', badge: 'badge-neutral' },
  ai_approved: { label: 'AI · approved', badge: 'badge-success' },
}

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

export function ScriptLibraryPanel({
  entries,
  readOnly,
}: {
  entries: ScriptLibraryEntry[]
  readOnly: boolean
}) {
  return (
    <Card>
      <CardHeader
        icon={<BookOpen className="h-4 w-4" />}
        title="Script library"
        subtitle="What the AI compares against and learns from. Add your own past scripts and the competitors or posts that inspire you."
      />

      <div className="space-y-5 px-5 py-4">
        {!readOnly && (
          <div className="grid gap-4 md:grid-cols-2">
            <AddReferenceForm
              lane="own"
              title="Our own scripts"
              hint="Past scripts that sound like us. The AI mirrors their voice and hooks."
            />
            <AddReferenceForm
              lane="inspiration"
              title="Competitors & inspiration"
              hint="Scripts you admire or want to beat. The AI learns structure and energy, and contrasts."
            />
          </div>
        )}

        <LibraryList entries={entries} readOnly={readOnly} />
      </div>
    </Card>
  )
}

/**
 * One upload lane. The competitor/inspiration lane offers a source toggle (both are "learn from
 * but don't copy" to the model, but the team wants to record which is which) and an attribution
 * field; the "own" lane needs neither.
 */
function AddReferenceForm({
  lane,
  title,
  hint,
}: {
  lane: 'own' | 'inspiration'
  title: string
  hint: string
}) {
  const router = useRouter()
  const [source, setSource] = useState<ScriptSource>(lane === 'own' ? 'own' : 'inspiration')
  const [scriptTitle, setScriptTitle] = useState('')
  const [body, setBody] = useState('')
  const [attribution, setAttribution] = useState('')
  const [contentType, setContentType] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!scriptTitle.trim() || !body.trim()) {
      setError('A title and the script text are both needed.')
      return
    }
    setPending(true)
    setError(null)

    const res = await fetch('/api/marketing/script-library', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source,
        title: scriptTitle.trim(),
        body: body.trim(),
        content_type: contentType.trim() || null,
        attribution: lane === 'own' ? null : attribution.trim() || null,
      }),
    })
    setPending(false)

    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not add the reference.')
      return
    }
    setScriptTitle('')
    setBody('')
    setAttribution('')
    setContentType('')
    router.refresh()
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-bg p-3.5">
      <h4 className="text-sm font-semibold text-brand-slate">{title}</h4>
      <p className="mt-0.5 text-xs text-text-muted">{hint}</p>

      <div className="mt-3 space-y-2">
        {lane === 'inspiration' && (
          <div className="flex gap-1.5">
            {(['inspiration', 'competitor'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setSource(option)}
                className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                  source === option
                    ? 'border-brand-gold text-brand-gold'
                    : 'border-border-subtle text-text-muted hover:border-brand-gold'
                }`}
              >
                {SOURCE_META[option].label}
              </button>
            ))}
          </div>
        )}

        <input
          value={scriptTitle}
          onChange={(e) => setScriptTitle(e.target.value)}
          placeholder="Short title (e.g. 'Subsidy explainer reel')"
          className={inputClass}
          aria-label="Reference title"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Paste the full script here…"
          rows={4}
          className={inputClass}
          aria-label="Reference script text"
        />
        <div className="flex gap-2">
          <input
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            placeholder="reel / post (optional)"
            className={inputClass}
            aria-label="Content type"
          />
          {lane === 'inspiration' && (
            <input
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
              placeholder="Whose / where (optional)"
              className={inputClass}
              aria-label="Attribution"
            />
          )}
        </div>

        {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

        <button
          onClick={add}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          {pending ? 'Adding…' : 'Add to library'}
        </button>
      </div>
    </div>
  )
}

function LibraryList({
  entries,
  readOnly,
}: {
  entries: ScriptLibraryEntry[]
  readOnly: boolean
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing in the library yet"
        description="Add a few of your own scripts and some inspiration. The more the AI can see, the more it writes like you."
      />
    )
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <LibraryRow key={entry.id} entry={entry} readOnly={readOnly} />
      ))}
    </ul>
  )
}

function LibraryRow({ entry, readOnly }: { entry: ScriptLibraryEntry; readOnly: boolean }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meta = SOURCE_META[entry.source]

  async function remove() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/marketing/script-library/${entry.id}`, { method: 'DELETE' })
    setPending(false)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not delete.')
      return
    }
    router.refresh()
  }

  return (
    <li className="rounded-xl border border-border-subtle bg-surface-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge className={meta.badge}>
          {entry.source === 'ai_approved' && <Sparkles className="mr-1 h-3 w-3" />}
          {meta.label}
        </Badge>
        <span className="text-sm font-medium text-brand-slate">{entry.title}</span>
        {entry.content_type && <span className="text-xs text-text-muted">{entry.content_type}</span>}
        {entry.attribution && <span className="text-xs text-text-muted">· {entry.attribution}</span>}
        <span className="ml-auto text-xs text-text-muted">{formatDate(entry.created_at)}</span>
        {!readOnly && (
          <button
            onClick={remove}
            disabled={pending}
            aria-label="Delete reference"
            className="text-text-muted transition-colors hover:text-status-danger disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-xs text-text-muted underline decoration-dotted underline-offset-2"
      >
        {expanded ? 'Hide script' : 'Show script'}
      </button>
      {expanded && (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-text-muted">
          {entry.body}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-status-danger">⚠ {error}</p>}
    </li>
  )
}
