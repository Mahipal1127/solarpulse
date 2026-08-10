import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/auth/guards'
import { updateTaskProgressSchema } from '@/lib/validation/schemas'
import { updateTaskProgress, ServiceError } from '@/lib/services/tasks'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Employee-only progress update. Intentionally separate from PATCH
 * /api/tasks/[taskId] (CEO-only) — employees can only touch status,
 * progress_percent, and note on tasks directly assigned to them.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/tasks/[taskId]/progress'>) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (!user.is_active) return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
    // CEO has the full PATCH route; redirect them there if they somehow hit this.
    if (user.roleName === 'CEO') {
      return NextResponse.json(
        { error: 'Use PATCH /api/tasks/[taskId] for CEO updates' },
        { status: 400 }
      )
    }

    const { taskId } = await ctx.params
    const parsed = updateTaskProgressSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid progress payload', parsed.error.flatten())

    const task = await updateTaskProgress(user, taskId, parsed.data)
    return NextResponse.json({ task })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
