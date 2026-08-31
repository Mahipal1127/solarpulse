import { NextResponse } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { getNotificationsFor } from '@/lib/services/notifications'
import { errorResponse } from '@/lib/api/responses'

/**
 * The header bell's feed for the signed-in user. Read-only, open to every active user — the
 * items are DERIVED from tasks/reports/applications the caller can already see under RLS (there
 * is no notifications table), so this route never exposes anything a page would not. The employee
 * is resolved from the session, never a query param.
 *
 * No caching: the count must reflect what just happened, and the payload is small and per-user.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requireUserOrThrow()
    const items = await getNotificationsFor(user)
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err)
  }
}
