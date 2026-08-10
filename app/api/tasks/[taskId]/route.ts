import { NextResponse, type NextRequest } from 'next/server'
import {
  requireRoleOrThrow,
  getSessionUser,
  isDepartmentManager,
  ForbiddenError,
} from '@/lib/auth/guards'
import { updateTaskSchema } from '@/lib/validation/schemas'
import { updateTask, archiveTask, ServiceError } from '@/lib/services/tasks'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * CEO or a department manager. Managers need this to delegate: a task the CEO
 * assigns to a department with no specific person is claimed by setting
 * assigned_user_id, which is a task update.
 *
 * The manager's reach is bounded by RLS (member_update_relevant_tasks in
 * migration 0006), whose with-check keeps the task inside their own department —
 * so a manager cannot push work onto another department or touch a task outside
 * theirs, even though this guard admits them.
 */
async function requireCeoOrDepartmentManager() {
  const user = await getSessionUser()

  if (!user) throw new ForbiddenError('Not authenticated', 401)
  if (!user.is_active) throw new ForbiddenError('Account is inactive', 403)
  if (user.roleName === 'CEO' || isDepartmentManager(user)) return user

  throw new ForbiddenError('Insufficient role', 403)
}

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/tasks/[taskId]'>) {
  try {
    const user = await requireCeoOrDepartmentManager()
    const { taskId } = await ctx.params

    const parsed = updateTaskSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const task = await updateTask(user, taskId, parsed.data, 'manual')
    return NextResponse.json({ task })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Soft delete only — sets status to 'archived' and keeps the row. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/tasks/[taskId]'>) {
  try {
    const user = await requireRoleOrThrow('CEO')
    const { taskId } = await ctx.params

    const task = await archiveTask(user, taskId, 'manual')
    return NextResponse.json({ task })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
