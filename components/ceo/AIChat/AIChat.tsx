'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowUp, Sparkles, Check, X, AlertCircle, Plus, Info } from 'lucide-react'
import { DictationButton } from '@/components/ceo/AIChat/DictationButton'
import type { AITurn } from '@/lib/ai/proposalSchema'

/**
 * The CEO's chat surface, and the whole of /dashboard.
 *
 * TWO STATES, ONE COMPOSER
 * Empty, the composer sits centred under a greeting — the page is an invitation, and
 * there is nothing above it to anchor to. From the first message it docks to the
 * bottom and the transcript scrolls above it. The composer itself is one <Composer />
 * rendered in two places rather than two blocks of similar JSX, because the second
 * copy is where the divergence would start.
 *
 * LAYOUT, AND WHY IT IS NOT SYMMETRIC
 * The assistant's replies are plain full-width text with no bubble; only the CEO's own
 * messages sit in a pill. Bubbles on both sides is the dated pattern — it halves the
 * width available to the side that actually writes paragraphs, and it frames an answer
 * as a chat artefact rather than as something to read. The asymmetry also does the work
 * a colour would otherwise have to: you can tell who said what without tinting
 * anything.
 *
 * WHERE COLOUR GOES
 * The user pill is `surface-bg`, not gold. Gold marks the active nav item and the
 * primary action, and a gold pill on every message the CEO has ever typed would spend
 * the accent on the least meaningful thing on screen. Gold here is the send button and
 * the confirm button — the two places something actually happens.
 *
 * THE CONFIRMATION GATE
 * The assistant proposes; it never executes. A proposal renders as a distinct card with
 * the summary the server validated, and nothing is written until the CEO presses
 * Confirm. The client sends only a commandId — /api/ai/confirm reads the proposal back
 * from the database rather than trusting the browser, so a tampered request cannot
 * change what was agreed to.
 */

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  turn?: AITurn
  commandId?: string | null
  confirmed?: boolean
  rejected?: boolean
  error?: string
  /**
   * A statement from the system rather than from the model — today, only "the
   * day's credits are used up". Distinct from `error` because it is not a fault:
   * it renders in muted grey with an info glyph, not red with a warning.
   */
  notice?: boolean
}

/**
 * Starter prompts. Deliberately things this assistant can actually answer from its
 * context — tasks, approvals, departments. A suggestion that returns "that module is
 * not connected yet" teaches the CEO the feature is broken.
 */
const SUGGESTIONS = [
  'What needs my attention today?',
  'Which tasks are overdue, and whose?',
  'Summarise the pending approvals',
  'Which department is furthest behind?',
]

