import 'server-only'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import type { SessionUser } from '@/lib/auth/guards'

export { ServiceError }

/**
 * Sets the caller's OWN password and clears the forced-change flag.
 *
 * Runs on the service-role client because both writes are privileged: setting a password goes
 * through auth.admin.updateUserById, and must_change_password sits on the employees row, which an
 * employee has no RLS write on (the HR tables are lead/CEO-write only, by design). The access
 * control is that this only ever acts on `user` — the already-authenticated caller resolved from
 * the session — never an id from the request body, so no one can change anyone else's password.
 *
 * ORDER. Password first, flag second. If the password set fails we never clear the flag, so the
 * user stays gated and can retry. If clearing the flag fails after the password changed, the user
 * simply gets asked once more — annoying, not unsafe — which is the right way round: the worst
 * case is a redundant prompt, never an un-gated account with a still-temporary password.
 *
 * A user with no employees row (e.g. the CEO) can still use this to rotate their password; the
 * flag update just matches zero rows, which is fine.
 */
export async function changeOwnPassword(user: SessionUser, newPassword: string): Promise<void> {
  const service = createSupabaseServiceClient()

  const { error: authError } = await service.auth.admin.updateUserById(user.id, {
    password: newPassword,
  })
  if (authError) throw new ServiceError(authError.message, 400)

  const { error: flagError } = await service
    .from('employees')
    .update({ must_change_password: false })
    .eq('user_id', user.id)
  if (flagError) throw new ServiceError(flagError.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: user.id,
  })
}
