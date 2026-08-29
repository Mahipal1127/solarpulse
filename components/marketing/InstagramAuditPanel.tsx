'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, Terminal, Sparkles, Trash2, Copy, Check } from 'lucide-react'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'
import type { InstagramAccount, InstagramAudit } from '@/lib/instagram/types'
import { InstagramAuditReport } from './InstagramAuditReport'

/**
 * Instagram audit — connect a handle, run the collector, read the audit.
 *
 * WHY THE MIDDLE STEP IS A TERMINAL COMMAND AND NOT A BUTTON.
 * Auditing a Professional profile without the Graph API means reading the profile the way a
 * person does: in a logged-in browser. A logged-in browser cannot live in a serverless
 * function — no display, no persistent profile, a lifetime measured in seconds. So collection
 * runs on the operator's own machine (tools/instagram-audit), and this panel's job is to hand
 * that tool a short-lived token and then show what came back. A "Sync now" button here would
 * be a lie about where the work happens.
 *
 * WHAT THIS PANEL NEVER ASKS FOR. No Instagram password, no session cookie, no app token —
 * there is no field for one and no column to put it in. The operator logs into Instagram
 * themselves, in their own browser window. That is the whole reason the flow has three steps
 * instead of one.
 *
 * READ-ONLY FOR THE CEO, like every other Marketing write path. `readOnly` hides the connect
 * form, the collector and the generate control; the audits themselves stay fully visible,
 * because reading them is the point of the CEO having access.
 */

const WINDOWS: Array<{ label: string; days: number | null }> = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'Last year', days: 365 },
  { label: 'Everything stored', days: null },
]

const SYNC_STATUS_BADGE: Record<string, { className: string; label: string }> = {
  ok: { className: 'badge-success', label: 'Synced' },
  partial: { className: 'badge-warning', label: 'Partial sync' },
  failed: { className: 'badge-danger', label: 'Sync failed' },
  never: { className: 'badge-neutral', label: 'Never synced' },
}

const selectClass =
  'rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-gold'
const primaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60'
const quietButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:border-brand-gold hover:text-brand-gold disabled:opacity-60'

interface MintedToken {
  token: string
  expiresAt: string
  /** Captured at click time from the browser's own address bar — see mintToken. */
  erp: string
}

