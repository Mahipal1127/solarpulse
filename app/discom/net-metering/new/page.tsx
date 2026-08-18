import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { NetMeteringForm } from '@/components/discom/NetMeteringForm'
import { getCompletedInstallations } from '@/lib/discom/queries'
import { getDiscomEmployees } from '@/lib/discom/dashboard'
import { DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'

export const dynamic = 'force-dynamic'

export default async function NewNetMeteringPage(props: PageProps<'/discom/net-metering/new'>) {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)

  // The CEO's access to this module is read-only; there is nothing for them here.
  if (isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)) redirect('/discom/net-metering')

  const searchParams = await props.searchParams
  const initialInstallationId = asString(searchParams.installation_id) ?? ''

  const [installations, liaisons] = await Promise.all([
    getCompletedInstallations(user.organization_id),
    getDiscomEmployees(user.organization_id),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/discom/net-metering" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to net metering
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">New net metering application</h1>
        <p className="mt-1 text-sm text-text-muted">
          Opens from a completed installation. It starts as Not Started — record each status change
          as the board processes it, so the time-in-status clock stays accurate.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <NetMeteringForm
          installations={installations}
          liaisons={liaisons}
          initialInstallationId={initialInstallationId}
        />
      </Card>
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
