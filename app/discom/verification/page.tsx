import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, CardHeader, EmptyState, Badge } from '@/components/ui/primitives'
import { ConsumerVerificationForm } from '@/components/discom/ConsumerVerificationForm'
import { getConsumerVerifications } from '@/lib/discom/dashboard'
import { getCompletedInstallations } from '@/lib/discom/queries'
import { DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Consumer verification — the liaison confirming a customer's DISCOM identity matches
 * the paperwork. The form records a check; the list below shows recent ones. RLS
 * decides which checks a liaison sees (their own) versus a lead/CEO (the department's).
 */
export default async function VerificationPage() {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)

  const [installations, verifications] = await Promise.all([
    getCompletedInstallations(user.organization_id),
    getConsumerVerifications(),
  ])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Consumer Verification</h1>
        <p className="mt-1 text-sm text-text-muted">
          Confirm the consumer number, identity and address match before the paperwork goes to the
          board.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {!readOnly && (
          <Card className="p-6">
            <ConsumerVerificationForm installations={installations} />
          </Card>
        )}

        <Card className={readOnly ? 'lg:col-span-2' : ''}>
          <CardHeader title="Recent verifications" subtitle="Newest first." />
          {verifications.length === 0 ? (
            <EmptyState
              title="No verifications yet"
              description="Recorded checks will appear here."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {verifications.map((v) => (
                <li key={v.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-brand-slate">
                      {v.customer?.name ?? 'Unknown customer'}
                    </p>
                    <span className="text-xs text-text-muted">{formatDateTime(v.verified_at)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <CheckBadge label="Consumer no." ok={v.consumer_number_verified} />
                    <CheckBadge label="Identity" ok={v.identity_verified} />
                    <CheckBadge label="Address" ok={v.address_verified} />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {v.verifier?.full_name ?? 'Unknown'}
                    {v.installation?.address ? ` · ${v.installation.address}` : ''}
                    {v.notes ? ` · ${v.notes}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function CheckBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Badge className={ok ? 'badge-success' : 'badge-neutral'}>
      {ok ? '✓' : '—'} {label}
    </Badge>
  )
}
