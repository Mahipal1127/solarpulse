import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { BrandProfileForm } from '@/components/marketing/BrandProfileForm'
import { ScriptLibraryPanel } from '@/components/marketing/ScriptLibraryPanel'
import { ScriptGeneratorPanel } from '@/components/marketing/ScriptGeneratorPanel'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { getBrandProfile, listLibrary, listScripts } from '@/lib/services/marketing-creative'

export const dynamic = 'force-dynamic'

/**
 * AI Creative — the script engine, one step below AI Insights in the sidebar.
 *
 * Three stacked surfaces, in the order the work actually flows:
 *   1. Brand profile — the one-time form the AI writes from ("mainly", per the choice made).
 *   2. Script library — the two upload lanes (own / competitor + inspiration) the AI compares
 *      against, plus the approved scripts it now writes in the style of.
 *   3. AI script writer — brief in, grounded script out, approve to teach the house style.
 *
 * It sits on its own page rather than inside Insights because it is a full workspace, not a
 * feed; and in the SIDEBAR rather than a tab strip because this module deliberately moved its
 * navigation there. The CEO reads all of it (isReadOnlyFor) and writes none — the same boundary
 * every /api/marketing/* route re-checks, so the read-only flag here is a courtesy, the route
 * guard and RLS are the enforcement.
 */
export default async function AICreativePage() {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)

  const [profile, library, scripts] = await Promise.all([
    getBrandProfile(),
    listLibrary(),
    listScripts(),
  ])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">AI Creative</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Write Instagram scripts that are grounded in who you are, what your audience responds
          to, and the scripts you already know work. Approve the good ones and the AI keeps
          getting closer to your voice.
        </p>
      </div>

      <BrandProfileForm profile={profile} readOnly={readOnly} />
      <ScriptLibraryPanel entries={library} readOnly={readOnly} />
      <ScriptGeneratorPanel scripts={scripts} readOnly={readOnly} />
    </div>
  )
}
