'use client'

import { useState } from 'react'

/**
 * The one and only chance to read a new employee's credentials.
 *
 * HR assigns the password during onboarding and it is never persisted in a readable form — Supabase
 * auth keeps a hash, and nothing in our own schema stores the plaintext (deliberately: an ERP table
 * holding staff passwords would be the single worst row in the database). So this panel is blunt
 * about the password not being recoverable, rather than implying HR can look it up later.
 *
 * Shown after a successful onboard by both the inline form and the wizard. `children` is for a
 * flow-specific follow-on action, e.g. the wizard's link to the new profile board.
 */
export function CredentialHandover({
  name,
  email,
  password,
  onDismiss,
  children,
}: {
  name: string
  email: string
  password: string
  onDismiss?: () => void
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Login: ${email}\nPassword: ${password}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused (insecure context, permissions). The credentials are
      // on screen regardless, so this needs no error of its own.
      setCopied(false)
    }
  }

  return (
    <div className="rounded-lg border border-status-success/40 bg-status-success/5 px-4 py-3">
      <p className="text-sm font-semibold text-brand-slate">✓ {name} is onboarded</p>
      <p className="mt-1 text-xs text-text-muted">
        Hand these over now — the password is not saved anywhere, so this is the only time it is
        shown.
      </p>

      <dl className="mt-3 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Login
          </dt>
          <dd className="text-sm font-medium text-brand-slate">{email}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Password
          </dt>
          <dd className="font-mono text-sm font-medium text-brand-slate">{password}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-border-subtle bg-surface-card px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold"
        >
          {copied ? 'Copied ✓' : 'Copy both'}
        </button>
        {children}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:text-brand-slate"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}
