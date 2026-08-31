import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import { getCandidates, getActiveUsers } from '@/lib/hr/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { CandidateForm } from '@/components/hr/CandidateForm'
import { InterviewForm } from '@/components/hr/InterviewForm'
import { CandidateList } from '@/components/hr/CandidateList'

export const dynamic = 'force-dynamic'

/**
 * Recruitment — the candidate pipeline plus interview scheduling. Standard three-tier:
 * any HR member works it, the CEO reads it. Not an ATS — simple records, no resume
 * parsing or sourcing automation.
 */
export default async function RecruitmentPage() {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, HR_DEPARTMENT_SLUG)
  // Onboarding provisions a login, so it is HR-lead / CEO work (the wizard redirects a
  // non-lead). Only they see the "Onboard" shortcut on a hired candidate.
  const canOnboard = isHrLead(user) || user.roleName === 'CEO'
  const supabase = await createSupabaseServerClient()

  const [candidates, users, deptRes] = await Promise.all([
    getCandidates(),
    getActiveUsers(),
    supabase
      .from('departments')
      .select('id, name')
      .eq('organization_id', user.organization_id)
      .order('name', { ascending: true }),
  ])

  const departments = (deptRes.data ?? []) as { id: string; name: string }[]
  // Candidates still open for interviews (not hired/rejected) as scheduling targets.
  const openCandidates = candidates
    .filter((c) => c.status !== 'hired' && c.status !== 'rejected')
    .map((c) => ({ id: c.id, name: c.name }))

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Recruitment</h1>
        <p className="mt-1 text-sm text-text-muted">
          Candidates and interviews. Move a candidate through the pipeline as they progress.
        </p>
      </header>

      {!readOnly && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Add candidate" />
            <div className="px-5 py-4">
              <CandidateForm departments={departments} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Schedule interview" />
            <div className="px-5 py-4">
              {openCandidates.length === 0 ? (
                <p className="text-sm text-text-muted">Add a candidate first.</p>
              ) : (
                <InterviewForm candidates={openCandidates} interviewers={users} />
              )}
            </div>
          </Card>
        </div>
      )}

      <CandidateList candidates={candidates} readOnly={readOnly} canOnboard={canOnboard} />
    </div>
  )
}
