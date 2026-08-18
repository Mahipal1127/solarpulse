import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, Badge } from '@/components/ui/primitives'
import { ContractControls } from '@/components/om/AMCTracker/ContractControls'
import { VisitsSection } from '@/components/om/AMCTracker/VisitsSection'
import { getOMEmployees } from '@/lib/om/dashboard'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import {
  formatDate,
  formatCurrency,
  amcDisplayStatus,
  AMC_DISPLAY_STATUS_STYLES,
  AMC_DISPLAY_STATUS_LABELS,
  formatVisitFrequency,
} from '@/lib/format'
import type { AmcContract, AmcVisit } from '@/lib/types'

export const dynamic = 'force-dynamic'

type ContractRow = AmcContract & {
  customer: { name: string } | null
  assignee: { full_name: string } | null
  installation: { id: string; address: string | null } | null
}
type VisitRow = AmcVisit & { performer: { full_name: string } | null }

export default async function AMCDetailPage(props: PageProps<'/om/amc/[contractId]'>) {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, OM_DEPARTMENT_SLUG)
  const { contractId } = await props.params

  const supabase = await createSupabaseServerClient()

  const [{ data: contractData }, { data: visitData }, engineers] = await Promise.all([
    supabase
      .from('amc_contracts')
      .select(
        `*,
         customer:customers(name),
         assignee:users!amc_contracts_assigned_to_fkey(full_name),
         installation:installations(id, address)`
      )
      .eq('id', contractId)
      .maybeSingle(),
    supabase
      .from('amc_visits')
      .select('*, performer:users!amc_visits_performed_by_fkey(full_name)')
      .eq('amc_contract_id', contractId)
      .order('scheduled_date', { ascending: false }),
    getOMEmployees(user.organization_id),
  ])

  // RLS decides visibility — a contract the caller cannot see 404s rather than 403s.
  if (!contractData) notFound()
  const contract = contractData as unknown as ContractRow
  const visits = (visitData ?? []) as unknown as VisitRow[]

  const display = amcDisplayStatus(contract)

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <Link href="/om/amc" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to AMC
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-brand-slate">
                {contract.customer?.name ?? 'Unknown customer'}
              </h1>
              <Badge className={AMC_DISPLAY_STATUS_STYLES[display]}>
                {AMC_DISPLAY_STATUS_LABELS[display]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {formatDate(contract.start_date)} → {formatDate(contract.end_date)} ·{' '}
              {formatVisitFrequency(contract.visit_frequency)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Contract details</h2>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Coverage">
              {formatDate(contract.start_date)} → {formatDate(contract.end_date)}
            </Field>
            <Field label="Visit frequency">
              {formatVisitFrequency(contract.visit_frequency)}
            </Field>
            <Field label="Contract value">
              {contract.amount !== null ? formatCurrency(contract.amount) : 'Not recorded'}
            </Field>
            <Field label="Responsible engineer">
              {contract.assignee?.full_name ?? 'Unassigned'}
            </Field>
            {contract.installation && (
              <Field label="Installation">
                <Link
                  href={`/om/installations/${contract.installation.id}`}
                  className="text-brand-gold hover:underline"
                >
                  {contract.installation.address ?? 'View site'}
                </Link>
              </Field>
            )}
          </dl>
        </Card>

        <Card>
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Manage</h2>
          </div>
          <div className="px-5 py-4">
            {readOnly ? (
              <p className="text-xs text-text-muted">
                Only the Operations &amp; Maintenance department can change this contract.
              </p>
            ) : (
              <ContractControls
                contractId={contractId}
                status={contract.status}
                endDate={contract.end_date}
                assignedTo={contract.assigned_to}
                engineers={engineers}
              />
            )}
          </div>
        </Card>
      </div>

      <VisitsSection
        contractId={contractId}
        visits={visits}
        engineers={engineers}
        readOnly={readOnly || contract.status === 'cancelled'}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-brand-slate">{children}</dd>
    </div>
  )
}
