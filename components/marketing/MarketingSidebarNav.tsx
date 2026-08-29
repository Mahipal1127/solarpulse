'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  CalendarDays,
  Megaphone,
  Sparkles,
  Wand2,
  ListChecks,
  ScrollText,
  ArrowLeft,
} from 'lucide-react'
import {
  SIDEBAR_BODY,
  SIDEBAR_FOOTER_GROUP,
  navIconClass,
  navItemClass,
} from '@/components/shared/chrome'

/**
 * Every Marketing surface, in the sidebar.
 *
 * Marketing is still a single-master-dashboard module — Dashboard is the one overview and
 * there is no second competing dashboard. What changed is WHERE the other surfaces are
 * listed: here, rather than in a tab strip under the header. A sidebar holding nothing but
 * a lone Dashboard link reads as a half-loaded page, and the strip put the module's whole
 * navigation in the one place people do not look for navigation.
 *
 * Still listed exactly once. Adding these here while keeping the strip would be the same
 * duplication the strip was introduced to remove.
 */
const NAV = [
  { href: '/marketing/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/marketing/content-calendar', label: 'Content Calendar', icon: CalendarDays },
  { href: '/marketing/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/marketing/insights', label: 'AI Insights', icon: Sparkles },
  { href: '/marketing/ai-creative', label: 'AI Creative', icon: Wand2 },
  // Last, and together: both are this person's own work rather than the department's
  // queues. My Reports is NOT the header's Report button, which raises an IT ticket.
  { href: '/marketing/my-tasks', label: 'My Tasks', icon: ListChecks },
  { href: '/marketing/my-reports', label: 'My Reports', icon: ScrollText },
]

export function MarketingSidebarNav({ isCeo }: { isCeo: boolean }) {
  const pathname = usePathname()

  return (
    <div className={SIDEBAR_BODY}>
      <nav className="space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link key={item.href} href={item.href} className={navItemClass(active)}>
              <Icon className={navIconClass(active)} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {isCeo && (
        <div className={SIDEBAR_FOOTER_GROUP}>
          <Link href="/departments" className={navItemClass(false)}>
            <ArrowLeft className={navIconClass(false)} />
            <span>Back to CEO</span>
          </Link>
        </div>
      )}
    </div>
  )
}
