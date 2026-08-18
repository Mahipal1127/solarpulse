import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError, type ActionSource } from '@/lib/services/tasks'
import type { SessionUser } from '@/lib/auth/guards'
import type { ApprovalDecisionInput } from '@/lib/validation/schemas'
import type { Approval } from '@/lib/types'

/**
 * The single approval-decision path, shared by the approvals UI and the AI
 * confirm route.
 */
export async function decideApproval(
  user: SessionUser,
  approvalId: string,
  input: ApprovalDecisionInput,
  source: ActionSource = 'manual'
): Promise<Approval> {
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('approvals')
    .select('id, status, type, amount, department_id')
    .eq('id', approvalId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Approval not found', 404)
  if (existing.status !== 'pending') {
    throw new ServiceError(`This request was already ${existing.status}`, 409)
  }

  const { data, error } = await supabase
    .from('approvals')
    .update({
      status: input.decision,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq('id', approvalId)
    // Guards against two decisions racing: the second update matches no row.
    .eq('status', 'pending')
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('This request was already decided', 409)

  // Leave integration (HR module): a leave request creates a linked approvals row of
  // type 'leave' (see submit_leave_request in migration 0015). When that approval is
  // decided here, the owning leave_requests row must mirror the outcome — otherwise the
  // employee's leave would sit 'pending' forever while the CEO sees it resolved.
  //
  // This is done as an explicit, visible step rather than a database trigger on purpose:
  // the propagation should be readable right where the decision is made, not hidden
  // behind table magic. It runs under the same session client, so RLS governs it — the
  // deciding CEO/HR-lead has full access to leave_requests (0015). A failure here does
  // not roll back the approval decision (that has already committed); it is logged and
  // surfaced, matching how the audit write below is treated as non-fatal.
  if (existing.type === 'leave') {
    const decidedAt = data.decided_at ?? new Date().toISOString()
    const { error: leaveError } = await supabase
      .from('leave_requests')
      .update({
        status: input.decision, // 'approved' | 'rejected' — same values as leave_requests.status
        approved_by: user.id,
        approved_at: decidedAt,
      })
      .eq('approval_id', approvalId)
    if (leaveError) {
      // Do not throw: the approval is already decided and that is the source of truth.
      console.error('[approvals] leave propagation failed', approvalId, leaveError.message)
    }
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: input.decision === 'approved' ? 'approval.granted' : 'approval.denied',
    entityType: 'approval',
    entityId: approvalId,
    metadata: {
      source,
      type: existing.type,
      amount: existing.amount,
      department_id: existing.department_id,
      note: input.note ?? null,
    },
  })

  return data as Approval
}
