import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { createEmployeeReportSchema } from '@/lib/validation/schemas'
import {
  createEmployeeReport,
  listOwnReports,
  ServiceError,
} from '@/lib/services/employee-reports'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The employee's own reports.
 *
 * requireUserOrThrow, NOT requireDepartmentOrThrow: every employee in every department
 * files these, including someone with no department at all. The department guards exist
 * for module queues; this is a personal record, and RLS scopes it to the author.
 */
export async function GET() {
  try {
    const user = await requireUserOrThrow()
    const reports = await listOwnReports(user)
    return NextResponse.json({ reports })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Files a report — as a draft, or submitted outright when `submit` is set. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserOrThrow()

    const parsed = createEmployeeReportSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid report payload', parsed.error.flatten())

    const { submit, ai_generated, ...input } = parsed.data
    const report = await createEmployeeReport(user, input, {
      submit,
      aiGenerated: ai_generated,
    })

    return NextResponse.json({ report }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
