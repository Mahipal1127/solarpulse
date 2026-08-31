import { requireRole } from '@/lib/auth/guards'
import { listApplicationsForCeo } from '@/lib/services/applications'
import { Card, CardHeader } from '@/components/ui/primitives'
import { ApplicationsInbox } from '@/components/shared/ApplicationsInbox'

export const dynamic = 'force-dynamic'

/**
 * CEO Applications — the free-text applications employees addressed to the CEO (recipient
 * 'ceo' or 'both'), newest first. The CEO works each by advancing its status (submitted →
 * acknowledged → closed). Leave requests are decided on the Approvals page, not here.
 */
export default async function CeoApplicationsPage() {
  await requireRole('CEO')
  const applications = await listApplicationsForCeo()

  const open = applications.filter((a) => a.status !== 'closed')

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Applications</h1>
        <p className="mt-1 text-sm text-text-muted">
          Written applications employees sent to you. Advance each as you handle it.
        </p>
      </header>

      <Card>
        <CardHeader title="Addressed to the CEO" subtitle={`${open.length} open`} />
        <ApplicationsInbox applications={applications} showRecipient />
      </Card>
    </div>
  )
}
