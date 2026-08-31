import 'server-only'

import { randomBytes } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { isHrLead } from '@/lib/services/hr'
import { HR_DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from '@/lib/hr/constants'
import type { SessionUser } from '@/lib/auth/guards'

export { ServiceError }

/**
 * ID cards & QR attendance tokens.
 *
 * WHY THE SERVICE-ROLE CLIENT. qr_tokens has, by design (0018), NO employee or HR-member RLS
 * policy — only CEO and HR lead can touch it, and the token value must never be reachable from a
 * client table read. Rather than lean on a session client whose RLS would already allow the
 * lead, every function here runs on the service-role client AFTER an explicit isHrLead()/CEO
 * guard, mirroring hireEmployee(): the guard IS the access control, the service client is used
 * only once it passes. This also lets qr/resolve (the attendance-panel endpoint) look a token up
 * even though its caller is an unauthenticated kiosk — see resolveToken().
 *
 * WHY TOKENS LIVE IN A TABLE, NOT ON employees. One active token per employee, but modelled as
 * rows so a lost card is revoked + reissued without touching the employee record, and history
 * stays auditable. "Current token" = the qr_tokens row where employee_id = ? and is_active.
 */

/** Only the HR lead (or CEO-as-lead) may issue, regenerate, or revoke a card. */
export function assertCanManage(user: SessionUser): void {
  // CEO reaches here as a department manager via isHrLead's Manager-convention check only if
  // they sit in HR; the CEO proper is gated at the route with requireRole('CEO'). Both the
  // route guard and this predicate must pass for a write, so a plain CEO route is covered and a
  // non-lead HR Executive is refused with a clear 403 rather than an opaque RLS empty result.
  if (!isHrLead(user) && user.roleName !== 'CEO') {
    throw new ServiceError('Only HR lead or CEO can manage ID cards', 403)
  }
}

/**
 * A long, opaque, URL-safe token. 32 random bytes (256 bits) hex-encoded — not derived from any
 * employee identifier, so it reveals nothing and colliding is infeasible. This is the ONLY value
 * the QR code encodes.
 */
function generateTokenValue(): string {
  return randomBytes(32).toString('hex')
}

export interface IssuedToken {
  id: string
  token: string
}

/**
 * The employee's current active token, minting one if none exists. Idempotent: a card
 * regenerated for a cosmetic reason (a new photo) reuses the existing token, so the old card
 * keeps working — rotating the token is a SEPARATE, explicit action (revokeAndReissue). This is
 * the distinction the whole revocation model rests on.
 */
async function ensureActiveToken(
  service: ReturnType<typeof createSupabaseServiceClient>,
  employeeId: string
): Promise<IssuedToken> {
  const { data: existing } = await service
    .from('qr_tokens')
    .select('id, token')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .maybeSingle()

  if (existing) return { id: existing.id, token: existing.token }

  const token = generateTokenValue()
  const { data, error } = await service
    .from('qr_tokens')
    .insert({ employee_id: employeeId, token, is_active: true })
    .select('id, token')
    .single()
  if (error || !data) throw new ServiceError(error?.message ?? 'Could not issue token', 400)
  return { id: data.id, token: data.token }
}

/**
 * Issues an active token for an employee if they lack one. Used by onboarding so a card can be
 * generated in the same flow. Returns the token value — the caller (a trusted server context)
 * needs it to render the QR, but it is never sent to a client.
 */
export async function issueTokenForEmployee(
  service: ReturnType<typeof createSupabaseServiceClient>,
  employeeId: string
): Promise<IssuedToken> {
  return ensureActiveToken(service, employeeId)
}

export interface EmployeeCardData {
  employeeId: string
  fullName: string
  designation: string | null
  departmentName: string | null
  employeeCode: string | null
  organizationName: string
  profilePhotoPath: string | null
  token: string
  // Front-of-card detail block + shared footer (0023).
  dateJoined: string | null
  phone: string | null
  email: string | null
  footer: { address: string | null; phone: string | null; email: string | null }
}

/**
 * Everything the card layout needs, gathered on the service client. Resolves the org and
 * department names through users, and guarantees an active token exists (minting one if this is
 * a first generation). Reused by both the onboarding flow and the manual regenerate route.
 */
export async function collectCardData(
  service: ReturnType<typeof createSupabaseServiceClient>,
  employeeId: string
): Promise<EmployeeCardData> {
  const { data: emp, error } = await service
    .from('employees')
    .select(
      'id, designation, employee_code, date_joined, profile_photo_path, user:users!employees_user_id_fkey(full_name, email, phone, organization_id, organizations(name), departments(name))'
    )
    .eq('id', employeeId)
    .maybeSingle()
  if (error || !emp) throw new ServiceError('Employee not found', 404)

  const userRow = emp.user as unknown as {
    full_name: string
    email: string | null
    phone: string | null
    organization_id: string
    organizations: { name: string } | null
    departments: { name: string } | null
  } | null

  const { token } = await ensureActiveToken(service, employeeId)

  // The card footer — the org's one company_details row, if set. A missing row
  // means a blank footer, never a failed render.
  let footer = { address: null as string | null, phone: null as string | null, email: null as string | null }
  if (userRow?.organization_id) {
    const { data: details } = await service
      .from('company_details')
      .select('address, phone, email')
      .eq('organization_id', userRow.organization_id)
      .maybeSingle()
    if (details) {
      footer = {
        address: details.address ?? null,
        phone: details.phone ?? null,
        email: details.email ?? null,
      }
    }
  }

  return {
    employeeId,
    fullName: userRow?.full_name ?? 'Unknown',
    designation: emp.designation ?? null,
    departmentName: userRow?.departments?.name ?? null,
    employeeCode: emp.employee_code ?? null,
    organizationName: userRow?.organizations?.name ?? 'Solar Pulse',
    profilePhotoPath: emp.profile_photo_path ?? null,
    token,
    dateJoined: emp.date_joined ?? null,
    phone: userRow?.phone ?? null,
    email: userRow?.email ?? null,
    footer,
  }
}

export interface StoredCardPaths {
  frontPath: string
  backPath: string
}

/**
 * Stores the two rendered card PNGs (front + back) in hr-documents under
 * '{employee_id}/id-card-{front|back}-{n}.png' (org access is enforced by the
 * employee-id-first path, same as every HR object) and stamps the employees row.
 * The paths are timestamped so a regeneration does not fight browser/CDN caching of
 * the old images. Front → id_card_file_path, back → id_card_back_file_path.
 */
export async function storeCardImages(
  service: ReturnType<typeof createSupabaseServiceClient>,
  employeeId: string,
  front: Buffer,
  back: Buffer
): Promise<StoredCardPaths> {
  const stamp = Date.now()
  const frontPath = `${employeeId}/id-card-front-${stamp}.png`
  const backPath = `${employeeId}/id-card-back-${stamp}.png`

  const bucket = service.storage.from(HR_DOCUMENTS_BUCKET)
  const [frontUpload, backUpload] = await Promise.all([
    bucket.upload(frontPath, front, { contentType: 'image/png', upsert: true }),
    bucket.upload(backPath, back, { contentType: 'image/png', upsert: true }),
  ])
  if (frontUpload.error) throw new ServiceError(frontUpload.error.message, 400)
  if (backUpload.error) throw new ServiceError(backUpload.error.message, 400)

  const { error: updateError } = await service
    .from('employees')
    .update({
      id_card_file_path: frontPath,
      id_card_back_file_path: backPath,
      id_card_generated_at: new Date().toISOString(),
    })
    .eq('id', employeeId)
  if (updateError) throw new ServiceError(updateError.message, 400)

  return { frontPath, backPath }
}

/**
 * Revokes the current token and issues a fresh one — the "card reported lost" path. The old QR
 * stops resolving the instant is_active flips, without touching the employee's login or any other
 * record. The caller then regenerates the card image against the new token. This is the ONLY
 * function that rotates a token; a cosmetic regenerate must never call it.
 */
export async function revokeAndReissueToken(
  user: SessionUser,
  employeeId: string
): Promise<IssuedToken> {
  assertCanManage(user)
  const service = createSupabaseServiceClient()

  await service
    .from('qr_tokens')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('employee_id', employeeId)
    .eq('is_active', true)

  const issued = await ensureActiveToken(service, employeeId)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'id_card_token_revoked',
    entityType: 'employee',
    entityId: employeeId,
    metadata: { new_token_id: issued.id },
  })

  return issued
}

