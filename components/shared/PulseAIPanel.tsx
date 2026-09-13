import 'server-only'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { PulseAIWidget } from '@/components/shared/PulseAIWidget'
import { greetingFor } from '@/lib/greeting'
import type { AISettingsPublic } from '@/lib/types'
import type { SessionUser } from '@/lib/auth/guards'

/**
 * Starter prompts per department. Deliberately things the assistant can answer from
 * what buildAIContext gathers (tasks, leads, purchase orders, tenders, surveys,
 * tickets, people) — never module-only data the context does not carry (candidates,
 * stock levels, DISCOM cases), where the honest answer would be "I cannot see that"
 * and the suggestion itself would have taught the employee the feature is broken.
 * The generic set covers a department the map does not name, and the CEO visiting a
 * module read-only.
 */
const SUGGESTIONS_BY_SLUG: Record<string, string[]> = {
  sales: [
    'What needs my attention today?',
    'Which of my tasks are overdue?',
    'How many open leads do I have?',
    'What follow-ups are due?',
  ],
  hr: ['What needs my attention today?', 'Which of my tasks are overdue?', 'Who is in my department?'],
  finance: [
    'What needs my attention today?',
    'Which of my tasks are overdue?',
    'What purchase orders are awaiting Finance?',
  ],
  marketing: [
    'What needs my attention today?',
    'Which of my tasks are overdue?',
    'What is my department working on?',
  ],
  om: ['What needs my attention today?', 'Which of my tasks are overdue?', 'What IT tickets are open?'],
  store: ['What needs my attention today?', 'Which of my tasks are overdue?', 'Who is in my department?'],
  technical: [
    'What needs my attention today?',
    'Which of my tasks are overdue?',
    'How are my site surveys going?',
  ],
  distribution: [
    'What needs my attention today?',
    'Which of my tasks are overdue?',
    'What purchase orders are awaiting Finance?',
  ],
  discom: [
    'What needs my attention today?',
    'Which of my tasks are overdue?',
    'Who is in my department?',
  ],
  tender: [
    'What needs my attention today?',
    'Which tenders are closing this week?',
    'Which of my tasks are overdue?',
  ],
}

const DEFAULT_SUGGESTIONS = [
  'What needs my attention today?',
  'Which of my tasks are overdue?',
  'What is my department working on?',
]

/**
 * Pulse AI, embedded at the top of every department dashboard.
 *
 * ALWAYS ON, AS A FLOATING PILL
 * The CEO's assistant is a whole page because it is the CEO's dashboard. A
 * department dashboard is a working surface — stats, queues, boards — so the
 * assistant lives in a circular pill docked to the bottom-right corner of the
 * screen: present on every load, never pushing the numbers around, and one click
 * from a conversation that floats above the work. The server half below only reads
 * readiness and computes the greeting; everything interactive — the pill, the
 * floating window, the open/close state — lives in PulseAIWidget, the client half.
 *
 * READ IS RLS, WRITE IS CEO-ONLY
 * The chat behind this panel runs on the caller's session, so its answers are built
 * from exactly what this person can already see. It never proposes changes here:
 * proposalsEnabled=false removes the proposal UI and copy, and the chat route
 * refuses a proposed_action from a non-CEO outright. The CEO keeps the full
 * propose-and-confirm loop on their own page.
 *
 * WHY THE SERVICE CLIENT FOR THE READINESS CHECK
 * ai_settings is CEO-read RLS, so a session read from a department user comes back
 * empty and the panel would claim the assistant is "not set up" while the chat
 * route (whose loadAIConfig runs on the service client) would happily answer. The
 * panel must agree with the runtime, so it reads the same two booleans the runtime
 * checks, from the same client, scoped to the caller's organisation. No key
 * material crosses this read — ai_settings_public has no key column at all.
 */
export async function PulseAIPanel({ user }: { user: SessionUser }) {
  const service = createSupabaseServiceClient()

  const { data } = await service
    .from('ai_settings_public')
    .select('is_enabled, has_api_key')
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  const settings = data as Pick<AISettingsPublic, 'is_enabled' | 'has_api_key'> | null
  const ready = Boolean(settings?.is_enabled && settings?.has_api_key)

  /*
   * Three causes, three sentences that name the fix — the same care the CEO page
   * takes, pointed at the person who cannot fix it themselves rather than at the
   * person who can.
   */
  const notReadyReason = !settings
    ? 'Pulse AI has not been set up for this organisation yet. The CEO can configure it under AI Settings.'
    : !settings.has_api_key
      ? 'Pulse AI is waiting for a provider API key. The CEO can add one under AI Settings.'
      : 'Pulse AI is switched off right now. The CEO can enable it under AI Settings.'

  const suggestions = SUGGESTIONS_BY_SLUG[user.departmentSlug ?? ''] ?? DEFAULT_SUGGESTIONS

  return (
    <PulseAIWidget
      greeting={greetingFor(user.full_name)}
      ready={ready}
      notReadyReason={notReadyReason}
      suggestions={suggestions}
    />
  )
}