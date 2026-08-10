'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sun, Info } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { formatDateTime, formatEnergy } from '@/lib/format'
import {
  GENERATION_MONTHS,
  DESIGN_FILES_BUCKET,
  MAX_UPLOAD_BYTES,
} from '@/lib/technical/constants'
import type { GenerationReport } from '@/lib/types'

export type ReportRow = GenerationReport & { generator: { full_name: string } | null }

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

const MONTH_LABELS: Record<string, string> = {
  jan: 'Jan',
  feb: 'Feb',
  mar: 'Mar',
  apr: 'Apr',
  may: 'May',
  jun: 'Jun',
  jul: 'Jul',
  aug: 'Aug',
  sep: 'Sep',
  oct: 'Oct',
  nov: 'Nov',
  dec: 'Dec',
}

/**
 * Generation figures for a design.
 *
 * Records them; does not compute them. Estimating yield means irradiance data,
 * shading geometry and system-loss modelling — real engineering that this system
 * deliberately does not simulate. An engineer runs PVsyst or PVWatts, and what lands
 * here is that tool's output, optionally with the file attached. A number this app
 * invented and labelled "estimated generation" would be worse than no number, because
 * it would look equally authoritative on a proposal.
 *
 * Several reports per design is normal: a revised estimate is a new row, so what was
 * estimated when survives rather than being overwritten.
 */
