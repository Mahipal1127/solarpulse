'use client'

import { Clock, CheckCircle2, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface PendingApproval {
  id: string
  approval_type: string
  created_at: string
  requester: { full_name: string } | null
  departments: { name: string } | null
}

const TYPE_LABELS: Record<string, string> = {
  budget: 'Budget',
  purchase: 'Purchase',
  leave: 'Leave',
  expense: 'Expense',
}

const TYPE_COLORS: Record<string, string> = {
  budget: 'bg-brand-gold/10 text-white',
  purchase: 'bg-status-warning/5 text-status-warning',
  leave: 'bg-status-success/5 text-status-success',
  expense: 'bg-status-danger/5 text-status-danger',
}

function hoursSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
}

export function ScheduleWidget({ approvals }: { approvals: PendingApproval[] }) {
  return (
    <div className="dashboard-card flex flex-col p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-brand-slate uppercase tracking-wider">
          Pending Approvals
        </h2>
        <Link
          href="/approvals"
          className="rounded-full border border-border-subtle bg-white px-3 py-1 text-xs font-semibold text-text-muted hover:bg-surface-bg transition flex items-center gap-1"
        >
          See All
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {approvals.length === 0 ? (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-status-success/5 border border-status-success/15 py-10">
          <CheckCircle2 className="h-8 w-8 text-status-success" />
          <p className="text-xs font-semibold text-status-success">All clear</p>
          <p className="text-[11px] text-status-success">No pending approvals</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {approvals.map((approval) => {
            const hours = hoursSince(approval.created_at)
            const isStale = hours >= 48
            return (
              <Link
                key={approval.id}
                href="/approvals"
                className="block rounded-2xl border border-border-subtle bg-surface-bg p-3.5 transition hover:bg-surface-bg hover:border-brand-gold/20"
              >
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[approval.approval_type] ?? 'bg-surface-bg text-text-muted'}`}>
                    {TYPE_LABELS[approval.approval_type] ?? approval.approval_type}
                  </span>
                  {isStale && (
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-status-danger/5 px-1.5 py-0.5 text-[10px] font-semibold text-status-danger border border-status-danger/15">
                      <Clock className="h-2.5 w-2.5" />
                      {hours}h
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs font-bold text-brand-slate truncate">
                  {approval.requester?.full_name ?? 'Unknown'}
                </p>
                <p className="text-[10px] text-text-muted/60 mt-0.5">
                  {approval.departments?.name ?? '—'} · {hours < 1 ? 'just now' : `${hours}h ago`}
                </p>
              </Link>
            )
          })}

          {/* Footer hint */}
          <p className="text-center text-[11px] text-text-muted/60 pt-1">
            Tap a card to review &amp; decide
          </p>
        </div>
      )}
    </div>
  )
}
