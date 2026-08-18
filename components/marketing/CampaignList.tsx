'use client'

import Link from 'next/link'
import { useState } from 'react'
import { EmptyState, Badge } from '@/components/ui/primitives'
import {
  CAMPAIGN_STATUS_STYLES,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_ORDER,
  CAMPAIGN_PLATFORM_LABELS,
  formatCurrency,
  formatCostPerLead,
} from '@/lib/format'
import type { CampaignRow } from '@/lib/marketing/dashboard'

/**
 * The campaign table. Cost-per-lead is the derived column that matters here —
 * amount_spent / leads_generated, rendered "—" while a campaign has drawn no leads
 * (formatCostPerLead owns that guard, so there is no divide-by-zero). A status filter
 * sits on top; "mine" is decided by the page before the rows reach this.
 */
export function CampaignList({ campaigns }: { campaigns: CampaignRow[] }) {
  const [status, setStatus] = useState<string>('all')

  const filtered =
    status === 'all' ? campaigns : campaigns.filter((c) => c.status === status)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <FilterChip label="All" active={status === 'all'} onClick={() => setStatus('all')} />
        {CAMPAIGN_STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            label={CAMPAIGN_STATUS_LABELS[s]}
            active={status === s}
            onClick={() => setStatus(s)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No campaigns"
          description="Campaigns you run across social and search show up here with their cost per lead."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-semibold">Campaign</th>
                <th className="px-4 py-3 font-semibold">Platform</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Spent</th>
                <th className="px-4 py-3 text-right font-semibold">Leads</th>
                <th className="px-4 py-3 text-right font-semibold">Cost / lead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filtered.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-surface-bg">
                  <td className="px-4 py-3">
                    <Link
                      href={`/marketing/campaigns/${c.id}`}
                      className="font-medium text-brand-slate hover:text-brand-gold"
                    >
                      {c.name}
                    </Link>
                    {c.manager?.full_name && (
                      <p className="mt-0.5 text-xs text-text-muted">{c.manager.full_name}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {c.platform ? CAMPAIGN_PLATFORM_LABELS[c.platform] ?? c.platform : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={CAMPAIGN_STATUS_STYLES[c.status]}>
                      {CAMPAIGN_STATUS_LABELS[c.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-brand-slate">
                    {formatCurrency(c.amount_spent)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-brand-slate">
                    {c.leads_generated}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-brand-slate">
                    {formatCostPerLead(c.amount_spent, c.leads_generated)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-brand-slate text-white'
          : 'border border-border-subtle text-text-muted hover:bg-surface-bg'
      }`}
    >
      {label}
    </button>
  )
}
