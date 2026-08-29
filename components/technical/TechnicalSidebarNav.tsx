'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  MapPin,
  DraftingCompass,
  LifeBuoy,
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
 * Every Technical surface, in the sidebar.
 *
 * Technical is still a single-master-dashboard module: Dashboard is the one overview and
 * there is no second competing dashboard. What changed is WHERE the other surfaces are
 * listed: here, rather than in a tab strip under the header. A sidebar holding nothing but
 * a lone Dashboard link reads as a half-loaded page.
 */
const MEMBER_NAV = [
  { href: '/technical/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/technical/surveys', label: 'Site Surveys', icon: MapPin },
  { href: '/technical/designs', label: 'Designs', icon: DraftingCompass },
  { href: '/technical/it-support', label: 'IT Support', icon: LifeBuoy },
  // Last, and together: both are this person's own work rather than the department's
  // queues. My Reports is NOT the header's Report button — that raises an IT support
  // ticket and is org-wide. Two different things, kept apart on purpose so nobody files
  // a work report into the ticket queue.
  { href: '/technical/my-tasks', label: 'My Tasks', icon: ListChecks },
  { href: '/technical/my-reports', label: 'My Reports', icon: ScrollText },
]

/**
 * The one page someone from outside Technical has a reason to open: the tickets they
 * raised themselves, and where they stand.
 *
 * A visitor gets IT Support as their only sidebar entry rather than Dashboard, because
 * every other surface re-guards to Technical and would redirect them — offering the full
 * list would be offering five dead ends. This is the other half of the org-wide exception:
 * RLS lets a reporter SELECT their own tickets, and without a page for it they would file
 * into silence. Filing itself happens from the Report button in any module header.
 *
 * Filtered from MEMBER_NAV rather than written out, the same way Distribution derives its
 * Finance-approver nav: one list stays the single source of the href and the label, so a
 * rename cannot leave the visitor pointing at a route that moved.
 */
const VISITOR_NAV = MEMBER_NAV.filter((item) => item.href === '/technical/it-support')

export function TechnicalSidebarNav({
  isCeo,
  /**
   * Someone from another department — Sales following up on the broken login they
   * reported. Trimming the nav is courtesy, not enforcement: every page except IT
   * Support re-guards to Technical, and RLS gives a visitor nothing but the tickets
   * they raised themselves.
   */
  visitorOnly = false,
}: {
  isCeo: boolean
  visitorOnly?: boolean
}) {
  const pathname = usePathname()
  const items = visitorOnly ? VISITOR_NAV : MEMBER_NAV

  return (
    <div className={SIDEBAR_BODY}>
      <nav className="space-y-1">
        {items.map((item) => {
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
