'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, ClipboardList, FileText, Inbox } from 'lucide-react'

/**
 * The header notification bell, shared by every dashboard.
 *
 * WHAT IT SHOWS. A derived feed from /api/notifications — tasks assigned to you, reports submitted
 * to you (managers/CEO), and applications addressed to you (HR/CEO). The server decides relevance
 * by role and RLS; this component only renders and tracks "seen".
 *
 * UNREAD IS PER-DEVICE. There is no server-side read state. We keep a last-seen ISO timestamp in
 * localStorage and count items newer than it as unread; opening the panel advances last-seen to the
 * newest item's time. Every storage access is wrapped — a private window or blocked storage must
 * degrade to "everything looks unread" rather than throw.
 *
 * POLLING. A light poll every 60s plus an immediate fetch on mount and whenever the tab regains
 * focus, so a badge appears without a full navigation. Failures are swallowed; a flaky request must
 * never blank the header.
 */

interface NotificationItem {
  id: string
  kind: 'task' | 'report' | 'application'
  title: string
  detail: string
  href: string
  timestamp: string
}

const STORAGE_KEY = 'notifications:lastSeen'
const POLL_MS = 60_000

function readLastSeen(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeLastSeen(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Private mode / storage disabled — unread simply won't persist across reloads. Non-fatal.
  }
}

/**
 * `header` (default): the bell sits in a top bar, so its panel drops down and aligns to the bell's
 * right edge. `sidebar`: the bell sits at the foot of the CEO sidebar with no top bar, so the panel
 * opens UPWARD and extends rightward into the content area — the sidebar is only 15rem wide and the
 * panel is wider, so a right-aligned downward panel would clip and open below the fold.
 */
type BellPlacement = 'header' | 'sidebar'

export function NotificationBell({ placement = 'header' }: { placement?: BellPlacement }) {
  const [items, setItems] = useState<NotificationItem[]>([])
  // Read last-seen during render via a lazy initializer, not in an effect. It is safe on the
  // server (readLastSeen catches the missing localStorage and returns '') and safe for hydration:
  // on the first render `items` is empty, so the unread count is 0 whatever last-seen holds, and
  // nothing visible differs between server and client until the fetch below resolves post-mount.
  const [lastSeen, setLastSeen] = useState(readLastSeen)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Initial fetch + poll + refetch when the tab regains focus. setState lives inside the promise
  // callback (asynchronous external-data sync), with an `active` guard so a resolve after unmount
  // is dropped rather than warning.
  useEffect(() => {
    let active = true
    const load = () => {
      fetch('/api/notifications', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { items?: NotificationItem[] } | null) => {
          if (active && body) setItems(Array.isArray(body.items) ? body.items : [])
        })
        .catch(() => {
          // Swallow — keep whatever we last had rather than blanking the bell.
        })
    }

    load()
    const timer = setInterval(load, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const unreadCount = lastSeen
    ? items.filter((i) => i.timestamp > lastSeen).length
    : items.length

  function toggle() {
    const next = !open
    setOpen(next)
    // Opening marks everything currently shown as seen: advance last-seen to the newest item.
    if (next && items.length > 0) {
      const newest = items.reduce((max, i) => (i.timestamp > max ? i.timestamp : max), items[0].timestamp)
      setLastSeen(newest)
      writeLastSeen(newest)
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-bg hover:text-brand-slate"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-danger px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className={`absolute z-50 w-80 overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm ${
            placement === 'sidebar'
              ? 'bottom-full left-0 mb-2 animate-chat-rise'
              : 'right-0 mt-2'
          }`}
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Notifications
            </p>
            {items.length > 0 && (
              <span className="text-[10px] text-text-muted">{items.length} recent</span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-brand-slate">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-text-muted">
                New tasks, reports, and applications will show up here.
              </p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-border-subtle overflow-y-auto">
              {items.map((item) => {
                const unread = !lastSeen || item.timestamp > lastSeen
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-bg"
                    >
                      <KindIcon kind={item.kind} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-semibold text-brand-slate">
                            {item.title}
                          </p>
                          {unread && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" aria-label="unread" />
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-text-muted">{item.detail}</p>
                        <p className="mt-0.5 text-[10px] text-text-muted">{relativeTime(item.timestamp)}</p>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function KindIcon({ kind }: { kind: NotificationItem['kind'] }) {
  const cls = 'h-4 w-4'
  const icon =
    kind === 'task' ? (
      <ClipboardList className={cls} />
    ) : kind === 'report' ? (
      <FileText className={cls} />
    ) : (
      <Inbox className={cls} />
    )
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-bg text-text-muted">
      {icon}
    </span>
  )
}

/** Compact "just now / 3h / 2d" relative time. Absolute date once it's older than a week. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const min = Math.round(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
