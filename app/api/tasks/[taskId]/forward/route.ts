import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { forwardTaskSchema } from '@/lib/validation/schemas'
import { forwardTask, ServiceError } from '@/lib/services/tasks'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Forwards an open task onward — to another employee, or to another department
 * entirely ("we cannot do this here; Technical must"). Any active employee may
 * call it; forwardTask verifies they are involved in the task (assignee,
 * creator, or the owning department's manager), that it is still open, and
 * that the target exists and is active. The chain's origin and links are
 * untouched — this only moves execution.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/tasks/[taskId]/forward'>) {
  try {
    const user = await requireUserOrThrow()
    const { taskId } = await ctx.params

    const parsed = forwardTaskSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid forward payload', parsed.error.flatten())

    const task = await forwardTask(user, taskId, parsed.data, 'manual')
    return NextResponse.json({ task })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}