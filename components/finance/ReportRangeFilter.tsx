'use client'

import { useRouter } from 'next/navigation'

const inputClass =
  'rounded-lg border border-border-subtle px-2 py-1 text-xs outline-none focus:border-brand-gold'

/**
 * URL-driven date range for the P&L. Both dates live in the query string so a chosen period
 * is shareable and survives refresh; the page reads them server-side and recomputes. Changing
 * a bound pushes a new URL.
 */
export function ReportRangeFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter()

  function apply(next: { from?: string; to?: string }) {
    const merged = { from, to, ...next }
    const params = new URLSearchParams()
    if (merged.from) params.set('from', merged.from)
    if (merged.to) params.set('to', merged.to)
    router.push(`/finance/reports?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        aria-label="From"
        value={from}
        onChange={(e) => apply({ from: e.target.value })}
        className={inputClass}
      />
      <span className="text-xs text-text-muted">–</span>
      <input
        type="date"
        aria-label="To"
        value={to}
        onChange={(e) => apply({ to: e.target.value })}
        className={inputClass}
      />
    </div>
  )
}
