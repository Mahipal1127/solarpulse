import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createCampaignSchema } from '@/lib/validation/schemas'
import { createCampaign, ServiceError, MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates a campaign, managed by the assigned Marketing person. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)

    const parsed = createCampaignSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid campaign payload', parsed.error.flatten())

    const campaign = await createCampaign(user, parsed.data)
    return NextResponse.json({ campaign }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
