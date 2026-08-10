'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FileText, Sun } from 'lucide-react'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  formatSystemSize,
  DESIGN_STATUS_STYLES,
  DESIGN_STATUS_LABELS,
} from '@/lib/format'
import { pillClass } from '@/components/shared/chrome'
import type { Design, DesignStatus } from '@/lib/types'

export type DesignRow = Design & {
  designer: { full_name: string } | null
  survey: { id: string; lead: { name: string } | null } | null
}

const STATUS_FILTERS: (DesignStatus | 'all')[] = [
  'all',
  'draft',
  'under_review',
  'approved',
  'sent_to_sales',
]

export function DesignList({
  designs,
  currentUserId,
  /** A Technical lead sees everyone's designs, so a "mine only" filter is worth offering. */
  showOwnerFilter = false,
}: {
  designs: DesignRow[]
  currentUserId: string
  showOwnerFilter?: boolean
}) {
  const [status, setStatus] = useState<DesignStatus | 'all'>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return designs.filter((design) => {
      if (status !== 'all' && design.status !== status) return false
      if (mineOnly && design.designed_by !== currentUserId) return false
      if (!term) return true
      return (
        (design.survey?.lead?.name ?? '').toLowerCase().includes(term) ||
        (design.designer?.full_name ?? '').toLowerCase().includes(term) ||
        (design.inverter_spec ?? '').toLowerCase().includes(term)
      )
    })
  }, [designs, status, mineOnly, currentUserId, search])

  return (
    <Card>
      <CardHeader title="Designs" subtitle={`${visible.length} of ${designs.length} shown`} />

      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface-bg px-5 py-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option}
              onClick={() => setStatus(option)}
              className={pillClass(status === option)}
            >
              {option === 'all' ? 'All' : DESIGN_STATUS_LABELS[option]}
            </button>
          ))}
        </div>

        {showOwnerFilter && (
          <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-subtle text-brand-slate "
            />
            Designed by me
          </label>
        )}

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer, designer, inverter"
          aria-label="Search designs"
          className="ml-auto w-56 rounded-lg border border-border-subtle px-3 py-1.5 text-sm outline-none focus:border-brand-gold"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No designs match"
          description={
            designs.length === 0
              ? 'A design starts from a completed survey — open one and use Start Design.'
              : 'Try a different status or clear the search.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {visible.map((design) => (
            <li key={design.id}>
              <Link
                href={`/technical/designs/${design.id}`}
                className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-bg"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-brand-slate">
                      {design.survey?.lead?.name ?? 'No lead linked'}
                    </p>
                    <Badge className={DESIGN_STATUS_STYLES[design.status]}>
                      {DESIGN_STATUS_LABELS[design.status]}
                    </Badge>
                  </div>

                  <p className="mt-1 text-xs text-text-muted">
                    {design.designer?.full_name ?? 'Unknown'}
                    {' · '}
                    {formatSystemSize(design.system_size_kw)}
                    {design.panel_count ? ` · ${design.panel_count} panels` : ''}
                    {design.panel_wattage ? ` × ${design.panel_wattage} W` : ''}
                  </p>

                  {design.inverter_spec && (
                    <p className="mt-1 line-clamp-1 text-xs text-text-muted">
                      {design.inverter_spec}
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  {/* What is actually on file, at a glance. */}
                  <div className="flex items-center justify-end gap-1.5 text-text-muted/60">
                    {(design.layout_file_path || design.sld_file_path) && (
                      <FileText className="h-3.5 w-3.5" aria-label="Documents attached" />
                    )}
                    {design.boq_data && design.boq_data.length > 0 && (
                      <Sun className="h-3.5 w-3.5" aria-label="Bill of quantities recorded" />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-text-muted/60">{formatDate(design.created_at)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
