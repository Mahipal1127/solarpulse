import 'server-only'

import Link from 'next/link'
import { ArrowUpRight, TrendingUp, Gavel, Truck, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatCompactCurrency } from '@/lib/format'
import type { CrossDepartmentMetrics } from '@/lib/ceo/metrics'

/**
 * The business beyond the task board: Sales, Tender, Distribution, Technical.
 *
 * WHY GROUPED BY DEPARTMENT RATHER THAN EIGHT LOOSE TILES
 * A CEO reads this org one department at a time — "how is Sales doing" is a real
 * question, "how are open leads doing" is not. Grouping also gives each card one
 * honest destination, which eight tiles could not: the whole card is a link into that
 * module, so the corner arrow points at something. The CEO passes every
 * requireDepartment() check and lands read-only, per isReadOnlyFor().
 *
 * WHERE THE GOLD GOES
 * One figure on this row is gold: revenue. The design system budgets the accent at a
 * handful of places per screen, and four gold headline numbers would highlight
 * nothing. Revenue is the figure a CEO opens a dashboard to see; the rest are
 * brand-slate, and only a genuine problem count turns amber.
 *
 * These are counted from real rows, so a zero means zero — not "not wired up yet".
 * The AwaitingModule state stays for the metrics that really have no owner (Finance
 * revenue, HR attendance); see lib/departments/contracts.ts.
 */
export function DepartmentMetrics({ metrics }: { metrics: CrossDepartmentMetrics }) {
  const { sales, tender, distribution, technical } = metrics

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Across the business
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricGroup
          href="/sales/dashboard"
          label="Sales"
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          headline={formatCompactCurrency(sales.revenueThisMonth)}
          headlineLabel="Closed this month"
          tone="brand"
          unavailable={sales.unavailable}
          figures={[
            { label: 'Deals won', value: sales.dealsClosedThisMonth },
            { label: 'Open leads', value: sales.openLeads },
          ]}
        />

        <MetricGroup
          href="/tenders"
          label="Tender"
          icon={<Gavel className="h-3.5 w-3.5" />}
          headline={tender.activeTenders}
          headlineLabel="Active tenders"
          unavailable={tender.unavailable}
          figures={[
            {
              label: 'Closing in 7 days',
              value: tender.closingSoon,
              alert: tender.closingSoon > 0,
            },
            { label: 'Pipeline', value: formatCompactCurrency(tender.pipelineValue) },
          ]}
        />

        <MetricGroup
          href="/distribution/dashboard"
          label="Distribution"
          icon={<Truck className="h-3.5 w-3.5" />}
          headline={distribution.openPurchaseOrders}
          headlineLabel="Open purchase orders"
          unavailable={distribution.unavailable}
          figures={[
            {
              label: 'Awaiting Finance',
              value: distribution.awaitingFinanceApproval,
              alert: distribution.awaitingFinanceApproval > 0,
            },
            {
              label: 'Committed',
              value: formatCompactCurrency(distribution.openPurchaseOrderValue),
            },
          ]}
        />

        <MetricGroup
          href="/technical/dashboard"
          label="Technical"
          icon={<Wrench className="h-3.5 w-3.5" />}
          headline={technical.surveysInFlight}
          headlineLabel="Surveys in progress"
          unavailable={technical.unavailable}
          figures={[
            {
              label: 'Open IT tickets',
              value: technical.openITTickets,
              alert: technical.openITTickets > 0,
            },
          ]}
        />
      </div>
    </section>
  )
}

interface Figure {
  label: string
  value: string | number
  /**
   * Turns the figure amber. For counts that mean someone is waiting on somebody —
   * a deadline inside the week, a PO parked at Finance — not for anything merely
   * non-zero, or the colour stops carrying information.
   */
  alert?: boolean
}

function MetricGroup({
  href,
  label,
  icon,
  headline,
  headlineLabel,
  figures,
  tone = 'default',
  unavailable = false,
}: {
  href: string
  label: string
  icon: ReactNode
  headline: string | number
  headlineLabel: string
  figures: Figure[]
  tone?: 'default' | 'brand'
  /** A read failed. Renders an em dash instead of the numbers — see MetricAvailability. */
  unavailable?: boolean
}) {
  return (
    <Link
      href={href}
      className="dashboard-card flex flex-col p-5 transition-shadow hover:shadow-sm"
    >
      <span className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-muted/60" />
      </span>

      {unavailable ? (
        <>
          {/*
            An em dash, not a 0, and no gold. The figure is unknown, and gold on an
            unknown would draw the eye to the one number that means nothing.
          */}
          <p className="mt-3 text-2xl font-bold tracking-tight text-text-muted/50">—</p>
          <p className="mt-0.5 text-xs text-text-muted">Couldn&apos;t load {label} figures</p>
        </>
      ) : (
        <>
          <p
            className={`mt-3 text-2xl font-bold tracking-tight ${
              tone === 'brand' ? 'text-brand-gold' : 'text-brand-slate'
            }`}
          >
            {headline}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">{headlineLabel}</p>
        </>
      )}

      {/*
        mt-auto pushes this row to the bottom, so the dividers line up across the row
        even though Technical carries one figure and its neighbours carry two.

        Plain elements rather than a dl: the value is shown above its label, which is
        the reverse of the dt-then-dd order a definition list requires. StatCard states
        the same pair the same way.
      */}
      <div className="mt-auto flex flex-wrap gap-x-6 gap-y-2 border-t border-border-subtle pt-3.5">
        {figures.map((figure) => (
          <div key={figure.label}>
            {/*
              The labels stay when the read failed, so the card keeps its shape and it
              is clear *which* figures are missing. Only the values become dashes, and
              an alert tone is suppressed — amber on an unknown count would report a
              problem the data does not support.
            */}
            <p
              className={`text-sm font-semibold ${
                unavailable
                  ? 'text-text-muted/50'
                  : figure.alert
                    ? 'text-status-warning'
                    : 'text-brand-slate'
              }`}
            >
              {unavailable ? '—' : figure.value}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">{figure.label}</p>
          </div>
        ))}
      </div>
    </Link>
  )
}
