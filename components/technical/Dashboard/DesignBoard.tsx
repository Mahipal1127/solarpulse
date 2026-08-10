import Link from 'next/link'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { Send } from 'lucide-react'
import {
  formatDate,
  formatSystemSize,
  DESIGN_STATUS_STYLES,
  DESIGN_STATUS_LABELS,
} from '@/lib/format'
import type { DesignWithContext } from '@/lib/technical/dashboard'

/**
 * Designs still being worked on, and designs approved but not yet handed to Sales.
 *
 * Two lists in one card because they are two ends of the same piece of work, and the
 * second is the one that goes quiet: an approved design sitting undelivered looks
 * finished on every status board while Sales still has nothing to quote from. The
 * handover is manual by design — this module never creates a Sales quotation — so
 * something has to keep the un-handed-over pile visible or it becomes invisible.
 */
export function DesignBoard({
  wip,
  readyForSales,
  canOperate,
  scope,
}: {
  wip: DesignWithContext[]
  readyForSales: DesignWithContext[]
  /** Technical member: may open the design and hand it over. False for the CEO. */
  canOperate: boolean
  scope: 'mine' | 'team'
}) {
  return (
    <Card>
      <CardHeader
        title={scope === 'team' ? 'Department designs' : 'My designs'}
        subtitle="In progress, and approved but not yet handed over"
        action={
          <Link
            href="/technical/designs"
            className="text-xs font-medium text-brand-slate hover:text-brand-slate"
          >
            All designs →
          </Link>
        }
      />

      {readyForSales.length > 0 && (
        <div className="border-b border-border-subtle bg-status-success/5 px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-status-success">
            Approved, waiting to go to Sales
          </p>
          <p className="mt-0.5 text-xs text-status-success">
            Handing over is a deliberate step — nothing reaches Sales until someone sends it.
          </p>

          <ul className="mt-2.5 space-y-2">
            {readyForSales.map((design) => (
              <li key={design.id} className="flex items-center justify-between gap-3">
                <Link
                  href={`/technical/designs/${design.id}`}
                  className="truncate text-sm font-medium text-brand-slate hover:text-brand-slate"
                >
                  {design.survey?.lead?.name ?? 'Unnamed site'}
                  <span className="ml-1.5 text-xs font-normal text-text-muted">
                    {formatSystemSize(design.system_size_kw)}
                  </span>
                </Link>

                {canOperate && (
                  <Link
                    href={`/technical/designs/${design.id}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-status-success"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Hand over
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {wip.length === 0 ? (
        <EmptyState
          title="No designs in progress"
          description={
            readyForSales.length > 0
              ? 'Everything else is approved and listed above.'
              : 'A design starts from a completed survey — open one and use Start design.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {wip.map((design) => (
            <li key={design.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <Link
                  href={`/technical/designs/${design.id}`}
                  className="block truncate text-sm font-medium text-brand-slate hover:text-brand-slate"
                >
                  {design.survey?.lead?.name ?? 'Unnamed site'}
                </Link>
                <p className="mt-1 text-xs text-text-muted">
                  {formatSystemSize(design.system_size_kw)}
                  {design.panel_count ? ` · ${design.panel_count} panels` : ''}
                  {scope === 'team' && design.designer
                    ? ` · ${design.designer.full_name}`
                    : ''}
                  {' · updated '}
                  {formatDate(design.updated_at)}
                </p>
              </div>

              <Badge className={DESIGN_STATUS_STYLES[design.status]}>
                {DESIGN_STATUS_LABELS[design.status]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
