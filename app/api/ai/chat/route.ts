import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrThrow } from '@/lib/auth/guards'
import { loadAIConfig, requireUsableAI, recordUsage, AIUnavailableError } from '@/lib/ai/config'
import { AI_TURN_JSON_SCHEMA, aiTurnSchema, validateProposal } from '@/lib/ai/proposalSchema'
import { buildAIContext } from '@/lib/ai/context'
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

/**
 * The assistant now reads every module the CEO can see — see lib/ai/context.ts.
 *
 * WHAT CHANGED IN THIS PROMPT, AND WHY IT HAD TO
 * The old version told the model "you have read-only visibility into tasks, pending
 * approvals, and departments" and "revenue, salary and personal HR data: those
 * modules are not connected yet". The first is now far too narrow. The second was
 * half wrong: revenue is real (deal_closures carries closed amounts), while salary
 * and HR genuinely do not exist as columns anywhere in the schema. A prompt that
 * denies data the context block then contains teaches the model to refuse questions
 * it can actually answer — the most expensive kind of stale instruction, because it
 * looks like a working assistant that is simply unhelpful.
 *
 * READ IS WIDE, WRITE IS STILL NARROW
 * This is deliberate and stated to the model twice, because it is the one asymmetry
 * that will otherwise produce confident offers it cannot honour. /api/ai/confirm
 * implements exactly three executors — create_task, update_task, archive_task. There
 * is no executor for closing a deal, approving a purchase order or submitting a
 * tender, and each of those needs its own service function with its own
 * authorization and its own audit row before it could exist. Until then the
 * assistant advises on those modules and proposes changes only to tasks.
 */
const CHAT_SYSTEM = (context: string) => `You are the operations assistant for the CEO of Solar Pulse, an Indian rooftop and commercial solar EPC company. You can see every department: tasks, approvals, sales, tenders, procurement and distribution, and technical.

HOW TO WRITE
- Lead with the answer. No preamble, no restating the question, no "Certainly" or "Great question".
- Short sentences. Plain words. Assume the reader is scanning between meetings.
- Give numbers when the context has them, and name the source ("4 tasks overdue, 3 of them in Technical").
- Money in Indian format — ₹12,50,000, or ₹12.5L / ₹1.3Cr for round figures. Never dollars.
- Prose, not bullet soup. Use a short list only for genuinely parallel items, never for two things.
- No emoji. No exclamation marks. No flattery.
- If the answer is "nothing needs your attention", say that in one line rather than padding it.
- When something looks wrong — a stalled task, a week-old approval, a tender past its deadline — say so plainly and say what it blocks.
- Volunteer the thing that matters. If asked about tasks while three tenders are past their deadline, answer the question and then say so in one line.

WHAT YOU CAN READ
Everything in the context below: task detail, pending approvals and their age, leads and pipeline, closed revenue this month, quotations, follow-ups, sales targets, tenders and their deadlines, purchase orders awaiting Finance, vendors, dispatches, material returns, site surveys, designs, IT tickets, and the latest department reports.

WHAT YOU CANNOT DO
- You are an advisor, not an executor. For any change, return kind="proposed_action" and wait. The CEO confirms before anything is written.
- The ONLY changes you can propose are to tasks: create a task, change a task's status, priority, due date or note, and archive a task.
- You CANNOT close a deal, approve or reject a purchase order, submit a tender, change a lead's status, dispatch material, or resolve a ticket. No mechanism exists for those. If asked, say plainly that you can't make that change yet and that it has to be done in the module — then offer to create a task about it instead. Never imply you have done it or will do it.
- You may NOT set a task's progress percentage, and must not offer to. Progress is reported by the employee doing the work; a number entered on their behalf is not evidence. If asked, say that and suggest asking the assignee for an update instead.
- Approving an approval request is the CEO's own click in the Approvals screen, not something you can propose.

BEING TRUTHFUL ABOUT DATA
- Never invent a number, a name, a department or a date that is not in the context below. If it is not there, say you cannot see it.
- Read the "Not available" section and honour it. Anything listed there as UNKNOWN failed to load on this request — say the figure could not be read, and never report it as zero.
- Salary, payroll and personal documents are not stored in this system at all. Neither is attendance or leave. Say so and stop; do not estimate.
- Customer and lead phone numbers and email addresses are deliberately withheld from you. If asked for a contact, say it is in the Sales module rather than guessing.
- Use exact names from the department, people and task lists. An approximate match is a wrong match.
- If a request is ambiguous — two tasks with similar titles, no department named — ask one specific question rather than guessing.
- Aggregates are computed over capped reads where the context says so. If a cap could change the answer, say the figure covers what you can see.

--- CONTEXT ---
${context}
--- END CONTEXT ---`

