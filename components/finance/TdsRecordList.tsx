'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { formatCurrency, formatDate } from '@/lib/format'
import type { TdsRecord } from '@/lib/types'

/**
 * TDS deduction records, newest first. An un-deposited record can be marked deposited inline
 * (PATCH /api/tax/tds/[id]); the server stamps deposited_date. readOnly (a CEO viewing) drops
 * the action.
 */
export function TdsRecordList({
  records,
  readOnly,
}: {
  records: TdsRecord[]
  readOnly: boolean
}) {
  if (records.length === 0) {
    return (
      <EmptyState
        title="No TDS records yet"
        description="Deductions you record appear here until they are deposited."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3 font-semibold">Deductee</th>
            <th className="px-4 py-3 font-semibold">Section</th>
            <th className="px-4 py-3 text-right font-semibold">Amount paid</th>
            <th className="px-4 py-3 text-right font-semibold">TDS</th>
            <th className="px-4 py-3 font-semibold">Deducted</th>
            <th className="px-4 py-3 font-semibold">Deposited</th>
            {!readOnly && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {records.map((r) => (
            <TdsRow key={r.id} record={r} readOnly={readOnly} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TdsRow({ record, readOnly }: { record: TdsRecord; readOnly: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function markDeposited() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/tax/tds/${record.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deposited: true }),
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
      <td className="px-4 py-3 font-medium text-brand-slate">{record.deductee_name}</td>
      <td className="px-4 py-3 text-text-muted">{record.section ?? '—'}</td>
      <td className="px-4 py-3 text-right tabular-nums text-text-muted">
        {formatCurrency(record.amount_paid)}
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
        {formatCurrency(record.tds_deducted)}
      </td>
      <td className="px-4 py-3 text-text-muted">{formatDate(record.deduction_date)}</td>
      <td className="px-4 py-3">
        {record.deposited ? (
          <Badge className="badge-success">
            {record.deposited_date ? formatDate(record.deposited_date) : 'Deposited'}
          </Badge>
        ) : (
          <Badge className="badge-warning">Pending</Badge>
        )}
      </td>
      {!readOnly && (
        <td className="px-4 py-3 text-right">
          {!record.deposited ? (
            <>
              <button
                onClick={markDeposited}
                disabled={pending}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:bg-surface-bg disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Mark deposited'}
              </button>
              {error && <p className="mt-1 text-xs text-status-danger">⚠ {error}</p>}
            </>
          ) : null}
        </td>
      )}
    </tr>
  )
}
