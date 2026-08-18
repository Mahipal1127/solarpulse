import Link from 'next/link'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getCustomerOptions, getInvoiceHandoffOptions } from '@/lib/finance/dashboard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { InvoiceForm } from '@/components/finance/InvoiceForm'

export const dynamic = 'force-dynamic'

/** searchParams values arrive as string | string[] | undefined; collapse to a single string. */
function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * Raise a new invoice. The conversion picker is fed uninvoiced closed deals / completed
 * installations (getInvoiceHandoffOptions), read under Finance's cross-department policies —
 * selecting one pre-fills the customer and amount and links the source. A read-only viewer
 * (CEO) is shown a notice instead of the form; creation is a Finance-member action.
 *
 * A ?handoff=kind:source_id param (the dashboard "Bill →" links carry it) pre-selects the
 * matching row so the form lands filled in, not empty.
 */
export default async function NewInvoicePage(props: PageProps<'/finance/invoices/new'>) {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])

  if (!isFinanceMember(user)) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">New invoice</h1>
        </header>
        <Card>
          <EmptyState
            title="Read-only"
            description="Invoices are created by the Finance team. You are viewing this module read-only."
          />
        </Card>
      </div>
    )
  }

  const searchParams = await props.searchParams
  const initialHandoff = asString(searchParams.handoff)

  const [customers, handoffs] = await Promise.all([
    getCustomerOptions(),
    getInvoiceHandoffOptions(),
  ])

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/finance/invoices" className="hover:text-brand-gold">
            Invoices
          </Link>
          <span>/</span>
          <span>New</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-slate">New invoice</h1>
      </header>

      <Card>
        <CardHeader title="Invoice details" />
        <div className="px-5 py-4">
          <InvoiceForm customers={customers} handoffs={handoffs} initialHandoff={initialHandoff} />
        </div>
      </Card>
    </div>
  )
}