/**
 * Mints a short-lived signed URL for an employee's current card image, or null if none has been
 * generated yet. Runs on the service client after the lead/CEO guard, mirroring the qr_tokens
 * access tier — the card image lives in the same folder an employee can read, but the management
 * routes surface it to HR only; the Profile Board's own read path signs it for the owner.
 */
export async function signCardDownload(
  user: SessionUser,
  employeeId: string
): Promise<{ url: string; generatedAt: string | null } | null> {
  assertCanManage(user)
  const service = createSupabaseServiceClient()

  const { data: emp } = await service
    .from('employees')
    .select('id_card_file_path, id_card_generated_at')
    .eq('id', employeeId)
    .maybeSingle()

  if (!emp?.id_card_file_path) return null

  const { data, error } = await service.storage
    .from(HR_DOCUMENTS_BUCKET)
    .createSignedUrl(emp.id_card_file_path, SIGNED_URL_TTL_SECONDS, {
      download: `id-card-${employeeId}.png`,
    })
  if (error || !data) throw new ServiceError(error?.message ?? 'Could not sign the card', 400)

  return { url: data.signedUrl, generatedAt: emp.id_card_generated_at ?? null }
}

export interface ResolvedIdentity {
  employeeId: string
  fullName: string
  departmentName: string | null
  profilePhotoPath: string | null
}

/**
 * Resolves a scanned token to an employee identity for the future Attendance Panel — the ONE
 * endpoint that panel calls. Returns null for an unknown or revoked token (never distinguishing
 * the two, so a probe learns nothing). It does NOT write attendance — identity resolution only;
 * the panel decides what to do with the result. Runs on the service client because the caller is
 * a shared kiosk with no authenticated session, and qr_tokens has no readable-by-anyone policy.
 */
export async function resolveToken(token: string): Promise<ResolvedIdentity | null> {
  if (!token || typeof token !== 'string') return null
  const service = createSupabaseServiceClient()

  const { data } = await service
    .from('qr_tokens')
    .select(
      'employee_id, is_active, employee:employees!qr_tokens_employee_id_fkey(id, profile_photo_path, user:users!employees_user_id_fkey(full_name, departments(name)))'
    )
    .eq('token', token)
    .eq('is_active', true)
    .maybeSingle()

  if (!data) return null

  const emp = data.employee as unknown as {
    id: string
    profile_photo_path: string | null
    user: { full_name: string; departments: { name: string } | null } | null
  } | null
  if (!emp) return null

  return {
    employeeId: emp.id,
    fullName: emp.user?.full_name ?? 'Unknown',
    departmentName: emp.user?.departments?.name ?? null,
    profilePhotoPath: emp.profile_photo_path ?? null,
  }
}
