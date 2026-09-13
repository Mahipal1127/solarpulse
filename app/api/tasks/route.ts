import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { createTaskSchema } from '@/lib/validation/schemas'
import { createTask, ServiceError } from '@/lib/services/tasks'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Task creation for everyone with the standing to originate work — not only the
 * CEO. The hierarchy lives inside createTask: the CEO and any department
 * manager may point a top-level task at any department; an employee's own
 * creation lands in their department. The route's guard is deliberately broad
 * (any active, signed-in member) because the service is what distinguishes
 * these cases and returns a precise 403 when the caller overreaches.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserOrThrow()

    const parsed = createTaskSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid task payload', parsed.error.flatten())

    const task = await createTask(user, parsed.data, 'manual')
    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
