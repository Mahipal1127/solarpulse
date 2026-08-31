import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { onboardEmployeeSchema } from '@/lib/validation/schemas'
import { onboardEmployee, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { generateAndStoreCard } from '@/lib/services/card-render'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The onboarding-wizard endpoint. Provisions the employee (auth login + users + employees rows +
 * optional photo, with orphan-cleanup on failure — see onboardEmployee), then generates the ID
 * card.
 *
 * ORDER MATTERS. Provisioning runs first and is the only part whose failure aborts the request;
 * once it returns, the employee EXISTS and is usable. Card generation runs after and is
 * best-effort: if next/og rendering hiccups, we still return 201 with the employee and a
 * card_generated:false flag, because the card is independently regenerable (POST
 * /employees/[id]/id-card) whereas a failed provision would leave a ghost login. This is why the
 * two are not fused into one call.
 *
 * HR-lead / CEO only — the department guard is the outer gate, assertHrLead inside onboardEmployee
 * the inner one.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)

    const parsed = onboardEmployeeSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid onboarding payload', parsed.error.flatten())

    const employee = await onboardEmployee(user, parsed.data)

    let cardGenerated = true
    let idCardFilePath: string | null = null
    try {
      const paths = await generateAndStoreCard(employee.id)
      idCardFilePath = paths.frontPath
    } catch {
      // The employee is provisioned; a card render failure must not fail the onboard. HR can
      // regenerate from the profile board. We surface the state rather than swallowing it.
      cardGenerated = false
    }

    return NextResponse.json(
      { employee, card_generated: cardGenerated, id_card_file_path: idCardFilePath },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
