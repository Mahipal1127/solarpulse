import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { DesignForm } from '@/components/technical/DesignForm/DesignForm'
import { TECHNICAL_DEPARTMENT_SLUG, isTechnicalLead } from '@/lib/services/technical'
import type { Design } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function EditDesignPage(
  props: PageProps<'/technical/designs/[designId]/edit'>
) {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)
  const { designId } = await props.params

  // The CEO reads this module but does not write to it.
  if (isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)) {
    redirect(`/technical/designs/${designId}`)
  }

  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('designs')
    .select('*, survey:site_surveys(assigned_engineer_id)')
    .eq('id', designId)
    .maybeSingle()

  if (!data) notFound()

  const design = data as unknown as Design & {
    survey: { assigned_engineer_id: string } | null
  }

  /**
   * Mirrors the engineer_own_designs policy: the author or the surveying engineer. A
   * Design Engineer often works from a colleague's survey, so either one alone would
   * lock out the other.
   */
  const mayEdit =
    isTechnicalLead(user) ||
    design.designed_by === user.id ||
    design.survey?.assigned_engineer_id === user.id

  if (!mayEdit) redirect(`/technical/designs/${designId}`)

  /**
   * A design sent to Sales is frozen — a quotation may rest on its figures. The
   * service layer refuses the PATCH outright, so rendering the form would only offer
   * a save that comes back 400.
   */
  if (design.status === 'sent_to_sales') redirect(`/technical/designs/${designId}`)

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href={`/technical/designs/${designId}`}
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to design
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Edit design</h1>
        <p className="mt-1 text-sm text-text-muted">
          Sizing and the bill of quantities. The layout, single line diagram and generation figures
          are attached from the design page, and the status is moved from there too.
        </p>
      </div>

      {design.status === 'approved' && (
        <Card className="border-status-warning/30 bg-status-warning/5 px-5 py-4">
          <p className="text-sm text-status-warning">
            This design is approved but not yet sent to Sales. Changing the figures now means what
            was approved is no longer what is on file — worth another review pass before it goes
            out.
          </p>
        </Card>
      )}

      <Card className="max-w-3xl px-5 py-5">
        <DesignForm mode="edit" design={design} />
      </Card>
    </div>
  )
}
