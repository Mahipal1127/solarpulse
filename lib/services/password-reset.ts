import 'server-only'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { resolveToken } from '@/lib/services/id-cards'

export { ServiceError }

/**
 * Self-service password reset, verified by the employee's attendance QR card.
 *
 * WHY THIS IS A PRIVILEGED SERVER PATH. Setting a password without a session can only run on the
 * service-role client (auth.admin.updateUserById — the same primitive changeOwnPassword uses).
 * What replaces the missing session is a pairing of two things:
 *
 *   1. The Employee ID the holder types — the "ID No" printed on the card (employees.employee_code).
 *   2. The scanned attendance QR token — the 256-bit opaque, revocable secret (0018) that the
 *      attendance kiosk already trusts, resolved here through the same resolveToken path.
 *
 * Both must land on the SAME active employee. A QR photographed on its own fails (no code), a
 * guessed or borrowed code fails (no card), and a revoked card stops working instantly — HR's
 * revoke + reissue lever, built for lost cards, is what bounds this flow's risk. Every failure
 * answers with the SAME generic message so nothing leaks about which half went wrong.
 *
 * SCOPE. Only employees with an employee_code on their card can use this flow, and the CEO (no
 * employees row, no card) cannot — by design; the CEO goes through HR. Rate limiting is left to
 * the deployment edge exactly as for POST /api/qr/resolve: the token is infeasible to guess, so
 * the endpoint is not brute-forceable in any realistic horizon.
 */

const MISMATCH = 'Employee ID and QR card do not match, or the card is no longer active.'

interface VerifiedEmployee {
  userId: string
  organizationId: string
  employeeId: string
  employeeCode: string
  fullName: string
  departmentName: string | null
  designation: string | null
}

/**
 * Resolves the (employee code, QR token) pair to the one employee it belongs to, or null. The QR
 * is resolved first: an unknown or revoked token ends the check before the code is even looked
 * up, mirroring how the kiosk treats a scan.
 */
async function resolveVerifiedEmployee(
  employeeCode: string,
  token: string
): Promise<VerifiedEmployee | null> {
  const identity = await resolveToken(token)
  if (!identity) return null

  const service = createSupabaseServiceClient()

  // employees RLS would return nothing for an anonymous caller — this lookup runs on the service
  // client precisely because the caller has no session yet. That is safe: the guard IS the pair
  // match below, and the only write this module ever performs is on the matched employee's own
  // auth row.
  const { data: emp } = await service
    .from('employees')
    .select(
      'id, user_id, employee_code, designation, employment_status, user:users!employees_user_id_fkey(id, full_name, is_active, organization_id, departments(name))'
    )
    .eq('employee_code', employeeCode)
    .maybeSingle()

  if (!emp) return null

  const userRow = emp.user as unknown as {
    id: string
    full_name: string
    is_active: boolean
    organization_id: string
    departments: { name: string } | null
  } | null

  // The code and the card must belong to the SAME employee, who must still be employed and
  // activated — an exited or deactivated account can never be reset through this flow.
  if (emp.id !== identity.employeeId) return null
  if (emp.employment_status !== 'active') return null
  if (!userRow || !userRow.is_active) return null

  return {
    userId: userRow.id,
    organizationId: userRow.organization_id,
    employeeId: emp.id,
    employeeCode: emp.employee_code,
    fullName: userRow.full_name,
    departmentName: userRow.departments?.name ?? null,
    designation: emp.designation ?? null,
  }
}

/**
 * Step 1 of the wizard: prove the pair, return the display identity for the confirmation screen.
 * The same PII the attendance kiosk already surfaces to a valid token scan.
 */
export async function verifyResetIdentity(
  employeeCode: string,
  token: string
): Promise<{
  fullName: string
  departmentName: string | null
  designation: string | null
  employeeCode: string
}> {
  const emp = await resolveVerifiedEmployee(employeeCode, token)
  if (!emp) throw new ServiceError(MISMATCH, 400)

  return {
    fullName: emp.fullName,
    departmentName: emp.departmentName,
    designation: emp.designation,
    employeeCode: emp.employeeCode,
  }
}

/**
 * Step 2: re-prove the pair from scratch (the server never trusts the client's step-1 result),
 * then set the new password and clear any outstanding forced-change flag. The token itself is
 * never logged — it remains a live credential until HR revokes it.
 */
export async function resetPasswordWithQr(
  employeeCode: string,
  token: string,
  newPassword: string
): Promise<void> {
  const emp = await resolveVerifiedEmployee(employeeCode, token)
  if (!emp) throw new ServiceError(MISMATCH, 400)

  const service = createSupabaseServiceClient()

  const { error: authError } = await service.auth.admin.updateUserById(emp.userId, {
    password: newPassword,
  })
  if (authError) throw new ServiceError(authError.message, 400)

  // They just chose their own password, so a leftover must_change_password flag is moot — clearing
  // it spares one redundant /change-password bounce after sign-in. Password first, flag second
  // (mirrors changeOwnPassword): a failed flag clear is annoying, never unsafe.
  const { error: flagError } = await service
    .from('employees')
    .update({ must_change_password: false })
    .eq('id', emp.employeeId)
  if (flagError) throw new ServiceError(flagError.message, 400)

  await logAction({
    organizationId: emp.organizationId,
    userId: emp.userId,
    action: 'auth.password_reset_via_qr',
    entityType: 'employee',
    entityId: emp.employeeId,
    metadata: { via: 'attendance_qr', employee_code: emp.employeeCode },
  })
}