export async function POST(req: NextRequest) {
  try {
    const user = await requireRoleOrThrow('CEO')
    const body = await req.json()
    const parsed = chatRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { message, history = [] } = parsed.data
    const config = await loadAIConfig(user.organization_id)

    let adapter
    try {
      adapter = await requireUsableAI(config)
    } catch (err) {
      /*
       * Running out of credits is not a failure — the system did exactly what the
       * CEO configured it to do. So it comes back 200 with a `notice`, which the
       * chat renders as a calm line in the transcript, rather than a 503 the client
       * paints red with a warning glyph. The distinction is the whole point: a red
       * error invites someone to look for a bug, and there is no bug to find.
       *
       * A notice rather than a fabricated assistant `turn`: nothing was asked of a
       * model, so inventing a turn would mean writing a row to ai_command_log that
       * claims the assistant said something it never said. Returning early also
       * skips recordUsage, because no credits were spent being refused.
       *
       * Being out of credits is still worth an audit row — it is the moment the
       * assistant stopped answering, and without it a CEO asking "why did it go
       * quiet on Tuesday" has nothing to read.
       */
      if (err instanceof AIUnavailableError && err.reason === 'quota') {
        await logAction({
          organizationId: user.organization_id,
          userId: user.id,
          action: 'ai.credit_limit_reached',
          entityType: 'ai_chat',
          metadata: {
            credits_used: err.usage?.used ?? null,
            credit_limit: err.usage?.limit ?? null,
          },
        })

        return NextResponse.json({
          notice: {
            kind: 'credit_limit',
            message: err.message,
            used: err.usage?.used ?? null,
            limit: err.usage?.limit ?? null,
          },
        })
      }

      // Turned off, or no key. Those are configuration states the dashboard already
      // explains up front, so they stay errors.
      const reason = err instanceof AIUnavailableError ? err.message : 'AI is not available.'
      return NextResponse.json({ error: reason }, { status: 503 })
    }

    /*
     * Built with the caller's session, so RLS decides the assistant's reach rather
     * than this route's WHERE clauses. The old builder used the service client and
     * bypassed policy entirely — tolerable across three tables, not across twenty.
     */
    const context = await buildAIContext(user)

    /*
     * The org's financial figures were read and are about to leave for whatever
     * endpoint AI Settings names, so that gets its own audit row before the request
     * goes out — written first, because an audit entry that only exists when the
     * provider call succeeds is not an access log.
     *
     * The standing rule is to log access to money and salary data even for the CEO.
     * Salary is not in this schema at all, so there is nothing to log there; closed
     * revenue, quoted value, PO totals and tender pipeline are, and this is them.
     */
    if (context.includedFinancials) {
      await logAction({
        organizationId: user.organization_id,
        userId: user.id,
        action: 'ai.financial_context_read',
        entityType: 'ai_chat',
        metadata: {
          provider: config.provider,
          model: config.model,
          // The host the data is being sent to is the point of this record.
          base_url: config.baseUrl,
          unavailable: context.unavailable,
        },
      })
    }

    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...history.slice(-10),
      { role: 'user', content: message },
    ]

    const result = await adapter.complete({
      system: CHAT_SYSTEM(context.text),
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

    // Every AI turn is logged, answer or proposal alike.
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
