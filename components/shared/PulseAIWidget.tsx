'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { AIChat } from '@/components/ceo/AIChat/AIChat'

/**
 * The always-on Pulse AI pill, and the chat window it opens.
 *
 * WHY A PILL
 * The assistant belongs on every dashboard, but a dashboard is a working surface —
 * stats, queues, boards. A docked panel competes with the numbers for the first
 * screen; a circular pill fixed to the bottom-right corner is present on every load
 * without pushing anything around, and one click opens the conversation floating
 * above the work. Click again (or the X in the window header) and it is gone.
 *
 * THE SERVER/CLIENT SPLIT
 * This is the interactive half only. Readiness (which needs the service client —
 * see PulseAIPanel) and the greeting (which needs the IST clock) are computed on
 * the server and arrive as props, so this component holds nothing but the open/
 * close state.
 *
 * SECURITY, UNCHANGED
 * The chat inside runs on the caller's session — answers come from exactly what
 * this person can already see — and proposalsEnabled stays false here: the pill
 * helps the employee understand and plan their work; making changes happens in the
 * module screens. The CEO keeps the full propose-and-confirm loop on their own page.
 */
export function PulseAIWidget({
  greeting,
  ready,
  notReadyReason,
  suggestions,
}: {
  greeting: string
  ready: boolean
  notReadyReason?: string
  suggestions: string[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && (
        <div className="animate-chat-fade fixed bottom-24 right-4 z-50 flex h-[560px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-card shadow-xl sm:right-6">
          <AIChat
            greeting={greeting}
            ready={ready}
            notReadyReason={notReadyReason}
            suggestions={suggestions}
            proposalsEnabled={false}
            onClose={() => setOpen(false)}
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close Pulse AI' : 'Open Pulse AI'}
        aria-expanded={open}
        title="Pulse AI — ask about your work"
        className="fixed bottom-6 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-gold text-white shadow-lg shadow-brand-gold/30 transition-all hover:scale-105 hover:bg-brand-orange active:scale-95 sm:right-6"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    </>
  )
}