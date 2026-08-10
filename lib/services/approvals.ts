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
