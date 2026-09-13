import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { getTaskFlow, ServiceError } from '@/lib/services/tasks'
import { errorResponse } from '@/lib/api/responses'

/**
 * The delegation chain behind a task: root plus every visible descendant,
 * oldest first. RLS decides the slice — the CEO and the origin department's
 * manager get the whole journey; a mid-chain participant gets their own nodes;
 * nobody gets anything they could not already see on a board. A hidden or
 * unknown task answers 404 without distinguishing the two.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/tasks/[taskId]/flow'>) {
  try {
    const user = await requireUserOrThrow()
    const { taskId } = await ctx.params

    const flow = await getTaskFlow(user, taskId)
    if (!flow) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    return NextResponse.json({ flow })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}