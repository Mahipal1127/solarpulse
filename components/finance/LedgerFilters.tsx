'use client'

import { useRouter } from 'next/navigation'
import { LEDGER_ACCOUNT_CATEGORY_LABELS } from '@/lib/format'
import { LEDGER_ACCOUNT_CATEGORIES } from '@/lib/finance/constants'

const inputClass =
  'rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * URL-driven ledger filters. Category and date range live in the query string, so a filtered
 * view is shareable and survives refresh (the page reads them server-side). Changing a filter
 * pushes a new URL and the server re-queries; there is no client-side filtering.
 */
export function LedgerFilters({
  category,
  from,
  to,
}: {
  category: string
  from: string
  to: string
}) {
  const router = useRouter()

  function apply(next: { category?: string; from?: string; to?: string }) {
    const params = new URLSearchParams()
    const merged = { category, from, to, ...next }
    if (merged.category) params.set('category', merged.category)
    if (merged.from) params.set('from', merged.from)
    if (merged.to) params.set('to', merged.to)
    const qs = params.toString()
    router.push(qs ? `/finance/ledger?${qs}` : '/finance/ledger')
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="led-filter-cat" className={labelClass}>
          Category
        </label>
        <select
          id="led-filter-cat"
          value={category}
          onChange={(e) => apply({ category: e.target.value })}
          className={inputClass}
        >
          <option value="">All categories</option>
          {LEDGER_ACCOUNT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {LEDGER_ACCOUNT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="led-filter-from" className={labelClass}>
          From
        </label>
        <input
          id="led-filter-from"
          type="date"
          value={from}
          onChange={(e) => apply({ from: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="led-filter-to" className={labelClass}>
          To
        </label>
        <input
          id="led-filter-to"
          type="date"
          value={to}
          onChange={(e) => apply({ to: e.target.value })}
          className={inputClass}
        />
      </div>
      {(category || from || to) && (
        <button
          type="button"
          onClick={() => router.push('/finance/ledger')}
          className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Clear
        </button>
      )}
    </div>
  )
}
