import { NextResponse, type NextRequest } from 'next/server'
import { requireRoleOrThrow } from '@/lib/auth/guards'
import { createTaskSchema } from '@/lib/validation/schemas'
import { createTask, ServiceError } from '@/lib/services/tasks'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(request: NextRequest) {
  try {
    const user = await requireRoleOrThrow('CEO')

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
