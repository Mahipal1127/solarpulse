'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wand2, Check, X, Copy, ChevronDown } from 'lucide-react'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'
import type { MarketingScript, ScriptContentType } from '@/lib/marketing/creative-types'

/**
 * The script generator — write a brief, the AI writes a grounded script, you review and approve.
 *
 * Approving does two things (see the service): marks the script approved AND copies it into the
 * reference library, so the NEXT script is written in this one's style. That is the refinement
 * loop the user asked for, surfaced honestly in the approve button's helper text — there is no
 * model retraining, just the house-style set growing.
 *
 * AI OFF is shown as a calm notice, not an error: the row still exists with an empty body the
 * team can fill in by editing. The whole panel degrades to "write and keep scripts".
 */

const STATUS_BADGE: Record<MarketingScript['status'], { className: string; label: string }> = {
  draft: { className: 'badge-neutral', label: 'Draft' },
  approved: { className: 'badge-success', label: 'Approved' },
  rejected: { className: 'badge-danger', label: 'Rejected' },
}

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

export function ScriptGeneratorPanel({
  scripts,
  readOnly,
}: {
  scripts: MarketingScript[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [brief, setBrief] = useState('')
  const [contentType, setContentType] = useState<ScriptContentType>('reel')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    if (!brief.trim()) {
      setError('Tell the AI what the script is about.')
      return
    }
    setPending(true)
    setError(null)

    const res = await fetch('/api/marketing/scripts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: brief.trim(), content_type: contentType }),
    })
    setPending(false)

    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not generate a script.')
      return
    }
    setBrief('')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader
        icon={<Wand2 className="h-4 w-4" />}
        title="AI script writer"
        subtitle="Grounded in your brand profile, your latest Instagram audit, and your script library. Approve the good ones — the AI writes future scripts in their style."
      />

      <div className="space-y-5 px-5 py-4">
        {!readOnly && (
          <div className="rounded-xl border border-border-subtle bg-surface-bg p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              {(['reel', 'post'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setContentType(option)}
                  className={`rounded-lg border px-3 py-1 text-xs capitalize transition-colors ${
                    contentType === option
                      ? 'border-brand-gold text-brand-gold'
                      : 'border-border-subtle text-text-muted hover:border-brand-gold'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What should this be about? e.g. 'A reel explaining how the government solar subsidy actually reaches the customer, for first-time homeowners who think it's a scam.'"
              rows={3}
              className={`${inputClass} mt-2`}
              aria-label="Script brief"
            />
            {error && <p className="mt-2 text-xs text-status-danger">⚠ {error}</p>}
            <button
              onClick={generate}
              disabled={pending}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {pending ? 'Writing…' : 'Write script'}
            </button>
          </div>
        )}

        {scripts.length === 0 ? (
          <EmptyState
            title="No scripts yet"
            description="Write a brief above and the AI drafts a full script — hook, body, caption, hashtags and SEO keywords."
          />
        ) : (
          <ul className="space-y-3">
            {scripts.map((script) => (
              <ScriptCard key={script.id} script={script} readOnly={readOnly} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function ScriptCard({ script, readOnly }: { script: MarketingScript; readOnly: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(script.status === 'draft')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const badge = STATUS_BADGE[script.status]

  async function act(path: string, method: 'POST') {
    setPending(path)
    setError(null)
    const res = await fetch(`/api/marketing/scripts/${script.id}${path}`, { method })
    setPending(null)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Action failed.')
      return
    }
    router.refresh()
  }

  return (
    <li className="rounded-2xl border border-border-subtle bg-surface-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Badge className={badge.className}>{badge.label}</Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-brand-slate">
          {script.title ?? script.brief}
        </span>
        <span className="hidden text-xs capitalize text-text-muted sm:inline">
          {script.content_type}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border-subtle px-4 py-3">
          <p className="text-xs text-text-muted">
            Brief: <span className="text-brand-slate">{script.brief}</span>
          </p>

          {!script.ai_generated && (
            <p className="notice-warning rounded-lg px-3 py-2 text-xs">
              {script.unavailable_reason ??
                'AI was unavailable, so this is an empty draft. You can write it yourself.'}
            </p>
          )}

          {script.hook && <Field label="Hook" value={script.hook} />}
          {script.script_body && <Field label="Script" value={script.script_body} />}
          {script.caption && <Field label="Caption" value={script.caption} />}
          {script.hashtags && script.hashtags.length > 0 && (
            <Field label="Hashtags" value={script.hashtags.map((tag) => `#${tag}`).join(' ')} />
          )}
          {script.seo_keywords && script.seo_keywords.length > 0 && (
            <Field label="SEO keywords" value={script.seo_keywords.join(', ')} />
          )}

          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

          {script.status === 'approved' && script.approved_by_name && (
            <p className="text-xs text-status-success">
              Approved by {script.approved_by_name}
              {script.approved_at && ` · ${formatDateTime(script.approved_at)}`} · added to the
              AI&rsquo;s reference set
            </p>
          )}

          {!readOnly && script.status === 'draft' && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => act('/approve', 'POST')}
                disabled={pending !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" />
                {pending === '/approve' ? 'Approving…' : 'Approve & teach the AI'}
              </button>
              <button
                onClick={() => act('/reject', 'POST')}
                disabled={pending !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-status-danger hover:text-status-danger disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/** A labelled block with a copy button — the team lifts these straight into Instagram. */
function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (insecure origin / permissions). The text is on screen and
      // selectable, so this is a lost convenience, not a failure.
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-brand-gold"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-bg px-3 py-2 text-sm leading-relaxed text-brand-slate">
        {value}
      </p>
    </div>
  )
}
