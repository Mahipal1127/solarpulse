'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Sparkles, Paperclip, Trash2, Send, Save, Download, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  REPORT_BUCKET,
  REPORT_PERIODS,
  REPORT_PERIOD_HINTS,
  REPORT_PERIOD_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_STYLES,
  MAX_UPLOAD_BYTES,
  reportAttachmentPath,
} from '@/lib/reports/constants'
import type { EmployeeReport, ReportPeriod } from '@/lib/types'

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

/**
 * An employee's own report submissions — the one component every department's
 * "My Reports" page renders. Shared for the same reason MyTaskBoard is: this is
 * identical work in ten places, and ten copies would drift.
 *
 * THE FLOW IS GENERATE → REVIEW → SUBMIT. The AI button fills the textarea and nothing
 * more; it never files anything. What gets submitted is whatever is in the box when the
 * employee presses Submit, which is what makes "submitted under their own name" true
 * rather than merely stated.
 *
 * SUBMITTED IS FINAL, and the UI says so before the click rather than after. The server
 * refuses the edit either way (0019 + the service guard), but a disabled control that
 * explains itself is better than a 409 the employee has to interpret.
 *
 * TEXT AND FILE ARE BOTH OPTIONAL — but not at the same time. The Save/Submit buttons
 * stay disabled until at least one is present, mirroring the CHECK in 0019 and the
 * .refine() in the schema, so the same rule is stated in all three places.
 */
