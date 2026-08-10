'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatEnergy } from '@/lib/format'
import { SURVEY_MEDIA_BUCKET, MAX_UPLOAD_BYTES } from '@/lib/technical/constants'
import type { SiteSurvey } from '@/lib/types'

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

/**
 * The customer's electricity bill: one file per survey, plus the average monthly
 * units read off it.
 *
 * Two columns on the survey row rather than a table, so uploading a second bill
 * replaces the first. Kept separate from PhotoSection because this file is treated
 * differently — downloading it is recorded as a sensitive access, not a routine one.
 * A bill is a household's consumption history, and the security blueprint requires
 * access to personal documents to be logged even when the reader is the CEO.
 */
export function ElectricityBillSection({
  survey,
  readOnly,
}: {
  survey: SiteSurvey
  readOnly: boolean
}) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [avgUnits, setAvgUnits] = useState('')
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existing = survey.electricity_bill_file_path

  async function upload() {
    if (!file) return

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_MB} MB.`)
      return
    }

    const trimmedUnits = avgUnits.trim()
    if (trimmedUnits !== '' && !(Number(trimmedUnits) > 0)) {
      setError('Average units must be a number greater than zero, or left blank.')
      return
    }

    setUploading(true)
    setError(null)

    const supabase = createClient()
    const path = `${survey.id}/${crypto.randomUUID()}-${file.name}`

    const { error: uploadError } = await supabase.storage
      .from(SURVEY_MEDIA_BUCKET)
      .upload(path, file)

    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const res = await fetch(`/api/surveys/${survey.id}/electricity-bill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: path,
        avg_units: trimmedUnits === '' ? null : Number(trimmedUnits),
      }),
    })

    setUploading(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // The object landed but the column did not point at it — remove it rather
      // than leaving a file nothing references.
      await supabase.storage.from(SURVEY_MEDIA_BUCKET).remove([path])
      setError(body.error ?? 'Could not attach the bill.')
      return
    }

    /**
     * The survey holds one bill path, so the row now points at the new object and
     * nothing references the old one. Removing it keeps a customer's document from
     * lingering in the bucket unreachable and unaudited. Best-effort: the record is
     * already correct, and failing here should not read as a failed upload.
     */
    if (existing && existing !== path) {
      await supabase.storage.from(SURVEY_MEDIA_BUCKET).remove([existing])
    }

    setFile(null)
    setAvgUnits('')
    router.refresh()
  }

  async function open() {
    setOpening(true)
    setError(null)

    const res = await fetch(`/api/surveys/${survey.id}/electricity-bill`)
    setOpening(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not generate a link.')
      return
    }

    const { url } = await res.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="border-b border-border-subtle px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-slate">
          <Zap className="h-4 w-4 text-text-muted/60" />
          Electricity bill
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          One bill per survey. Sizing the system starts from what the household actually uses.
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-bg px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Average monthly use
            </p>
            <p className="mt-1 text-lg font-semibold text-brand-slate">
              {formatEnergy(survey.electricity_bill_avg_units)}
            </p>
          </div>

          {existing ? (
            <button
              onClick={open}
              disabled={opening}
              className="rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
            >
              {opening ? 'Preparing…' : 'View bill'}
            </button>
          ) : (
            <p className="text-xs text-text-muted">No bill attached</p>
          )}
        </div>

        {existing && (
          <p className="flex items-start gap-1.5 text-xs text-text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted/60" />
            Opening this bill is recorded in the audit log, including for the CEO. It is a
            household&apos;s consumption history, not a project document.
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-xs text-status-danger">⚠ {error}</p>
        )}

        {!readOnly && (
          <div className="space-y-3 border-t border-border-subtle pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {existing ? 'Replace the bill' : 'Attach the bill'}
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <label htmlFor="bill-file" className="mb-1 block text-xs text-text-muted">
                  File (PDF or photo)
                </label>
                <input
                  id="bill-file"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-text-muted file:ring-1 file:ring-border-subtle"
                />
              </div>

              <div className="w-40">
                <label htmlFor="bill-units" className="mb-1 block text-xs text-text-muted">
                  Avg units (kWh)
                </label>
                <input
                  id="bill-units"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={avgUnits}
                  onChange={(e) => setAvgUnits(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
                />
              </div>

              <button
                onClick={upload}
                disabled={!file || uploading}
                className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : existing ? 'Replace' : 'Attach'}
              </button>
            </div>

            {existing && (
              <p className="text-xs text-status-warning">
                Replacing removes the current file — a survey holds one bill, and the old one would
                otherwise sit in storage with nothing pointing at it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
