'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ChevronDown, LogOut } from 'lucide-react'
import { ReportProblemButton } from '@/components/shared/ReportProblemButton'

/**
 * Top bar for a department module: who is signed in, a greeting, the Report button
 * and the account menu. Shared by Tender, Sales, Distribution and Technical so the
 * four modules do not drift apart.
 *
 * Also the only sign-out affordance inside a department module — before this the
 * sidebar had none, so a Tender employee had no way to log out.
 *
 * The Report button sits here, in one shared component, precisely so it is present
 * in every module without four copies to keep in step. An ERP bug is found while
 * working, not while visiting a support page, and this is the affordance the
 * org-wide insert policy on it_support_tickets exists to serve.
 */
export function ModuleHeader({
  fullName,
  email,
  roleName,
  departmentName,
  subtitle,
}: {
  fullName: string
  email: string
  roleName: string
  departmentName: string | null
  /** Overrides the default "<Department> · <Role>" line under the greeting. */
  subtitle?: string
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  /**
   * Time of day comes from the viewer's clock, not the server's, so it is
   * resolved after mount — rendering it during SSR would greet someone in IST
   * with "Good evening" at midday whenever the server runs in UTC. The neutral
   * fallback below is what shows for the one frame before the effect runs.
   */
  const [greeting, setGreeting] = useState('Welcome back')
  useEffect(() => {
    const hour = new Date().getHours()
    setGreeting(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening')
  }, [])

  // Dismiss on outside click or Escape. A menu that traps focus with no way out
  // is worse than no menu.
  useEffect(() => {
    if (!menuOpen) return

    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  async function signOut() {
    setSigningOut(true)
    // Audited before the session is torn down — afterwards there is no
    // authenticated user left to attribute the logout to.
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {})
    await createClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  const initials = initialsOf(fullName)

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle bg-surface-card px-6 py-4">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold tracking-tight text-brand-slate">
          {greeting}, {firstNameOf(fullName)}
        </h2>
        <p className="mt-0.5 truncate text-xs text-text-muted">
          {subtitle ?? [departmentName, roleName].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ReportProblemButton />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2.5 rounded-full p-1 pr-2 transition-colors hover:bg-surface-bg"
          >
            {/* The avatar keeps the brand gradient: a small identity chip, not chrome. */}
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
              {initials}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-xs font-semibold leading-none text-brand-slate">
                {fullName}
              </span>
              <span className="mt-1 block text-[10px] leading-none text-text-muted">{roleName}</span>
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-text-muted transition-transform ${
                menuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-border-subtle bg-surface-card p-1.5 shadow-sm"
            >
              <div className="border-b border-border-subtle px-3 py-2">
                <p className="truncate text-xs font-semibold text-brand-slate">{fullName}</p>
                <p className="mt-0.5 truncate text-[10px] text-text-muted">{email}</p>
                <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                  {[departmentName, roleName].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button
                role="menuitem"
                onClick={signOut}
                disabled={signingOut}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/5 disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName
}

/** First and last initial, falling back to one letter for a single-word name. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}