export function InstagramAuditPanel({
  accounts,
  auditsByAccount,
  storedPostsByAccount,
  readOnly,
}: {
  accounts: InstagramAccount[]
  auditsByAccount: Record<string, InstagramAudit[]>
  storedPostsByAccount: Record<string, number>
  readOnly: boolean
}) {
  const router = useRouter()

  // Falls back to the first account when the selection is stale (just disconnected, or
  // the account list arrived after mount).
  const [selectedId, setSelectedId] = useState<string | null>(accounts[0]?.id ?? null)
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0] ?? null

  if (accounts.length === 0) {
    return (
      <Card>
        <CardHeader
          icon={<Link2 className="h-4 w-4" />}
          title="Instagram audit"
          subtitle="Connect the company handle, collect its grid from your own browser, and have the AI read the numbers back to you."
        />
        {readOnly ? (
          <EmptyState
            title="No Instagram account connected"
            description="Once the Marketing team connects a handle and runs a collection, their audits appear here."
          />
        ) : (
          <div className="px-5 py-5">
            <ConnectForm onDone={() => router.refresh()} />
            <SetupNote />
          </div>
        )}
      </Card>
    )
  }

  const audits = selected ? (auditsByAccount[selected.id] ?? []) : []
  const storedPosts = selected ? (storedPostsByAccount[selected.id] ?? 0) : 0
  return (
    <Card>
      <CardHeader
        icon={<Link2 className="h-4 w-4" />}
        title="Instagram audit"
        subtitle="Collected from your own logged-in browser, measured here, and phrased by the AI. No Instagram API, no stored password."
        action={
          accounts.length > 1 ? (
            <select
              aria-label="Choose an Instagram account"
              className={selectClass}
              value={selected?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.username}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {selected && (
        <div className="space-y-5 px-5 py-5">
          <AccountSummary account={selected} storedPosts={storedPosts} />

          {!readOnly && (
            <>
              <CollectorStep account={selected} />
              <GenerateStep account={selected} storedPosts={storedPosts} />
              <DangerRow account={selected} />
            </>
          )}

          {readOnly && (
            <p className="text-xs text-text-muted">
              Read-only. The Marketing team runs the collection and generates the audits; every
              one they run is visible to you here.
            </p>
          )}

          <AuditHistory audits={audits} />
        </div>
      )}

      {!readOnly && accounts.length > 0 && (
        <div className="border-t border-border-subtle px-5 py-4">
          <details>
            <summary className="cursor-pointer text-xs font-medium text-text-muted">
              Connect another handle
            </summary>
            <div className="mt-3">
              <ConnectForm onDone={() => router.refresh()} />
            </div>
          </details>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — connect
// ---------------------------------------------------------------------------

/**
 * A handle, and nothing else.
 *
 * The absence of a password field here is not a simplification — it is the design. The
 * connect row is a statement that "this org audits this handle", which is what later
 * authorises a collection for it; the sync endpoint refuses any handle nobody connected.
 */
function ConnectForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    if (!username.trim()) return
    setPending(true)
    setError(null)

    const res = await fetch('/api/instagram/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.trim() }),
    })
    setPending(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not connect that handle.')
      return
    }
    setUsername('')
    onDone()
  }

  return (
    <div>
      <label
        htmlFor="ig-handle"
        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
      >
        Instagram handle
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="ig-handle"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') connect()
          }}
          placeholder="solarpulse"
          autoComplete="off"
          className="min-w-56 flex-1 rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
        />
        <button onClick={connect} disabled={pending} className={primaryButtonClass}>
          <Link2 className="h-3.5 w-3.5" />
          {pending ? 'Connecting…' : 'Connect account'}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-text-muted">
        The handle only. Pasting the full profile URL works too. No password is asked for here or
        anywhere in this feature — you log into Instagram yourself, in your own browser.
      </p>
      {error && <p className="mt-2 text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}

function SetupNote() {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs font-medium text-text-muted">
        One-time setup on your machine
      </summary>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-brand-slate px-3 py-2.5 text-xs text-white">
        {'cd solar-pulse-os/tools/instagram-audit\nnpm install'}
      </pre>
      <p className="mt-1.5 text-xs text-text-muted">
        Downloads a browser (~150 MB) once. Full notes in{' '}
        <code className="text-brand-slate">tools/instagram-audit/README.md</code>.
      </p>
    </details>
  )
}

// ---------------------------------------------------------------------------
// The account, as it stands
// ---------------------------------------------------------------------------

function AccountSummary({
  account,
  storedPosts,
}: {
  account: InstagramAccount
  storedPosts: number
}) {
  const badge = SYNC_STATUS_BADGE[account.sync_status] ?? SYNC_STATUS_BADGE.never

  return (
    <div className="rounded-xl bg-surface-bg px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <a
          href={`https://www.instagram.com/${account.username}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-brand-slate underline decoration-dotted underline-offset-2"
        >
          @{account.username}
        </a>
        <Badge className={badge.className}>{badge.label}</Badge>
        {account.is_professional === false && (
          <Badge className="badge-warning">Not a professional account</Badge>
        )}
        <span className="text-xs text-text-muted">
          {account.last_synced_at
            ? `Last collected ${formatDateTime(account.last_synced_at)}`
            : 'Not collected yet'}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
        {/* Nullish, not falsy: a real 0 following count is worth showing, and an unread
            count must not masquerade as one. */}
        {account.follower_count != null && (
          <span>
            <span className="font-medium text-brand-slate">
              {account.follower_count.toLocaleString('en-IN')}
            </span>{' '}
            followers
          </span>
        )}
        {account.following_count != null && (
          <span>
            <span className="font-medium text-brand-slate">
              {account.following_count.toLocaleString('en-IN')}
            </span>{' '}
            following
          </span>
        )}
        {account.post_count != null && (
          <span>
            <span className="font-medium text-brand-slate">
              {account.post_count.toLocaleString('en-IN')}
            </span>{' '}
            posts on profile
          </span>
        )}
        <span>
          <span className="font-medium text-brand-slate">
            {storedPosts.toLocaleString('en-IN')}
          </span>{' '}
          posts collected here
        </span>
        {account.connected_by_name && <span>Connected by {account.connected_by_name}</span>}
      </div>

      {account.biography && (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-text-muted">
          {account.biography}
        </p>
      )}

      {account.sync_error && (
        <p className="mt-2 text-xs text-status-danger">⚠ {account.sync_error}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — the collector
// ---------------------------------------------------------------------------

/**
 * Mint a token and show the exact command to paste.
 *
 * The token is a credential and is displayed once. There is no endpoint that reads it back —
 * RLS denies instagram_sync_tokens to every client — so after the page is left, the only copy
 * is the one the operator kept.
 */
function CollectorStep({ account }: { account: InstagramAccount }) {
  const [minted, setMinted] = useState<MintedToken | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const command = minted
    ? `node collect.mjs --username ${account.username} --erp ${minted.erp} --token ${minted.token}`
    : ''

  async function mintToken() {
    setPending(true)
    setError(null)
    // Read the origin here rather than at render: the server has no address bar, and using it
    // during render would make the markup differ between server and client. By the time this
    // handler runs we are unambiguously in the browser, and its address bar is the most
    // reliable answer to "which ERP URL does this operator actually reach?"
    const erp = window.location.origin

    const res = await fetch('/api/instagram/sync-token', { method: 'POST' })
    setPending(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not create a collection token.')
      return
    }
    const body = await res.json()
    setMinted({ token: body.token, expiresAt: body.expiresAt, erp })
    setCopied(false)
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch {
      // Clipboard access can be refused (insecure origin, permission policy). The command is
      // on screen and selectable, so this is a missing convenience, not a failure worth an
      // error message.
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-brand-slate">Collect the latest posts</h3>
          <p className="mt-0.5 max-w-2xl text-xs text-text-muted">
            Runs on your machine, in a real browser window you log into yourself. Get a token
            here, paste the command into a terminal in{' '}
            <code className="text-brand-slate">tools/instagram-audit</code>, and log in when the
            window opens.
          </p>
        </div>
        <button onClick={mintToken} disabled={pending} className={quietButtonClass}>
          <Terminal className="h-3.5 w-3.5" />
          {pending ? 'Creating…' : minted ? 'New token' : 'Run the collector'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-status-danger">⚠ {error}</p>}

      {minted && (
        <div className="mt-3 space-y-2">
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-brand-slate px-3 py-2.5 text-xs text-white">
              {command}
            </pre>
            <button onClick={copyCommand} className={quietButtonClass} aria-label="Copy command">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="notice-warning rounded-lg px-3 py-2 text-xs">
            This token works once and expires {formatDateTime(minted.expiresAt)}. It is shown
            here only — nothing can read it back. When the collector finishes, reload this page
            and generate the audit.
          </p>
        </div>
      )}

      <SetupNote />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — the audit
// ---------------------------------------------------------------------------

function GenerateStep({
  account,
  storedPosts,
}: {
  account: InstagramAccount
  storedPosts: number
}) {
  const router = useRouter()
  const [days, setDays] = useState<number | null>(90)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function generate() {
    setPending(true)
    setError(null)
    setNotice(null)

    const res = await fetch('/api/instagram/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: account.id, days }),
    })
    setPending(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not generate the audit.')
      return
    }

    // AI being off is a success, not an error: the figures were computed and stored, and only
    // the prose is missing. Say so plainly instead of showing a red line over a real audit.
    const body = await res.json()
    if (body.audit?.unavailable_reason) setNotice(body.audit.unavailable_reason)
    router.refresh()
  }

  return (
    <div className="border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-brand-slate">Generate the audit</h3>
          <p className="mt-0.5 max-w-2xl text-xs text-text-muted">
            The figures are computed here from the collected posts. The AI is handed the
            finished numbers and asked only to read them — niche, what is working, what is not,
            and what to do next.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Period to audit"
            className={selectClass}
            value={days === null ? 'all' : String(days)}
            onChange={(e) => setDays(e.target.value === 'all' ? null : Number(e.target.value))}
          >
            {WINDOWS.map((option) => (
              <option key={option.label} value={option.days === null ? 'all' : String(option.days)}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            onClick={generate}
            disabled={pending || storedPosts === 0}
            className={primaryButtonClass}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {pending ? 'Auditing…' : 'Generate audit'}
          </button>
        </div>
      </div>

      {storedPosts === 0 && (
        <p className="mt-2 text-xs text-text-muted">
          Nothing to audit yet — run the collector first.
        </p>
      )}
      {notice && <p className="notice-warning mt-2 rounded-lg px-3 py-2 text-xs">{notice}</p>}
      {error && <p className="mt-2 text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

/**
 * Two clicks, and the second one says what it destroys.
 *
 * Disconnecting cascades: the account row takes its posts and its whole audit history with
 * it. A one-click button next to "Generate audit" would be a bad neighbour, so the warning
 * is the confirmation itself rather than a browser dialog nobody reads.
 */
function DangerRow({ account }: { account: InstagramAccount }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function disconnect() {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/instagram/accounts/${account.id}`, { method: 'DELETE' })
    setPending(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not disconnect the account.')
      return
    }
    setConfirming(false)
    router.refresh()
  }

  return (
    <div className="border-t border-border-subtle pt-4">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-status-danger">
            Disconnecting @{account.username} deletes every collected post and every audit for
            it. This cannot be undone.
          </p>
          <button onClick={disconnect} disabled={pending} className={quietButtonClass}>
            <Trash2 className="h-3.5 w-3.5" />
            {pending ? 'Disconnecting…' : 'Yes, disconnect'}
          </button>
          <button onClick={() => setConfirming(false)} className={quietButtonClass}>
            Keep it
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className={quietButtonClass}>
          <Trash2 className="h-3.5 w-3.5" />
          Disconnect @{account.username}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The audits
// ---------------------------------------------------------------------------

/**
 * The newest audit, expanded, with the earlier ones one click away.
 *
 * Keeping the history reachable matters more here than in most feeds: "is engagement moving"
 * is a question about two audits, and the honest way to answer it is to let someone read both
 * rather than have the model claim a trend from a single snapshot.
 */
function AuditHistory({ audits }: { audits: InstagramAudit[] }) {
  const [openId, setOpenId] = useState<string | null>(audits[0]?.id ?? null)

  if (audits.length === 0) {
    return (
      <div className="border-t border-border-subtle pt-4">
        <EmptyState
          title="No audit yet"
          description="Collect the profile, then generate an audit. The numbers are measured here; the AI only phrases them."
        />
      </div>
    )
  }

  const open = audits.find((audit) => audit.id === openId) ?? audits[0]

  return (
    <div className="space-y-3 border-t border-border-subtle pt-4">
      {audits.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Audits
          </span>
          {audits.map((audit) => (
            <button
              key={audit.id}
              onClick={() => setOpenId(audit.id)}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                audit.id === open.id
                  ? 'border-brand-gold text-brand-gold'
                  : 'border-border-subtle text-text-muted hover:border-brand-gold hover:text-brand-gold'
              }`}
            >
              {formatDateTime(audit.created_at)}
              {!audit.ai_generated && ' · figures only'}
            </button>
          ))}
        </div>
      )}

      <InstagramAuditReport audit={open} />
    </div>
  )
}
