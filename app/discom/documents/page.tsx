import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { DocumentManager } from '@/components/discom/DocumentManager'
import { getDocuments } from '@/lib/discom/dashboard'
import { getCaseOptions } from '@/lib/discom/queries'
import { DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'

export const dynamic = 'force-dynamic'

/**
 * The government-document library. Opened plainly it shows every document the caller
 * can see; opened from a case ("Manage →") it pins that case via a query param, so
 * an upload lands on the right application without the picker.
 */
export default async function DocumentsPage(props: PageProps<'/discom/documents'>) {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const nmId = asString(searchParams.net_metering_application_id)
  const subsidyId = asString(searchParams.subsidy_case_id)

  const [documents, cases] = await Promise.all([
    getDocuments(user.organization_id, {
      netMeteringApplicationId: nmId,
      subsidyCaseId: subsidyId,
    }),
    getCaseOptions(user.organization_id),
  ])

  const lockedCase =
    (nmId && cases.find((c) => c.kind === 'net_metering' && c.id === nmId)) ||
    (subsidyId && cases.find((c) => c.kind === 'subsidy' && c.id === subsidyId)) ||
    undefined

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Documents</h1>
        <p className="mt-1 text-sm text-text-muted">
          {lockedCase
            ? `Documents for ${lockedCase.label}.`
            : 'Government paperwork across your net metering and subsidy cases.'}
        </p>
      </div>

      <DocumentManager
        organizationId={user.organization_id}
        documents={documents}
        cases={cases}
        lockedCase={lockedCase || undefined}
        readOnly={readOnly}
      />
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
