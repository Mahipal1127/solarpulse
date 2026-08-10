import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { VendorForm } from '@/components/distribution/VendorForm/VendorForm'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'

export const dynamic = 'force-dynamic'

export default async function NewVendorPage() {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)

  // The CEO reads this module but does not write to it. Sending them back rather
  // than rendering a form whose POST the service layer would refuse anyway.
  if (isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)) redirect('/distribution/vendors')

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/distribution/vendors" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to vendors
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Add a vendor</h1>
        <p className="mt-1 text-sm text-text-muted">
          Only active vendors appear when raising a purchase order.
        </p>
      </div>

      <Card className="max-w-3xl px-5 py-5">
        <VendorForm mode="create" />
      </Card>
    </div>
  )
}
