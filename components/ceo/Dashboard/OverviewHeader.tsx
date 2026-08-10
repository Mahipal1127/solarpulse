'use client'

import { useState } from 'react'
import { Search, HelpCircle, Bell, Download, ChevronDown, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ReportProblemButton } from '@/components/shared/ReportProblemButton'

export function OverviewHeader({ user }: { user: { full_name: string; email: string } }) {
  const [showMenu, setShowMenu] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const router = useRouter()

  async function handleSignOut() {
    setSigningOut(true)
    try {
      // Audit the logout BEFORE signing out so the session cookie is still valid
      await fetch('/api/auth/session', { method: 'DELETE' })
    } catch {
      // non-fatal — sign out regardless
    }
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <header className="flex flex-col gap-4 border-b border-border-subtle bg-surface-card px-8 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-brand-slate">Overview</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        {/* Search */}
        <div className="relative flex items-center">
          <Search className="absolute left-3.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search..."
            aria-label="Search"
            className="h-10 w-48 rounded-lg border border-border-subtle bg-surface-bg pl-10 pr-10 text-xs text-brand-slate transition-all placeholder:text-text-muted focus:w-60 focus:bg-surface-card sm:w-56"
          />
          <kbd className="absolute right-3 hidden rounded border border-border-subtle bg-surface-card px-1.5 py-0.5 text-[10px] font-medium text-text-muted sm:inline-block">
            ⌘K
          </kbd>
        </div>

        {/* Icons */}
        <div className="flex items-center gap-1.5">
          {/*
            The CEO module has its own header rather than the shared ModuleHeader, so
            the Report button has to be placed here too — otherwise the one person who
            cannot reach it is the one who most wants to know the ERP is broken.
            createITTicket() deliberately skips assertCanWrite(), and
            org_member_raise_it_ticket admits any authenticated member, so this is a
            write the CEO may genuinely make in a module they otherwise only read.
          */}
          <ReportProblemButton />
          <button
            aria-label="Help"
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-bg hover:text-brand-slate"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <button
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-bg hover:text-brand-slate"
          >
            <Bell className="h-4 w-4" />
            {/* The ring separates the dot from the bar behind it, so it matches the surface. */}
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-status-danger ring-2 ring-surface-card" />
          </button>
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2.5 rounded-full p-1 pr-2 transition-colors hover:bg-surface-bg"
          >
            {/* The avatar keeps the brand gradient: a small identity chip, not chrome. */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
              {user.full_name?.charAt(0) ?? 'C'}
            </div>
            <div className="hidden text-left md:block">
              <p className="text-xs font-semibold leading-none text-brand-slate">{user.full_name}</p>
              <p className="mt-0.5 text-[10px] leading-none text-text-muted">{user.email}</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
          </button>

          {showMenu && (
            <div className="absolute right-0 z-50 mt-2 w-48 rounded-lg border border-border-subtle bg-surface-card p-1.5 shadow-sm animate-in fade-in slide-in-from-top-2">
              <div className="border-b border-border-subtle px-3 py-2">
                <p className="text-xs font-semibold text-brand-slate">{user.full_name}</p>
                <p className="truncate text-[10px] text-text-muted">{user.email}</p>
              </div>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/5 disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>

        {/* Export */}
        <button
          onClick={() => alert('Exporting executive report PDF/CSV...')}
          /* The one genuine action on an otherwise read-only page, so it takes gold. */
          className="flex items-center gap-2 rounded-lg bg-brand-gold px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-orange active:scale-[0.98]"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
      </div>
    </header>
  )
}
