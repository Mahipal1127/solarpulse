import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { addTeamMemberSchema } from '@/lib/validation/schemas'
import {
  addTeamMember,
  removeTeamMember,
  ServiceError,
  OM_DEPARTMENT_SLUG,
} from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Adds a crew member to the installation team. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/installations/[installationId]/team'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { installationId } = await ctx.params

    const parsed = addTeamMemberSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid team member payload', parsed.error.flatten())

    const member = await addTeamMember(user, installationId, parsed.data)
    return NextResponse.json({ member }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Removes a crew member. The member row id comes as ?memberId= rather than a path
 * segment, so the add and remove of one collection share a single route file.
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<'/api/installations/[installationId]/team'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { installationId } = await ctx.params

    const memberId = request.nextUrl.searchParams.get('memberId')
    if (!memberId) return badRequest('Specify which memberId to remove')

    await removeTeamMember(user, installationId, memberId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
