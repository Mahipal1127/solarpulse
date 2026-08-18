import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceLead } from '@/lib/services/finance'
import { getLedgerEntries } from '@/lib/finance/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { LedgerEntryForm } from '@/components/finance/LedgerEntryForm'
import { LedgerFilters } from '@/components/finance/LedgerFilters'
import {
  LEDGER_ACCOUNT_CATEGORY_LABELS,
  formatCurrency,
  formatDate,
} from '@/lib/format'
import { LEDGER_ACCOUNT_CATEGORIES } from '@/lib/finance/constants'
import type { LedgerAccountCategory } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * The ledger — a category-tagged, date-filterable list of debits and credits. Most entries
 * arrive through linked records (invoices, bills, expenses); manual entries are lead/CEO only
 * (the form only renders for them, and the service re-checks). RLS scopes visible rows.
 * Filters are URL-driven so a filtered view is shareable and survives refresh.
 */
export default async function LedgerPage(props: PageProps<'/finance/ledger'>) {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const lead = isFinanceLead(user)
  const searchParams = await props.searchParams

  const rawCategory = asString(searchParams.category)
  const category =
    rawCategory && (LEDGER_ACCOUNT_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as LedgerAccountCategory)
      : undefined
  const from = asString(searchParams.from)
  const to = asString(searchParams.to)

  const entries = await getLedgerEntries(category, from, to)
  const totalDebit = entries.reduce((s, e) => s + e.debit, 0)
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Ledger</h1>
        <p className="mt-1 text-sm text-text-muted">
          Debits and credits by account category. Most entries are posted automatically from the
          records they belong to.
        </p>
      </header>

      {lead && (
        <Card>
          <CardHeader
            title="Manual entry"
            subtitle="For adjustments and corrections. Linked records post their own entries."
          />
          <div className="px-5 py-4">
            <LedgerEntryForm />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Entries"
          subtitle={`${entries.length} shown · Dr ${formatCurrency(totalDebit)} · Cr ${formatCurrency(totalCredit)}`}
        />
        <div className="border-b border-border-subtle px-5 py-4">
          <LedgerFilters category={rawCategory ?? ''} from={from ?? ''} to={to ?? ''} />
        </div>
        {entries.length === 0 ? (
          <EmptyState
            title="No ledger entries"
            description="Nothing matches these filters yet. Clear them or record activity to see entries."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 text-right font-semibold">Debit</th>
                  <th className="px-4 py-3 text-right font-semibold">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {entries.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-text-muted">{formatDate(e.entry_date)}</td>
                    <td className="px-4 py-3">
                      <Badge className="badge-neutral">
                        {LEDGER_ACCOUNT_CATEGORY_LABELS[e.account_category]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-brand-slate">{e.description}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {e.debit > 0 ? formatCurrency(e.debit) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {e.credit > 0 ? formatCurrency(e.credit) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
