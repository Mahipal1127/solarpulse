import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { ServiceTicketForm } from '@/components/om/ServiceTicketQueue/ServiceTicketForm'
import { getCustomerOptions, getInstallationOptions } from '@/lib/om/queries'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'

export const dynamic = 'force-dynamic'

export default async function NewServiceTicketPage() {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)

  if (isReadOnlyFor(user, OM_DEPARTMENT_SLUG)) redirect('/om/service')

  const [customers, installations] = await Promise.all([
    getCustomerOptions(user.organization_id),
    getInstallationOptions(user.organization_id),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/om/service" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to service
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Log service ticket</h1>
        <p className="mt-1 text-sm text-text-muted">
          Record a customer complaint. It enters the queue as Open — assign it and work it through
          to resolution from the ticket page.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <ServiceTicketForm customers={customers} installations={installations} />
      </Card>
    </div>
  )
}
