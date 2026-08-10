import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getSessionUser } from '@/lib/auth/guards'
import { homeRouteFor } from '@/lib/auth/home-route'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { errorResponse } from '@/lib/api/responses'

/**
 * Records login. Called by the client immediately after signInWithPassword.
 * Any authenticated role may call this — it only ever writes a row about the
 * caller themselves.
 */
export async function POST() {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const h = await headers()
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip')

    const supabase = createSupabaseServiceClient()
    await supabase.from('sessions_meta').insert({
      user_id: user.id,
      device_info: h.get('user-agent'),
      ip_address: ip,
    })

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'auth.login',
      entityType: 'session',
      entityId: user.id,
      metadata: { role: user.roleName },
    })

    // The client cannot see the caller's role, so it cannot work out where to
    // send them. Resolving it here keeps role→route mapping server-side.
    return NextResponse.json({ ok: true, home: homeRouteFor(user) })
  } catch (err) {
    return errorResponse(err)
  }
}

/** Records logout. Called just before the client tears down its session. */
export async function DELETE() {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ ok: true })

    const supabase = createSupabaseServiceClient()
    const { data: openSession } = await supabase
      .from('sessions_meta')
      .select('id')
      .eq('user_id', user.id)
      .is('logout_at', null)
      .order('login_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (openSession) {
      await supabase
        .from('sessions_meta')
        .update({ logout_at: new Date().toISOString() })
        .eq('id', openSession.id)
    }

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'auth.logout',
      entityType: 'session',
      entityId: user.id,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