export function AIChat({
  greeting,
  ready,
  notReadyReason,
}: {
  /** Rendered as-is. Computed on the server so the clock cannot differ between
   *  render passes and trip a hydration mismatch. */
  greeting: string
  ready: boolean
  notReadyReason?: string
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  /**
   * The credit-limit sentence, once the server has reported it. Null while there is
   * headroom.
   *
   * Holds the text rather than a boolean because it is needed in two places: the
   * transcript, and the empty state after "New chat" — a fresh conversation does not
   * restore credits, so that screen has to explain why the composer is shut instead
   * of inviting a question that cannot be answered.
   *
   * Deliberately never cleared in this component. It resets on reload, which is also
   * when a new day's headroom would actually be picked up.
   */
  const [creditNotice, setCreditNotice] = useState<string | null>(null)
  const creditLimited = creditNotice !== null
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const empty = messages.length === 0

  // Only scroll once a conversation exists, so the centred empty state is not yanked
  // upward on mount.
  useEffect(() => {
    if (messages.length > 0) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /**
   * Keep the caret in the composer.
   *
   * The composer moves from the centred block to the docked one on the first message,
   * which unmounts and remounts the textarea — so focus lands back on <body> and the
   * next thing typed goes nowhere. Every chat surface a CEO already uses leaves the
   * caret where it was, and re-clicking the input after each send is the kind of
   * papercut that makes a thing feel unfinished.
   *
   * Keyed on `empty` and `loading` rather than on `messages`: those are the two moments
   * the input is unmounted or disabled, and depending on the array would steal focus
   * back from anyone who had deliberately tabbed to Confirm on a proposal.
   */
  useEffect(() => {
    if (ready && !loading) textareaRef.current?.focus()
  }, [empty, loading, ready])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading || !ready || creditLimited) return

    /*
     * History excludes failed turns and system notices: replaying "Network error."
     * or "today's credits are used up" as assistant dialogue teaches the model to
     * imitate it — and the credit notice never came from a model in the first place.
     */
    const history = messages
      .filter((m) => !m.error && !m.notice)
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-10)

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: trimmed }])
    setInput('')
    setLoading(true)
    // No manual height reset here any more — the effect on `input` shrinks the box
    // when it is cleared, and two places setting the same style is how they diverge.

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      })
      const data = await res.json()

      if (!res.ok) {
        const reason = data.error ?? 'Something went wrong.'
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: reason, error: reason },
        ])
        return
      }

      /*
       * The day's credits are gone. This arrives 200 with no `turn`, so it has to
       * be handled before the turn is read — otherwise `turn.message` throws on
       * undefined, the catch below swallows it, and the CEO is told the assistant
       * is unreachable when in fact it answered perfectly clearly.
       *
       * `creditLimited` then closes the composer. The server refuses regardless, so
       * this is only to avoid sending a request whose answer is already known —
       * typing a second question and watching it bounce is worse than an input that
       * plainly says why it is shut.
       */
      if (data.notice) {
        setCreditNotice(data.notice.message as string)
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: data.notice.message as string,
            notice: true,
          },
        ])
        return
      }

      const turn = data.turn as AITurn
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: turn.message,
          turn,
          commandId: data.commandId ?? null,
        },
      ])
    } catch {
      const reason = 'Could not reach the assistant. Check your connection and try again.'
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: reason, error: reason },
      ])
    } finally {
      setLoading(false)
    }
  }

  async function confirmAction(msg: Message) {
    if (!msg.commandId || confirming) return
    setConfirming(msg.id)
    try {
      const res = await fetch('/api/ai/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: msg.commandId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, error: data.error ?? 'Could not apply that.' } : m
          )
        )
        return
      }
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, confirmed: true } : m)))
      /*
       * The action wrote real data. Nothing on this page displays that data any more —
       * the metrics moved to /analytics — but the refresh stays: it reruns the server
       * component, so anything derived server-side here cannot go stale, and the next
       * navigation to /analytics or /tasks starts from fresh data rather than a cached
       * render of the world before the change.
       */
      router.refresh()
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, error: 'Could not reach the server.' } : m))
      )
    } finally {
      setConfirming(null)
    }
  }

  /**
   * Height follows the value, not the keystroke.
   *
   * This used to live inside the change handler, which meant only *typing* resized
   * the box. Any other route to a new value left the height stale: dictation
   * appending a sentence would overflow a one-row textarea, and the reset after
   * send() needed its own manual line to undo the growth. An effect on `input`
   * covers every path by construction.
   */
  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [input])

  /**
   * Committed speech, appended to whatever is already in the box.
   *
   * Appends rather than replaces, so dictation can be mixed with typing and a
   * second sentence does not wipe the first. The functional form of setInput is
   * required, not stylistic: chunks can arrive faster than React re-renders, and
   * reading `input` from the closure would drop every chunk but the last.
   */
  const appendTranscript = useCallback((text: string) => {
    setInput((previous) => {
      const existing = previous.trimEnd()
      return existing ? `${existing} ${text}` : text
    })
  }, [])

  /**
   * One composer, rendered centred or docked. Extracted rather than duplicated —
   * two near-identical blocks are how the send button ends up disabled in one state
   * and not the other.
   */
  const composer = (
    <div className="chat-composer flex items-end gap-2 rounded-2xl px-4 py-3 transition-shadow">
      <label htmlFor="ai-chat-input" className="sr-only">
        Message the assistant
      </label>
      <textarea
        id="ai-chat-input"
        ref={textareaRef}
        value={input}
        // Height is handled by an effect on `input`, so every path to a new value
        // resizes — including dictation, which does not go through this handler.
        onChange={(event) => setInput(event.target.value)}
        disabled={!ready || creditLimited}
        onKeyDown={(event) => {
          // Enter sends; Shift+Enter is a newline. Matches every chat surface a CEO
          // already uses, so it needs no explaining.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send(input)
          }
        }}
        /*
          The placeholder carries the reason when the box is shut. A disabled input
          with the usual "Ask anything" prompt reads as broken; one that says why it
          is closed reads as a rule being applied.
        */
        placeholder={
          creditLimited
            ? 'Out of credits for today'
            : ready
              ? 'Ask anything, or request a change…'
              : 'The assistant is unavailable'
        }
        rows={1}
        className="max-h-[200px] flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed text-brand-slate outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
      />
      {/*
        Dictation sits left of Send, in reading order: it is a way to fill the box,
        so it belongs beside the box rather than beside the action that empties it.
        Disabled while a request is in flight — the reply is about to arrive and
        appending speech to a message already sent would be lost.
      */}
      <DictationButton
        onTranscript={appendTranscript}
        disabled={!ready || loading || creditLimited}
      />

      <button
        onClick={() => send(input)}
        disabled={loading || !input.trim() || !ready || creditLimited}
        aria-label="Send message"
        className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gold text-white transition-all hover:bg-brand-orange active:scale-95 disabled:bg-surface-bg disabled:text-text-muted"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  )

  return (
    <div className="chat-ambient flex h-full min-h-0 flex-col">
      {/*
        A slim bar rather than the old dashboard header. There is no page title to
        state — the greeting below says where you are — so this carries only what the
        chat itself needs: a way to start over, and the settings that govern it.
      */}
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-3.5">
        {/*
          Named to match the nav entry that leads here. A sidebar item saying "Pulse AI"
          opening a page headed "Assistant" reads as two different features.
        */}
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-slate">
          <Sparkles className="h-4 w-4 text-brand-gold" />
          Pulse AI
        </span>

        {/*
          "New chat" only. The settings gear that used to sit beside it is in the account
          menu at the foot of the sidebar now — it configures the assistant for the whole
          organisation,
          not this conversation, and two entry points to one settings page is how they
          drift. Starting a fresh conversation is genuinely local to this surface, so it
          stays.
        */}
        {!empty && (
          <button
            onClick={() => {
              setMessages([])
              setInput('')
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-card hover:text-brand-slate"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </button>
        )}
      </header>

      {empty ? (
        /*
          Centred, and pulled slightly above true centre: optically, a block centred by
          arithmetic in a tall viewport reads as sitting low.
        */
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-16">
          <div className="animate-chat-fade w-full max-w-2xl">
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-brand-slate sm:text-4xl">
                {greeting}
              </h1>
              {/*
                Three things this line can say, in priority order. The credit notice
                comes first because it is the most recent fact and it overrides the
                invitation: "New chat" clears the transcript but not the day's spend,
                so without this the CEO would land back on a welcoming screen with a
                dead composer and nothing to explain the contradiction.
              */}
              <p className="mt-3 text-sm text-text-muted">
                {creditNotice ??
                  (ready
                    ? 'Ask about tasks, approvals or departments. Request a change and it will be proposed for your confirmation first.'
                    : notReadyReason)}
              </p>
            </div>

            {composer}

            {/* Suggestions are buttons that send. With no credits left they would all
                bounce, so they are withheld rather than shown disabled — four dimmed
                pills say less than the sentence above already said. */}
            {ready && !creditLimited && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-border-subtle bg-surface-card/70 px-3.5 py-2 text-xs font-medium text-text-muted transition-colors hover:border-brand-gold/40 hover:text-brand-slate"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {!ready && (
              <p className="mt-5 text-center text-xs text-text-muted">
                <Link href="/ai/settings" className="font-medium text-brand-gold hover:underline">
                  Open settings
                </Link>{' '}
                to add a provider key. It is stored server-side and never sent to the browser.
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-6">
            <div className="mx-auto max-w-3xl space-y-7 py-4">
              {messages.map((msg) =>
                msg.role === 'user' ? (
                  <div key={msg.id} className="animate-chat-rise flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-card px-4 py-2.5 text-sm leading-relaxed text-brand-slate ring-1 ring-border-subtle">
                      {msg.content}
                    </p>
                  </div>
                ) : (
                  <div key={msg.id} className="animate-chat-rise space-y-3">
                    {msg.error ? (
                      <p className="flex items-start gap-2 text-sm text-status-danger">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        {msg.content}
                      </p>
                    ) : msg.notice ? (
                      /*
                        Muted grey and an info glyph, deliberately not the red error
                        treatment above. Running out of credits is the system doing
                        what it was told to do; painting it as a fault would send
                        someone looking for a bug that does not exist.
                      */
                      <p className="flex items-start gap-2 text-sm text-text-muted">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        {msg.content}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-slate">
                        {msg.content}
                      </p>
                    )}

                    {msg.turn?.kind === 'proposed_action' &&
                      msg.commandId &&
                      !msg.confirmed &&
                      !msg.rejected && (
                        <div className="rounded-xl border border-brand-gold/30 bg-brand-gold/5 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Needs your confirmation
                          </p>
                          <p className="mt-1.5 text-sm text-brand-slate">{msg.turn.summary}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              onClick={() => confirmAction(msg)}
                              disabled={confirming === msg.id}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
                            >
                              <Check className="h-3.5 w-3.5" />
                              {confirming === msg.id ? 'Applying…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() =>
                                setMessages((prev) =>
                                  prev.map((m) =>
                                    m.id === msg.id ? { ...m, rejected: true } : m
                                  )
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-card px-3.5 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
                            >
                              <X className="h-3.5 w-3.5" />
                              Discard
                            </button>
                          </div>
                        </div>
                      )}

                    {msg.confirmed && (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-status-success">
                        <Check className="h-3.5 w-3.5" />
                        Applied.
                      </p>
                    )}
                    {msg.rejected && (
                      <p className="text-xs text-text-muted">Discarded. Nothing changed.</p>
                    )}
                  </div>
                )
              )}

              {loading && <Thinking />}

              <div ref={bottomRef} />
            </div>
          </div>

          {/*
            Docked. No top border — the composer's own soft shadow separates it from
            the transcript, so a message scrolling under it passes behind something
            rather than colliding with a hard line.
          */}
          <div className="shrink-0 px-6 pb-5 pt-2">
            <div className="mx-auto max-w-3xl">
              {composer}
              <p className="mt-2 text-center text-[11px] text-text-muted">
                Changes are proposed for your confirmation. Nothing is written until you confirm.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Three dots breathing out of phase.
 *
 * Opacity and scale only — no vertical bounce, which reads as playful and belongs in a
 * toy rather than in the tool someone runs a company from. role="status" so a screen
 * reader is told work is in progress; without it the wait is silent.
 */
function Thinking() {
  return (
    <div className="flex items-center gap-1.5" role="status" aria-label="Thinking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="animate-chat-pulse h-1.5 w-1.5 rounded-full bg-brand-gold"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}
