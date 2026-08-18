import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getPmSuryaGharAnalysis } from '@/lib/store/dashboard'
import { PMSuryaGharAnalysis } from '@/components/store/PMSuryaGharAnalysis/PMSuryaGharAnalysis'

export const dynamic = 'force-dynamic'

/**
 * PM Surya Ghar Analysis (Basic). A read-only aggregation computed from O&M's installations and
 * DISCOM's subsidy_cases — Store owns none of this data, it only reads across the boundary
 * (the same way DISCOM's dashboard reads O&M). RLS on those tables still governs what the
 * caller can see.
 */
export default async function PmSuryaGharPage() {
  await requireDepartment(STORE_DEPARTMENT_SLUG)
  const analysis = await getPmSuryaGharAnalysis()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">PM Surya Ghar Analysis</h1>
        <p className="mt-1 text-sm text-text-muted">
          Installations and subsidy progress across the company, read from Operations and DISCOM.
        </p>
      </header>

      <PMSuryaGharAnalysis analysis={analysis} />
    </div>
  )
}
