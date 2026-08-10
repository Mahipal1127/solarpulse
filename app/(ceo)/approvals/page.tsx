import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, Badge, EmptyState } from '@/components/ui/primitives'
import { SEGMENT_TRACK, segmentClass, pillClass } from '@/components/shared/chrome'
import { ApprovalDecisionButtons } from '@/components/ceo/ApprovalQueue/ApprovalDecisionButtons'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  hoursSince,
  APPROVAL_STATUS_STYLES,
} from '@/lib/format'
import type { ApprovalStatus, ApprovalType } from '@/lib/types'

type ApprovalRow = {
  id: string
  type: ApprovalType
  amount: number | null
  description: string | null
  status: ApprovalStatus
  created_at: string
  decided_at: string | null
  requester: { full_name: string } | null
  departments: { name: string } | null
  decider: { full_name: string } | null
}

const TABS: { value: ApprovalStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

const TYPES: { value: string; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'budget', label: 'Budget' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'leave', label: 'Leave' },
  { value: 'expense', label: 'Expense' },
]

const STALE_AFTER_HOURS = 48

export default async function ApprovalsPage(props: PageProps<'/approvals'>) {
  const user = await requireRole('CEO')
  const searchParams = await props.searchParams

  const tab = (asString(searchParams.tab) ?? 'pending') as ApprovalStatus
  const typeFilter = asString(searchParams.type) ?? ''

  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('approvals')
    .select(
      'id, type, amount, description, status, created_at, decided_at, requester:users!approvals_requested_by_fkey(full_name), departments(name), decider:users!approvals_decided_by_fkey(full_name)'
    )
    .eq('organization_id', user.organization_id)
    .eq('status', tab)
    .order('created_at', { ascending: false })
    .limit(200)

  if (typeFilter) query = query.eq('type', typeFilter)

  const { data } = await query
  const approvals = (data ?? []) as unknown as ApprovalRow[]

  const TYPE_ICONS: Record<string, string> = {
    budget: '💰', purchase: '🛒', leave: '🏖️', expense: '🧾',
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-slate">Approvals</h1>
        <p className="mt-1 text-sm text-text-muted">
          Budget, purchase, leave, and expense requests raised by departments.
        </p>
      </div>

      {/* Controls bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {/* Status tabs */}
        <div className={SEGMENT_TRACK}>
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={`/approvals?tab=${t.value}${typeFilter ? `&type=${typeFilter}` : ''}`}
              aria-current={tab === t.value ? 'page' : undefined}
              className={segmentClass(tab === t.value)}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* Type chips */}
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <Link
              key={t.value}
              href={`/approvals?tab=${tab}${t.value ? `&type=${t.value}` : ''}`}
              aria-current={typeFilter === t.value ? 'page' : undefined}
              className={pillClass(typeFilter === t.value)}
            >
              {t.value && TYPE_ICONS[t.value] ? `${TYPE_ICONS[t.value]} ` : ''}{t.label}
            </Link>
          ))}
        </div>
      </div>

      {/* List */}
      {approvals.length === 0 ? (
        <Card>
          <EmptyState
            title={`No ${tab} requests`}
            description="Requests raised by department modules will appear here."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => {
            const waiting = hoursSince(approval.created_at)
            const stale = approval.status === 'pending' && waiting > STALE_AFTER_HOURS

            return (
              <div
                key={approval.id}
                className="rounded-xl border border-border-subtle bg-white shadow-sm"
              >
                <div className="flex items-start justify-between gap-4 p-5">
                  {/* Left */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-bg px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                        {TYPE_ICONS[approval.type] ?? ''} {approval.type}
                      </span>
                      <Badge className={APPROVAL_STATUS_STYLES[approval.status]}>
                        {approval.status}
                      </Badge>
                      {stale && (
                        <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">
                          Waiting {Math.floor(waiting / 24)}d
                        </Badge>
                      )}
                      {approval.amount !== null && (
                        <span className="text-sm font-semibold text-brand-slate">
                          {formatCurrency(approval.amount)}
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-brand-slate leading-relaxed">
                      {approval.description ?? 'No description provided'}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span className="font-medium text-text-muted">
                        {approval.requester?.full_name ?? 'Unknown'}
                      </span>
                      <span>·</span>
                      <span>{approval.departments?.name ?? 'Unknown dept'}</span>
                      <span>·</span>
                      <span>{formatDate(approval.created_at)}</span>
                    </div>

                    {approval.status !== 'pending' && (
                      <p className="text-xs text-text-muted">
                        Decided by{' '}
                        <span className="font-medium text-text-muted">
                          {approval.decider?.full_name ?? '—'}
                        </span>{' '}
                        · {formatDateTime(approval.decided_at)}
                      </p>
                    )}
                  </div>

                  {/* Right: approve/reject */}
                  {approval.status === 'pending' && (
                    <ApprovalDecisionButtons
                      approvalId={approval.id}
                      summary={`${approval.type} request from ${
                        approval.departments?.name ?? 'a department'
                      }${approval.amount !== null ? ` for ${formatCurrency(approval.amount)}` : ''}.`}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
