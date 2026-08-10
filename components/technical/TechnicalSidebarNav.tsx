'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  MapPinned,
  PencilRuler,
  LifeBuoy,
  ListChecks,
  ArrowLeft,
} from 'lucide-react'
import {
  SIDEBAR_BODY,
  SIDEBAR_FOOTER_GROUP,
  navIconClass,
  navItemClass,
} from '@/components/shared/chrome'

const NAV = [
  { href: '/technical/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/technical/surveys', label: 'Site Surveys', icon: MapPinned },
  { href: '/technical/designs', label: 'Designs', icon: PencilRuler },
  { href: '/technical/it-support', label: 'IT Support', icon: LifeBuoy },
  { href: '/technical/my-tasks', label: 'My Tasks', icon: ListChecks },
]

/**
 * The one page someone from outside Technical has a reason to open: the tickets they
 * raised themselves, and where they stand.
 *
 * Filing a ticket no longer happens here — the Report button in every module header
 * does that from wherever the problem was found, which is the point. This page is
 * the other half of the org-wide exception: RLS lets a reporter SELECT their own
 * tickets, and without a page for it they would file into silence.
 */
const VISITOR_NAV = NAV.filter((item) => item.href === '/technical/it-support')

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
  const items = visitorOnly ? VISITOR_NAV : NAV

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
