import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { InstallationEditForm } from '@/components/om/InstallationForm/InstallationEditForm'
import { getOMEmployees } from '@/lib/om/dashboard'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import type { Installation } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function EditInstallationPage(
  props: PageProps<'/om/installations/[installationId]/edit'>
) {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)

  // The CEO reads this module; there is nothing to edit for them.
  if (isReadOnlyFor(user, OM_DEPARTMENT_SLUG)) redirect('/om/installations')

  const { installationId } = await props.params

  const supabase = await createSupabaseServerClient()
  const [{ data }, teamLeads] = await Promise.all([
    supabase.from('installations').select('*').eq('id', installationId).maybeSingle(),
    getOMEmployees(user.organization_id),
  ])

  // RLS decides visibility — a site the caller cannot see 404s rather than 403s.
  if (!data) notFound()
  const installation = data as unknown as Installation

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href={`/om/installations/${installationId}`}
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to installation
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Edit installation</h1>
        <p className="mt-1 text-sm text-text-muted">
          Status changes live on the installation page — this edits the schedule, size and site
          details.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <InstallationEditForm installation={installation} teamLeads={teamLeads} />
      </Card>
    </div>
  )
}
