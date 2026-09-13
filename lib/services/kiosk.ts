import 'server-only'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { resolveToken } from '@/lib/services/id-cards'
import { HR_DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from '@/lib/hr/constants'
import { ServiceError } from '@/lib/services/tasks'

/**
 * The QR attendance kiosk.
 *
 * WHY THE SERVICE CLIENT. The kiosk has no login — an employee scans their card
 * at a shared device. attendance_records' RLS grants read/write to the CEO, HR
 * members, and the employee's own row; no anonymous caller qualifies. So this
 * service runs on the service-role client, gated by the ONLY credential that
 * matters here: the scanned token itself — the same 256-bit opaque, revocable
 * secret the ID card encodes (0018). A revoked card stops marking attendance
 * the instant HR revokes it.
 *
 * THE SHIFT RULE, DELIBERATELY SIMPLE
 *   * No row for today      → check-in. Status 'present'.
 *   * Open shift (in, no out) → check-out. Worked under four hours lands as
 *     'half_day', otherwise 'present'. The threshold is a policy constant
 *     below — change the number, not the logic, if HR's rule differs.
 *   * Already out           → nothing is overwritten. A second scan after
 *     check-out answers "already marked out" rather than silently rewriting
 *     the day: attendance is a record, not a scratchpad.
 *
 * DATE IS IST. The business runs on Asia/Kolkata — every other date in the app
 * is formatted 'en-IN' — so "today" for attendance is today in IST, not the
 * server's zone. A kiosk on a UTC host must still close the day at midnight
 * Indian time.
 *
 * PHOTO. The signed URL is minted server-side (the kiosk cannot sign storage
 * URLs itself) with the same short TTL every HR object uses. The photo shows
 * on the kiosk screen for the few seconds the scan result is displayed; the
 * URL expires on its own.
 */

/** A check-out below this many worked minutes records a half day. */
const HALF_DAY_THRESHOLD_MINUTES = 240

export interface KioskMarkResult {
  action: 'in' | 'out' | 'already_out'
  identity: {
    employeeId: string
    fullName: string
    departmentName: string | null
  }
  checkIn: string | null
  checkOut: string | null
  /** Worked minutes, set only when this scan closed the shift. */
  workedMinutes: number | null
  status: 'present' | 'half_day' | null
  photoUrl: string | null
}

/** Today's date (YYYY-MM-DD) in the business's timezone. */
function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

/**
 * Scans → identity → one attendance write. Returns everything the kiosk screen
 * needs to show and say, including the signed photo URL.
 */
export async function markKioskAttendance(token: string): Promise<KioskMarkResult> {
  const identity = await resolveToken(token)
  // An unknown or revoked token is the same answer either way — the kiosk
  // shows "card not recognised" and never says which.
  if (!identity) throw new ServiceError('This card is not recognised', 404)

  const service = createSupabaseServiceClient()
  const today = istToday()
  const now = new Date().toISOString()

  // ResolvedIdentity carries the display fields only; the audit row needs the
  // org and the person's user id, which live one join away.
  const { data: empRow } = await service
    .from('employees')
    .select('id, user_id, users!employees_user_id_fkey(organization_id)')
    .eq('id', identity.employeeId)
    .maybeSingle()
  if (!empRow) throw new ServiceError('This card is not recognised', 404)

  const organizationId =
    (empRow.users as unknown as { organization_id: string } | null)?.organization_id
  // A live employee row always belongs to an organisation; a null here means
  // corrupt data, and the honest answer is the same as an unknown card.
  if (!organizationId) throw new ServiceError('This card is not recognised', 404)

  const { data: existing } = await service
    .from('attendance_records')
    .select('id, check_in, check_out, status')
    .eq('employee_id', identity.employeeId)
    .eq('date', today)
    .maybeSingle()

  let action: KioskMarkResult['action']
  let checkIn: string | null = existing?.check_in ?? null
  let checkOut: string | null = existing?.check_out ?? null
  let workedMinutes: number | null = null
  let status: KioskMarkResult['status'] = null

  if (!existing) {
    // First scan of the day — the shift opens.
    checkIn = now
    checkOut = null
    status = 'present'
    action = 'in'
    const { error } = await service.from('attendance_records').insert({
      employee_id: identity.employeeId,
      date: today,
      check_in: checkIn,
      check_out: null,
      status,
      marked_by: null,
    })
    if (error) throw new ServiceError(error.message, 400)
  } else if (existing.check_in && !existing.check_out) {
    // Open shift — this scan closes it. Under the threshold records a half day.
    checkOut = now
    const minutes = Math.max(
      0,
      Math.round((new Date(checkOut).getTime() - new Date(existing.check_in).getTime()) / 60_000)
    )
    workedMinutes = minutes
    status = minutes < HALF_DAY_THRESHOLD_MINUTES ? 'half_day' : 'present'
    action = 'out'
    const { error } = await service
      .from('attendance_records')
      .update({ check_out: checkOut, status })
      .eq('id', existing.id)
    if (error) throw new ServiceError(error.message, 400)
  } else {
    // Already checked in AND out today. Attendance is a record — the day's
    // numbers are not rewritten by a stray second scan.
    action = 'already_out'
    status = (existing.status as KioskMarkResult['status']) ?? null
  }

  // Signed photo for the kiosk screen. Best-effort: a missing or unreadable
  // photo degrades to the initials tile, never to a failed scan.
  let photoUrl: string | null = null
  if (identity.profilePhotoPath) {
    const { data } = await service.storage
      .from(HR_DOCUMENTS_BUCKET)
      .createSignedUrl(identity.profilePhotoPath, SIGNED_URL_TTL_SECONDS)
    photoUrl = data?.signedUrl ?? null
  }

  await logAction({
    organizationId,
    userId: empRow.user_id,
    action: 'attendance.kiosk_marked',
    entityType: 'attendance',
    entityId: identity.employeeId,
    metadata: { via: 'qr_kiosk', kiosk_action: action, date: today },
  })

  return {
    action,
    identity: {
      employeeId: identity.employeeId,
      fullName: identity.fullName,
      departmentName: identity.departmentName,
    },
    checkIn,
    checkOut,
    workedMinutes,
    status,
    photoUrl,
  }
}