export function GenerationReportSection({
  designId,
  reports,
  readOnly,
}: {
  designId: string
  reports: ReportRow[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [annual, setAnnual] = useState('')
  const [monthly, setMonthly] = useState<Record<string, string>>({})
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setAnnual('')
    setMonthly({})
    setFile(null)
    setOpen(false)
    setError(null)
  }

  async function save() {
    setError(null)

    /**
     * Only months the engineer actually filled in. Sending a key with no value would
     * store a zero for a month nobody measured, and a reader cannot tell that apart
     * from a month with genuinely no output.
     */
    const monthlyPayload: Record<string, number> = {}
    for (const month of GENERATION_MONTHS) {
      const raw = (monthly[month] ?? '').trim()
      if (raw === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value) || value <= 0) {
        setError(`${MONTH_LABELS[month]} must be a number greater than zero, or left blank.`)
        return
      }
      monthlyPayload[month] = value
    }

    const annualRaw = annual.trim()
    let annualValue: number | null = null
    if (annualRaw !== '') {
      annualValue = Number(annualRaw)
      if (!Number.isFinite(annualValue) || annualValue <= 0) {
        setError('The annual figure must be a number greater than zero.')
        return
      }
    }

    const hasMonthly = Object.keys(monthlyPayload).length > 0

    // Mirrors the server's refine, so an empty report is refused with a sentence
    // rather than a 400.
    if (annualValue === null && !hasMonthly && !file) {
      setError('Record an annual figure, a monthly breakdown, or attach a report file.')
      return
    }

    if (file && file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_MB} MB.`)
      return
    }

    setSaving(true)

    const supabase = createClient()
    let path: string | null = null

    if (file) {
      // First segment is the design id — the design-files storage policy reads it out
      // of the path to decide whether this caller may write here.
      path = `${designId}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from(DESIGN_FILES_BUCKET)
        .upload(path, file)

      if (uploadError) {
        setSaving(false)
        setError(uploadError.message)
        return
      }
    }

    const res = await fetch(`/api/designs/${designId}/generation-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimated_annual_generation_kwh: annualValue,
        estimated_monthly_generation_kwh: hasMonthly ? monthlyPayload : null,
        report_file_path: path,
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // The object landed but no row references it — remove it rather than leaving an
      // orphan no page will ever show.
      if (path) await supabase.storage.from(DESIGN_FILES_BUCKET).remove([path])
      setError(body.error ?? 'Could not save the report.')
      return
    }

    reset()
    router.refresh()
  }

  async function download(report: ReportRow) {
    setDownloading(report.id)
    setError(null)

    const res = await fetch(`/api/generation-reports/${report.id}`)
    setDownloading(null)

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
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-slate">
            <Sun className="h-4 w-4 text-text-muted/60" />
            Generation estimate
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Figures from your own modelling tool. A revised estimate is a new entry, so the history
            stays intact.
          </p>
        </div>
        {!readOnly && !open && (
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
          >
            Record figures
          </button>
        )}
      </div>

      {error && (
        <p className="border-b border-status-danger/15 bg-status-danger/5 px-5 py-2.5 text-xs text-status-danger">
          ⚠ {error}
        </p>
      )}

      {!readOnly && open && (
        <div className="space-y-4 border-b border-border-subtle bg-surface-bg px-5 py-4">
          <p className="flex items-start gap-2 rounded-lg border border-status-info/25 bg-status-info/5 px-3 py-2 text-xs text-status-info">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Nothing here calculates generation. Run the numbers in PVsyst, PVWatts or whatever you
              use, then record the output — and attach the file if you have it, so the figures can be
              traced back to the run that produced them.
            </span>
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <label htmlFor="annual-kwh" className="mb-1 block text-xs text-text-muted">
                Annual generation (kWh)
              </label>
              <input
                id="annual-kwh"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={annual}
                onChange={(e) => setAnnual(e.target.value)}
                className="w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
              />
            </div>

            <div className="min-w-48 flex-1">
              <label htmlFor="report-file" className="mb-1 block text-xs text-text-muted">
                Tool output (optional)
              </label>
              <input
                id="report-file"
                type="file"
                accept="application/pdf,image/*,.csv,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-text-muted file:ring-1 file:ring-border-subtle"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Month by month (optional)
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {GENERATION_MONTHS.map((month) => (
                <div key={month}>
                  <label
                    htmlFor={`month-${month}`}
                    className="mb-1 block text-xs text-text-muted"
                  >
                    {MONTH_LABELS[month]}
                  </label>
                  <input
                    id={`month-${month}`}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={monthly[month] ?? ''}
                    onChange={(e) =>
                      setMonthly((prev) => ({ ...prev, [month]: e.target.value }))
                    }
                    className="w-full rounded-lg border border-border-subtle px-2 py-1.5 text-sm outline-none focus:border-brand-gold"
                  />
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              Leave a month blank if you did not model it. A blank is not a zero.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save figures'}
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {reports.length === 0 ? (
        <EmptyState
          title="No generation estimate recorded"
          description={
            readOnly
              ? 'The engineer has not recorded generation figures for this design.'
              : 'Record the output of your modelling tool so Sales quotes from a real estimate.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {reports.map((report, index) => {
            const months = report.estimated_monthly_generation_kwh ?? null
            const monthEntries = months
              ? GENERATION_MONTHS.filter((m) => months[m] !== undefined)
              : []

            return (
              <li key={report.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-brand-slate">
                        {formatEnergy(report.estimated_annual_generation_kwh)} per year
                      </p>
                      {index === 0 && reports.length > 1 && (
                        <Badge className="bg-status-success/10 text-status-success ring-status-success/25">
                          Latest
                        </Badge>
                      )}
                      {report.report_file_path && (
                        <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
                          Tool output attached
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {report.generator?.full_name ?? 'Unknown'} ·{' '}
                      {formatDateTime(report.created_at)}
                    </p>
                  </div>

                  {report.report_file_path && (
                    <button
                      onClick={() => download(report)}
                      disabled={downloading === report.id}
                      className="shrink-0 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
                    >
                      {downloading === report.id ? 'Preparing…' : 'Download'}
                    </button>
                  )}
                </div>

                {monthEntries.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {monthEntries.map((month) => (
                      <div key={month} className="rounded-lg bg-surface-bg px-2 py-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                          {MONTH_LABELS[month]}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold text-brand-slate">
                          {months?.[month]?.toLocaleString('en-IN')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