export function EmployeeReportBoard({
  initialReports,
  organizationId,
  userId,
}: {
  initialReports: EmployeeReport[]
  organizationId: string
  userId: string
}) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  /** Set only by the Generate button. Cleared whenever the form is reset. */
  const [aiGenerated, setAiGenerated] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  /** The draft being edited, or null when composing a new report. */
  const [editingId, setEditingId] = useState<string | null>(null)

  const canSave = content.trim().length > 0 || file !== null
  const reports = initialReports

  function reset() {
    setContent('')
    setFile(null)
    setAiGenerated(false)
    setEditingId(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function generate() {
    setGenerating(true)
    setError(null)
    setNotice(null)

    try {
      const res = await fetch('/api/employee-reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      })
      const body = await res.json()

      if (!res.ok) {
        setError(body.error ?? 'Could not generate a draft.')
        return
      }

      if (!body.draft) {
        // A 200 with no draft is the normal "AI is off / over quota / unreachable"
        // path, not a failure — the employee can still write the report themselves.
        setNotice(body.unavailableReason ?? 'AI drafting is unavailable right now.')
        return
      }

      setContent(body.draft)
      setAiGenerated(true)
      setNotice('Draft written from your own records. Read it, edit anything that is off, then submit.')
    } catch {
      setError('Could not reach the server.')
    } finally {
      setGenerating(false)
    }
  }

  /** Uploads the picked file, if any, and returns the stored path and name. */
  async function uploadAttachment(): Promise<
    { path: string; name: string } | null | 'failed'
  > {
    if (!file) return null

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_MB} MB. Upload a smaller file.`)
      return 'failed'
    }

    const supabase = createClient()
    // '{org}/{user}/{uuid}-{name}': the storage policy reads the org from the first
    // segment and the author from the second to decide whether this write is allowed.
    const path = reportAttachmentPath(organizationId, userId, file.name)

    const { error: uploadError } = await supabase.storage.from(REPORT_BUCKET).upload(path, file)
    if (uploadError) {
      setError(uploadError.message)
      return 'failed'
    }

    return { path, name: file.name }
  }

  async function save(submit: boolean) {
    if (!canSave) return
    setBusy(true)
    setError(null)
    setNotice(null)

    const uploaded = await uploadAttachment()
    if (uploaded === 'failed') {
      setBusy(false)
      return
    }

    const payload: Record<string, unknown> = {
      content: content.trim() ? content.trim() : null,
      submit,
    }
    if (uploaded) {
      payload.attachment_path = uploaded.path
      payload.attachment_name = uploaded.name
    }

    const editing = editingId !== null
    if (!editing) {
      payload.period = period
      payload.ai_generated = aiGenerated
    }

    const res = await fetch(
      editing ? `/api/employee-reports/${editingId}` : '/api/employee-reports',
      {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    setBusy(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save the report.')
      return
    }

    reset()
    setNotice(submit ? 'Report submitted.' : 'Draft saved.')
    router.refresh()
  }

  function editDraft(report: EmployeeReport) {
    setEditingId(report.id)
    setPeriod(report.period)
    setContent(report.content ?? '')
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
    setError(null)
    setNotice(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function discard(reportId: string) {
    setDeleting(reportId)
    setError(null)

    const res = await fetch(`/api/employee-reports/${reportId}`, { method: 'DELETE' })
    setDeleting(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not delete that draft.')
      return
    }

    if (editingId === reportId) reset()
    router.refresh()
  }

  async function openAttachment(reportId: string) {
    setOpening(reportId)
    setError(null)

    const res = await fetch(`/api/employee-reports/${reportId}/attachment`, { method: 'POST' })
    setOpening(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not open that attachment.')
      return
    }

    const { url } = await res.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={editingId ? 'Edit draft' : 'New report'}
          subtitle={
            editingId
              ? 'Editing a saved draft. Nothing is visible to anyone else until you submit it.'
              : 'Write it yourself, generate a draft from your own records, or attach a file. At least one is needed.'
          }
          icon={<FileText className="h-4 w-4" />}
          action={
            editingId ? (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-bg"
              >
                <X className="h-3.5 w-3.5" />
                Cancel edit
              </button>
            ) : undefined
          }
        />

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted" htmlFor="report-period">
                Period
              </label>
              <select
                id="report-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
                // The period is fixed once a draft exists: it decided period_start and
                // period_end at insert, and the server does not recompute them on edit,
                // so a changeable picker here would print a range the text does not cover.
                disabled={editingId !== null}
                className="mt-1 rounded-lg border border-border-subtle bg-surface-card px-3 py-2 text-sm text-brand-slate disabled:cursor-not-allowed disabled:opacity-60"
              >
                {REPORT_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {REPORT_PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-text-muted">{REPORT_PERIOD_HINTS[period]}</p>
            </div>

            <button
              type="button"
              onClick={generate}
              disabled={generating || busy}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? 'Writing your draft…' : 'Generate with AI'}
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted" htmlFor="report-content">
              Your report
            </label>
            <textarea
              id="report-content"
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                // Edited or hand-written text is still "started as AI" for provenance —
                // the flag records where it came from, not how much survived. Only
                // clearing the box entirely un-marks it.
                if (e.target.value.trim() === '') setAiGenerated(false)
              }}
              rows={12}
              placeholder="What you worked on, what is done, what is still open, and anything blocked."
              className="mt-1 w-full rounded-lg border border-border-subtle bg-surface-card px-3 py-2 text-sm leading-relaxed text-brand-slate"
            />
            {aiGenerated && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
                <Sparkles className="h-3 w-3 text-brand-gold" />
                Started as an AI draft. Your manager will see that — edit it freely, it stays
                your report.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
              id="report-attachment"
            />
            <label
              htmlFor="report-attachment"
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-brand-slate hover:bg-surface-bg"
            >
              <Paperclip className="h-4 w-4" />
              {file ? 'Change file' : 'Attach a file'}
            </label>
            {file && (
              <span className="flex items-center gap-2 text-xs text-text-muted">
                {file.name}
                <button
                  type="button"
                  onClick={() => {
                    setFile(null)
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                  className="text-status-danger hover:underline"
                >
                  Remove
                </button>
              </span>
            )}
            <span className="text-xs text-text-muted">Optional — up to {MAX_MB} MB.</span>
          </div>

          {error && <p className="text-sm text-status-danger">{error}</p>}
          {notice && <p className="text-sm text-text-muted">{notice}</p>}

          <div className="flex flex-wrap gap-3 border-t border-border-subtle pt-4">
            <button
              type="button"
              onClick={() => save(false)}
              disabled={!canSave || busy || generating}
              className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-brand-slate hover:bg-surface-bg disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save draft
            </button>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={!canSave || busy || generating}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-slate px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {busy ? 'Submitting…' : 'Submit report'}
            </button>
            {!canSave && (
              <p className="self-center text-xs text-text-muted">
                Write something or attach a file first.
              </p>
            )}
            <p className="w-full text-xs text-text-muted">
              Once submitted, a report cannot be edited or deleted — your manager and the CEO
              read it as filed.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Your reports"
          subtitle="Drafts are private to you. Submitted reports go to your manager and the CEO."
        />

        {reports.length === 0 ? (
          <EmptyState
            title="No reports yet"
            description="Your submitted reports will be listed here, newest first."
            icon={<FileText className="h-5 w-5 text-text-muted" />}
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {reports.map((report) => {
              const isDraft = report.status === 'draft'
              return (
                <li key={report.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-brand-slate">
                      {REPORT_PERIOD_LABELS[report.period]}
                    </span>
                    <span className="text-xs text-text-muted">
                      {formatDate(report.period_start)} — {formatDate(report.period_end)}
                    </span>
                    <Badge className={REPORT_STATUS_STYLES[report.status]}>
                      {REPORT_STATUS_LABELS[report.status]}
                    </Badge>
                    {report.ai_generated && (
                      <Badge className="bg-surface-bg text-text-muted ring-1 ring-border-subtle">
                        AI draft
                      </Badge>
                    )}
                    {report.submitted_at && (
                      <span className="text-xs text-text-muted">
                        Submitted {formatDateTime(report.submitted_at)}
                      </span>
                    )}
                  </div>

                  {report.content && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-slate">
                      {report.content}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {report.attachment_path && (
                      <button
                        type="button"
                        onClick={() => openAttachment(report.id)}
                        disabled={opening === report.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-slate hover:underline disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {opening === report.id
                          ? 'Opening…'
                          : report.attachment_name ?? 'Attachment'}
                      </button>
                    )}
                    {isDraft && (
                      <>
                        <button
                          type="button"
                          onClick={() => editDraft(report)}
                          className="text-xs font-medium text-brand-slate hover:underline"
                        >
                          Edit draft
                        </button>
                        <button
                          type="button"
                          onClick={() => discard(report.id)}
                          disabled={deleting === report.id}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-status-danger hover:underline disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deleting === report.id ? 'Deleting…' : 'Delete draft'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
