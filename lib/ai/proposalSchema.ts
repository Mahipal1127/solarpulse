import { z } from 'zod'

/**
 * The contract every AI turn must satisfy. A turn either answers a question or
 * *proposes* an action — it can never do both, and it can never execute. The
 * proposal is persisted to ai_command_log and executed only by /api/ai/confirm,
 * which reads the payload back from the database rather than from the client.
 */

export const AI_ACTIONS = ['none', 'create_task', 'update_task', 'archive_task'] as const
export type AIAction = (typeof AI_ACTIONS)[number]

/**
 * Names, not UUIDs. The model is not given identifiers to echo back, so it
 * cannot hallucinate one that happens to resolve — the server looks names up
 * and refuses ambiguous or unknown matches.
 */
export const aiPayloadSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  department_name: z.string().nullable(),
  assignee_name: z.string().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable(),
  due_date: z.string().nullable(),
  task_title: z.string().nullable(),
  status: z.enum(['pending', 'in_progress', 'delayed', 'completed']).nullable(),
  /*
   * No progress_percent. The AI acts as the CEO, and the CEO does not author an
   * employee's progress — see the note in lib/validation/schemas.ts. Leaving it
   * here would have let the assistant do by proposal what the UI refuses to do
   * by hand.
   */
  note: z.string().nullable(),
})

export const aiTurnSchema = z.object({
  kind: z.enum(['answer', 'proposed_action']),
  message: z.string(),
  action: z.enum(AI_ACTIONS),
  summary: z.string(),
  payload: aiPayloadSchema,
})

export type AIPayload = z.infer<typeof aiPayloadSchema>
export type AITurn = z.infer<typeof aiTurnSchema>

/**
 * Hand-authored rather than generated, because the provider's structured-output
 * mode requires every property listed in `required` and additionalProperties
 * false at every level.
 */
export const AI_TURN_JSON_SCHEMA = {
  name: 'ceo_assistant_turn',
  description:
    'Either a plain answer, or a single proposed action awaiting the CEO’s explicit confirmation.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'message', 'action', 'summary', 'payload'],
    properties: {
      kind: {
        type: 'string',
        enum: ['answer', 'proposed_action'],
        description: 'Use "answer" for questions. Use "proposed_action" only when the CEO asked for a change to be made.',
      },
      message: {
        type: 'string',
        description: 'The natural-language reply. For a proposed action, explain what you are about to do and why.',
      },
      action: {
        type: 'string',
        enum: [...AI_ACTIONS],
        description: 'Must be "none" when kind is "answer".',
      },
      summary: {
        type: 'string',
        description:
          'One sentence the CEO will see on the confirm dialog, e.g. "Create task “Site survey” for the Technical department, due 12 Aug." Empty string when kind is "answer".',
      },
      payload: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'description',
          'department_name',
          'assignee_name',
          'priority',
          'due_date',
          'task_title',
          'status',
          'note',
        ],
        properties: {
          title: { type: ['string', 'null'], description: 'New task title. create_task only.' },
          description: { type: ['string', 'null'] },
          department_name: {
            type: ['string', 'null'],
            description: 'Exact department name from the provided list. create_task only.',
          },
          assignee_name: {
            type: ['string', 'null'],
            description: 'Exact employee name from the provided list, or null to leave unassigned.',
          },
          priority: { type: ['string', 'null'], enum: ['low', 'medium', 'high', 'urgent', null] },
          due_date: { type: ['string', 'null'], description: 'ISO 8601 date-time, or null.' },
          task_title: {
            type: ['string', 'null'],
            description: 'Exact title of an existing task. update_task and archive_task only.',
          },
          status: {
            type: ['string', 'null'],
            enum: ['pending', 'in_progress', 'delayed', 'completed', null],
          },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const

/** Payload fields that must be present for each action to be executable. */
export function validateProposal(turn: AITurn): string | null {
  if (turn.kind === 'answer') {
    return turn.action === 'none' ? null : 'An answer turn must not carry an action.'
  }
  if (turn.action === 'none') return 'A proposed action must name an action.'
  if (!turn.summary.trim()) return 'A proposed action must include a confirmation summary.'

  const p = turn.payload
  switch (turn.action) {
    case 'create_task':
      if (!p.title?.trim()) return 'The proposed task has no title.'
      if (!p.department_name?.trim()) return 'The proposed task has no department.'
      return null
    case 'update_task':
      if (!p.task_title?.trim()) return 'The proposed update does not identify a task.'
      if (p.status === null && !p.note?.trim()) {
        return 'The proposed update changes nothing.'
      }
      return null
    case 'archive_task':
      if (!p.task_title?.trim()) return 'The proposed archive does not identify a task.'
      return null
    default:
      return 'Unsupported action.'
  }
}
