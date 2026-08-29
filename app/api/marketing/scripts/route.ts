import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { generateScriptSchema } from '@/lib/validation/schemas'
import { listScripts, generateScriptForBrief, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * AI-generated scripts.
 *
 * GET lists them for the department and the CEO. POST generates one from a brief — grounded in
 * the brand profile, the latest IG audit findings and the reference library, all assembled
 * server-side in the service. AI being off is NOT an error: generateScriptForBrief stores a
 * placeholder draft with a reason and returns 201, so the team can still write it by hand.
 *
 * The CEO is refused on POST by isReadOnlyFor — reading the team's scripts, never writing them.
 */
export async function GET() {
  try {
    await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const scripts = await listScripts()
    return NextResponse.json({ scripts })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team generates scripts. You can read every one.' },
        { status: 403 }
      )
    }

    const parsed = generateScriptSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid script request', parsed.error.flatten())

    const script = await generateScriptForBrief(user, {
      brief: parsed.data.brief,
      content_type: parsed.data.content_type,
    })
    return NextResponse.json({ script }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
