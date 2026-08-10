import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrThrow } from '@/lib/auth/guards'
import { loadAIConfig, requireUsableAI, recordUsage, AIUnavailableError } from '@/lib/ai/config'
import { AI_TURN_JSON_SCHEMA, aiTurnSchema, validateProposal } from '@/lib/ai/proposalSchema'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { errorResponse } from '@/lib/api/responses'
import { z } from 'zod'

const chatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .optional(),
})

const CHAT_SYSTEM = (context: string) => `You are the AI assistant for the CEO of Solar Pulse, an Indian rooftop and commercial solar EPC company. You have read-only visibility into tasks, pending approvals, and department reports.

Rules:
- You are an advisor, not an executor. For any change the CEO requests, you propose it and return kind="proposed_action". The CEO must explicitly confirm before anything is written.
- Never invent numbers that are not in the context below.
- For questions about revenue, salary, or personal HR data: say those modules are not connected yet.
- Write concisely. The CEO is busy.
- For tasks, always use names from the provided department list. Never invent a department or assignee.

--- CONTEXT ---
${context}
--- END CONTEXT ---`

async function buildContext(organizationId: string): Promise<string> {
  const supabase = createSupabaseServiceClient()

  const [taskRes, approvalRes, deptRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, departments(name), assignee:users!tasks_assigned_user_id_fkey(full_name)')
      .eq('organization_id', organizationId)
      .neq('status', 'archived')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from('approvals')
      .select('id, approval_type, status, created_at, requester:users!approvals_requested_by_fkey(full_name), departments(name)')
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .limit(30),
    supabase
      .from('departments')
      .select('id, name')
      .eq('organization_id', organizationId),
  ])

  const tasks = taskRes.data ?? []
  const approvals = approvalRes.data ?? []
  const departments = deptRes.data ?? []

  const today = new Date().toISOString().slice(0, 10)

  const taskLines = tasks.slice(0, 50).map((t: Record<string, unknown>) => {
    const dept = (t.departments as { name: string } | null)?.name ?? '?'
    const assignee = (t.assignee as { full_name: string } | null)?.full_name ?? 'Unassigned'
    return `  - [${t.status}][${t.priority}] "${t.title}" | dept: ${dept} | assignee: ${assignee} | due: ${t.due_date ?? 'none'}`
  })

  const approvalLines = approvals.slice(0, 15).map((a: Record<string, unknown>) => {
    const requester = (a.requester as { full_name: string } | null)?.full_name ?? '?'
    const dept = (a.departments as { name: string } | null)?.name ?? '?'
    return `  - [${a.approval_type}] from ${requester} (${dept}), created ${a.created_at}`
  })

  const deptNames = departments.map((d: { name: string }) => d.name)

  return [
    `Today: ${today}`,
    ``,
    `TASKS (${tasks.length} active, showing ${Math.min(tasks.length, 50)}):`,
    ...taskLines,
    ``,
    `PENDING APPROVALS (${approvals.length}):`,
    ...approvalLines,
    ``,
    `DEPARTMENTS: ${deptNames.join(', ')}`,
  ].join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRoleOrThrow('CEO')
    const body = await req.json()
    const parsed = chatRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const { message, history = [] } = parsed.data
    const config = await loadAIConfig(user.organization_id)

    let adapter
    try {
      adapter = await requireUsableAI(config)
    } catch (err) {
      const reason = err instanceof AIUnavailableError ? err.message : 'AI is not available.'
      return NextResponse.json({ error: reason }, { status: 503 })
    }

    const context = await buildContext(user.organization_id)

    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...history.slice(-10),
      { role: 'user', content: message },
    ]

    const result = await adapter.complete({
      system: CHAT_SYSTEM(context),
      messages,
      maxTokens: 2048,
      jsonSchema: { schema: AI_TURN_JSON_SCHEMA.schema as Record<string, unknown> },
    })

    await recordUsage({
      config,
      userId: user.id,
      usage: result.usage,
      promptSummary: message.slice(0, 200),
    })

    if (result.refused) {
      return NextResponse.json({ error: 'The AI declined to respond.' }, { status: 422 })
    }

    // Parse and validate the structured turn
    let turn
    try {
      turn = aiTurnSchema.parse(result.json ?? JSON.parse(result.text))
    } catch {
      return NextResponse.json({ error: 'AI returned an unexpected format.' }, { status: 502 })
    }

    const validationError = validateProposal(turn)
    if (validationError) {
      return NextResponse.json({ error: `Invalid AI proposal: ${validationError}` }, { status: 502 })
    }

    // Log the AI command regardless of kind — audit_logs must capture every AI turn
    const supabase = createSupabaseServiceClient()
    const { data: commandRow } = await supabase
      .from('ai_command_log')
      .insert({
        organization_id: user.organization_id,
        user_id: user.id,
        raw_prompt: message,
        proposed_action: turn as unknown as Record<string, unknown>,
        status: turn.kind === 'proposed_action' ? 'proposed' : 'executed',
      })
      .select('id')
      .single()

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'ai.command_issued',
      entityType: 'ai_command_log',
      entityId: commandRow?.id ?? null,
      metadata: { kind: turn.kind, action: turn.action },
    })

    return NextResponse.json({
      turn,
      commandId: turn.kind === 'proposed_action' ? (commandRow?.id ?? null) : null,
    })
  } catch (err) {
    return errorResponse(err)
  }
}
