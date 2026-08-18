'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  GST_FILING_STATUS_LABELS,
  GST_FILING_STATUS_STYLES,
  formatCurrency,
  formatDate,
} from '@/lib/format'
import type { GstFiling } from '@/lib/types'

/**
 * GST filings, newest first. A draft filing can be marked filed inline (PATCH /api/tax/gst/
 * [id]); the server stamps filed_date. readOnly (a CEO viewing) drops the action. net_payable
 * is the DB-generated output − input.
 */
export function GstFilingList({
  filings,
  readOnly,
}: {
  filings: GstFiling[]
  readOnly: boolean
}) {
  if (filings.length === 0) {
    return (
      <EmptyState
        title="No GST filings yet"
        description="Open a filing for a month and its output/input GST is summed for you."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3 font-semibold">Period</th>
            <th className="px-4 py-3 text-right font-semibold">Output GST</th>
            <th className="px-4 py-3 text-right font-semibold">Input GST</th>
            <th className="px-4 py-3 text-right font-semibold">Net payable</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Filed</th>
            {!readOnly && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {filings.map((f) => (
            <FilingRow key={f.id} filing={f} readOnly={readOnly} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilingRow({ filing, readOnly }: { filing: GstFiling; readOnly: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function markFiled() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/tax/gst/${filing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'filed' }),
    })
    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update.')
      return
    }
    router.refresh()
  }

  return (
    <tr className="transition-colors hover:bg-surface-bg">
      <td className="px-4 py-3 font-medium text-brand-slate">{filing.period}</td>
      <td className="px-4 py-3 text-right tabular-nums text-text-muted">
        {filing.output_gst === null ? '—' : formatCurrency(filing.output_gst)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-text-muted">
        {filing.input_gst === null ? '—' : formatCurrency(filing.input_gst)}
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
        {formatCurrency(filing.net_payable)}
      </td>
      <td className="px-4 py-3">
        <Badge className={GST_FILING_STATUS_STYLES[filing.status]}>
          {GST_FILING_STATUS_LABELS[filing.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-text-muted">
        {filing.filed_date ? formatDate(filing.filed_date) : '—'}
      </td>
      {!readOnly && (
        <td className="px-4 py-3 text-right">
          {filing.status === 'draft' ? (
            <>
              <button
                onClick={markFiled}
                disabled={pending}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:bg-surface-bg disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Mark filed'}
              </button>
              {error && <p className="mt-1 text-xs text-status-danger">⚠ {error}</p>}
            </>
          ) : null}
        </td>
      )}
    </tr>
  )
}
