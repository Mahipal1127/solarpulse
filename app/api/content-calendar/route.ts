import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createContentItemSchema } from '@/lib/validation/schemas'
import { createContentItem, ServiceError, MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates a content calendar item, assigned to the Marketing person who will produce it. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)

    const parsed = createContentItemSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid content payload', parsed.error.flatten())

    const item = await createContentItem(user, parsed.data)
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
