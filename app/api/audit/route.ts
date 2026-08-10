import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { errorResponse } from '@/lib/api/responses'

const PAGE_SIZE = 50

export async function GET(req: NextRequest) {
  try {
    const user = await requireRoleOrThrow('CEO')
    const supabase = await createSupabaseServerClient()

    const { searchParams } = new URL(req.url)
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10))
    const action = searchParams.get('action') ?? undefined
    const entityType = searchParams.get('entityType') ?? undefined

    let query = supabase
      .from('audit_logs')
      .select('id, action, entity_type, entity_id, metadata, ip_address, created_at, user_id')
      .eq('organization_id', user.organization_id)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (action) query = query.ilike('action', `%${action}%`)
    if (entityType) query = query.eq('entity_type', entityType)

    const { data, error } = await query
    if (error) {
      console.error('[audit] fetch error', error)
      return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
    }

    return NextResponse.json({ logs: data ?? [], page, pageSize: PAGE_SIZE })
  } catch (err) {
    return errorResponse(err)
  }
}
