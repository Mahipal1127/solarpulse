'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronUp, HelpCircle, LifeBuoy, Settings, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ReportProblemDialog } from '@/components/shared/ReportProblemButton'

/**
 * The signed-in identity at the foot of the sidebar, with the controls that belong to
 * the person or the tool rather than to the page: report a problem, AI settings, help,
 * sign out.
 *
 * WHY IT LIVES IN THE SIDEBAR AND NOT OVER THE PAGE
 * It was briefly a floating avatar in the top-right of the content area. That put a
 * control on top of content, which meant three pages had to pad their headers to avoid
 * it and the chat toolbar needed a bespoke measurement — clearance arithmetic spread
 * across four files to protect one button. In the sidebar it occupies space instead of
 * covering it, so all of that goes away, and a 15rem column has room to show the name
 * rather than hiding it behind a click.
 *
 * IT MUST NOT RENDER INSIDE SIDEBAR_BODY
 * That container is `overflow-y-auto`, which establishes a clipping context: an
 * absolutely-positioned dropdown inside it gets cut off at the container's edge rather
 * than floating over the page. This is a sibling of the nav body, not a child of it.
 * The menu also opens upward — anchored at the bottom of the viewport, a downward menu
 * would open off-screen.
 *
 * WHY THESE FOUR, HERE
 * They were scattered. Sign out lived only inside the old dashboard header, so it
 * disappeared the moment that page became the assistant — and SignOutButton was
 * imported nowhere at all. Report a problem sat in an icon cluster on that same
 * dashboard-only header. Settings was a gear in the chat's own toolbar, reachable from
 * one screen. AI Settings and Help were also a footer group in the nav beside
 * Dashboard and Tasks, which put "configure the tool" in the list of places the
 * business lives. None of the four names a part of the business — they are properties
 * of the account and of the assistant — so they gather here and are present on every
 * CEO screen. SidebarNav has no footer group at all now; leaving one there would have
 * given AI Settings and Help two homes each.
 *
 * Showing the identity is not decoration here: every mutating action in this app is
 * audit-logged under the signed-in name, and the assistant can author changes
 * attributed to it. "Which account am I?" deserves a permanent answer.
 */
export function UserMenu({ user }: { user: { full_name: string; email: string } }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  /*
   * Close on outside click and on Escape. A dropdown with neither is a trap — it
   * stays open over whatever you click next, and a keyboard user has no way out.
   *
   * mousedown rather than click: a click that starts inside the menu and releases
   * outside it should not count as an outside click.
   */
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        // Focus goes back to the avatar, or a keyboard user is left adrift in the page.
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function signOut() {
    setSigningOut(true)
    try {
      // Audited server-side while the session cookie is still valid — after signOut()
      // there is no authenticated user left to attribute the logout to.
      await fetch('/api/auth/session', { method: 'DELETE' })
    } catch {
      // Non-fatal. A failed audit write must not strand someone in a session they
      // asked to leave.
    }
    await createClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  const initial = user.full_name?.trim().charAt(0).toUpperCase() || 'C'

  return (
    <>
      <div
        ref={containerRef}
        className="relative shrink-0 border-t border-border-subtle p-3"
      >
        <button
          ref={triggerRef}
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={open}
          /* The name is visible in the trigger now, but an explicit label states what
             the control does rather than letting the accessible name read as a name
             and an email string. */
          aria-label={`Account menu for ${user.full_name}`}
          className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${
            open ? 'bg-surface-bg' : 'hover:bg-surface-bg'
          }`}
        >
          {/* The brand gradient earns its place here: a small identity chip is about
              the person, not about status. */}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
            {initial}
          </span>

          {/* min-w-0 with truncate on both lines: a long email in a fixed-width column
              otherwise forces the whole rail wider. */}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-brand-slate">
              {user.full_name}
            </span>
            <span className="block truncate text-[10px] text-text-muted">{user.email}</span>
          </span>

          <ChevronUp
            className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Account"
            /*
              bottom-full: opens upward. The trigger sits at the bottom of the viewport,
              so a downward menu would render below the fold with no way to scroll to it.

              inset-x-3 rather than a fixed width, so it lines up with the trigger inside
              the container's padding instead of overhanging the sidebar edge.

              animate-chat-rise is defined in globals.css as real @keyframes — it
              translates upward, which matches this direction. The tailwindcss-animate
              classes this app used to reach for (animate-in, fade-in) emit nothing;
              that package is not a dependency.
            */
            className="animate-chat-rise absolute inset-x-3 bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-lg"
          >
            {/* No name/email header here any more — the trigger below shows both, and
                repeating them in the panel directly above it read as a stutter. */}
            <div className="p-1.5">
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  setReporting(true)
                }}
                className={MENU_ITEM}
              >
                <LifeBuoy className="h-4 w-4 shrink-0" />
                Report a problem
              </button>

              <Link
                role="menuitem"
                href="/ai/settings"
                onClick={() => setOpen(false)}
                className={MENU_ITEM}
              >
                <Settings className="h-4 w-4 shrink-0" />
                AI Settings
              </Link>

              {/*
                Help points at the IT support queue, which is where a CEO's reported
                problems actually go and the one page RLS shows them their own tickets.
                There is no help documentation in this app — the sidebar's "Help" entry
                was href="#", a link that went nowhere and could never light up as
                active. Sending it somewhere real is better than carrying a dead item
                across to the menu; if written help is wanted later, that is a page
                someone has to build, not a link to re-point.
              */}
              <Link
                role="menuitem"
                href="/technical/it-support"
                onClick={() => setOpen(false)}
                className={MENU_ITEM}
              >
                <HelpCircle className="h-4 w-4 shrink-0" />
                Help &amp; support
              </Link>
            </div>

            {/* Sign out is separated and is the one red item — a destructive-ish action
                should not sit flush against the two navigational ones. */}
            <div className="border-t border-border-subtle p-1.5">
              <button
                role="menuitem"
                onClick={signOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-status-danger transition-colors hover:bg-status-danger/5 disabled:opacity-60"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/*
        The dialog is a sibling of the menu, not a child of it. Rendered inside, it
        would unmount the instant the menu closed — and the menu has to close, or the
        dropdown floats over the form the whole time it is open.
      */}
      {reporting && (
        <ReportProblemDialog
          onClose={() => {
            setReporting(false)
            triggerRef.current?.focus()
          }}
        />
      )}
    </>
  )
}

const MENU_ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg hover:text-brand-slate'
