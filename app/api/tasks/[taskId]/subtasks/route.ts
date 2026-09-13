import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { createSubTaskSchema } from '@/lib/validation/schemas'
import { createSubTask, ServiceError } from '@/lib/services/tasks'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Spins a sub-task / requirement off an existing task — the operational core of
 * delegation: "we need one more panel delivered" discovered while executing
 * "install the panels". Open to any active employee; createSubTask verifies the
 * caller is involved in the parent (its assignee, its department's manager, its
 * creator, or a member of a managerless department it sits unclaimed in) and
 * that the target is a real, active department or person.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/tasks/[taskId]/subtasks'>) {
  try {
    const user = await requireUserOrThrow()
    const { taskId } = await ctx.params

    const parsed = createSubTaskSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid sub-task payload', parsed.error.flatten())

    const task = await createSubTask(user, taskId, parsed.data, 'manual')
    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}