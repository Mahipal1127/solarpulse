'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { AITurn } from '@/lib/ai/proposalSchema'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  turn?: AITurn
  commandId?: string | null
  confirmed?: boolean
  rejected?: boolean
  error?: string
}

export function AIChat() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const history = messages
    .filter((m) => !m.error)
    .map((m) => ({ role: m.role, content: m.content }))

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(-10) }),
      })
      const data = await res.json()

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: data.error ?? 'Error', error: data.error },
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
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: 'Network error.', error: 'Network error' },
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
          prev.map((m) => (m.id === msg.id ? { ...m, error: data.error ?? 'Failed' } : m))
        )
      } else {
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, confirmed: true } : m)))
        router.refresh()
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, error: 'Network error during confirm' } : m))
      )
    } finally {
      setConfirming(null)
    }
  }

  function rejectAction(msgId: string) {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, rejected: true } : m)))
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`
  }

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-2xl">
              ✨
            </div>
            <p className="text-sm font-medium text-slate-700">How can I help you today?</p>
            <p className="max-w-xs text-xs text-slate-500">
              Ask about tasks, approvals, or request an action. All actions require your confirmation before executing.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs text-white mt-1">
                AI
              </div>
            )}

            <div className={`max-w-[78%] space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-tr-sm bg-indigo-600 text-white'
                    : msg.error
                      ? 'rounded-tl-sm bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                      : 'rounded-tl-sm bg-white text-slate-800 shadow-sm ring-1 ring-slate-200'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>

              {/* Proposal block */}
              {msg.turn?.kind === 'proposed_action' && !msg.confirmed && !msg.rejected && msg.commandId && (
                <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">⚡</span>
                    <p className="text-xs font-semibold text-amber-800">Proposed action — requires confirmation</p>
                  </div>
                  <p className="text-sm text-amber-900 mb-4 leading-relaxed">{msg.turn.summary}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => confirmAction(msg)}
                      disabled={confirming === msg.id}
                      className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                    >
                      {confirming === msg.id ? 'Executing…' : '✓ Confirm & Execute'}
                    </button>
                    <button
                      onClick={() => rejectAction(msg.id)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  {msg.error && <p className="mt-3 text-xs text-rose-600">{msg.error}</p>}
                </div>
              )}

              {msg.confirmed && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <span>✓</span> Action executed successfully.
                </div>
              )}
              {msg.rejected && (
                <div className="text-xs text-slate-500">Cancelled — no changes made.</div>
              )}
            </div>

            {msg.role === 'user' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 mt-1">
                You
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3 justify-start">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">
              AI
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200">
              <div className="flex gap-1 items-center">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={autoResize}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="Ask a question or request an action…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-slate-900 placeholder-slate-400 outline-none"
            style={{ maxHeight: '140px' }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            aria-label="Send"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 text-center text-xs text-slate-400">
          Enter to send · Shift+Enter for new line · All actions need your confirmation
        </p>
      </div>
    </div>
  )
}
