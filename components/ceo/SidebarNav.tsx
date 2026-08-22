'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutGrid,
  CheckSquare,
  ClipboardCheck,
  FileText,
  Building2,
  Users,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SIDEBAR_BODY, navIconClass, navItemClass } from '@/components/shared/chrome'

/*
 * THE LABELS DO NOT MATCH THE PATHS, ON PURPOSE
 * "Dashboard" points at /analytics and "Pulse AI" points at /dashboard. That reads
 * like a mistake and is not one: the two surfaces swapped names, not URLs. /dashboard
 * has been the assistant since the metrics moved out of it, and /analytics has been
 * the numbers page — so the paths already described the old naming and renaming them
 * would mean touching the /ceo/dashboard rewrite in next.config.ts, the CEO's entry in
 * lib/auth/home-route.ts, every "Back to CEO" link and any bookmark a user already has.
 * Cheaper and safer to let the labels move and say so here.
 *
 * Numbers come first now. The assistant is the more distinctive surface but the less
 * frequent errand: a CEO opening the app wants the state of the business, and asks a
 * question second. Pulse AI sits directly beneath it so it is still the first thing
 * reachable after the overview.
 *
 * "AI Assistant" was deliberately absent from this nav for a while, on the grounds that
 * the assistant was docked on the dashboard next to the numbers it discussed. That
 * stopped being true when the metrics left, so it has a nav entry again — it is now a
 * destination in its own right rather than a panel on another page.
 */
const PRIMARY_NAV = [
  { href: '/analytics', label: 'Dashboard', icon: LayoutGrid },
  { href: '/dashboard', label: 'Pulse AI', icon: Sparkles },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/approvals', label: 'Approvals', icon: ClipboardCheck },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/departments', label: 'Departments', icon: Building2 },
  { href: '/employees', label: 'Employees', icon: Users },
]

/*
 * There is no footer group here any more. It held AI Settings and Help, both of which
 * now live in the account menu below (components/ceo/UserMenu.tsx) — they configure the
 * tool and the account rather than naming a part of the business, which is what this
 * nav is for. Keeping them in both places would give one action two homes and let the
 * two drift.
 */

export function SidebarNav() {
  const pathname = usePathname()

  const renderItem = (item: { href: string; label: string; icon: LucideIcon }) => {
    const Icon = item.icon
    /*
     * Prefix matching so a detail page keeps its section lit (/tasks/abc → Tasks),
     * except /dashboard, which would otherwise match every route.
     *
     * Every href here is a real route now — the `#` placeholder that Help used to
     * carry, and the special case that stopped it from ever lighting up, are both gone.
     */
    const active =
      pathname === item.href ||
      (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`))

    return (
      <Link key={item.label} href={item.href} className={navItemClass(active)}>
        <Icon className={navIconClass(active)} />
        <span>{item.label}</span>
      </Link>
    )
  }

  return (
    <nav className={SIDEBAR_BODY}>
      <div className="space-y-1">{PRIMARY_NAV.map(renderItem)}</div>
    </nav>
  )
}
