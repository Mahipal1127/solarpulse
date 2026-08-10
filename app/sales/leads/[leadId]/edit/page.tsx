import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { LeadForm } from '@/components/sales/LeadForm/LeadForm'
import { getSalesEmployees } from '@/lib/sales/queries'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'
import type { Lead } from '@/lib/types'

export default async function EditLeadPage(props: PageProps<'/sales/leads/[leadId]/edit'>) {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  if (isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)) redirect('/sales/leads')

  const { leadId } = await props.params
  const canAssign = isSalesManager(user)

  const supabase = await createSupabaseServerClient()

  const [{ data: lead }, employees] = await Promise.all([
    supabase.from('leads').select('*').eq('id', leadId).maybeSingle(),
    canAssign ? getSalesEmployees(user.organization_id) : Promise.resolve([]),
  ])

  // RLS decides this, not a filter above: an executive asking for a colleague's
  // lead gets no row, which is the same 404 as a lead that does not exist. Not
  // distinguishing the two is deliberate — a 403 would confirm the lead is real.
  if (!lead) notFound()

  // A won lead has a closure record and a customer row behind it. updateLead()
  // rejects the PATCH anyway; redirecting stops us from rendering a form whose
  // every submit is guaranteed to fail.
  if (lead.status === 'won') redirect(`/sales/leads/${leadId}`)

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href={`/sales/leads/${leadId}`}
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to lead
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Edit lead</h1>
        <p className="mt-1 text-sm text-text-muted">
          Contact details and qualification notes. Pipeline stage changes happen on the lead page,
          where the quotation and closure records that justify them live.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <LeadForm
          mode="edit"
          lead={lead as Lead}
          employees={employees}
          canAssign={canAssign}
        />
      </Card>
    </div>
  )
}
