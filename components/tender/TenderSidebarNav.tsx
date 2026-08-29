'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  Gavel,
  ScrollText,
  ArrowLeft,
} from 'lucide-react'
import {
  SIDEBAR_BODY,
  SIDEBAR_FOOTER_GROUP,
  navIconClass,
  navItemClass,
} from '@/components/shared/chrome'

/*
 * Overview first, and it takes the LayoutDashboard glyph that My Tasks used to
 * carry. That icon on a personal task list was the clearest sign this module was
 * missing a dashboard: the nav promised an overview and led to an inbox. My Tasks
 * keeps its place but now reads as what it is, one person's work inside a
 * department board.
 */
const NAV = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/my-tasks', label: 'My Tasks', icon: ClipboardList },
  // Beside My Tasks: both are one person's own work rather than the department's
  // queues. No /tender prefix — this module lives in a route group, exactly as the
  // /my-tasks href directly above does.
  { href: '/my-reports', label: 'My Reports', icon: ScrollText },
  { href: '/tenders', label: 'Tenders', icon: FileText },
  { href: '/bids', label: 'Bids', icon: Gavel },
]

export function TenderSidebarNav({ isCeo }: { isCeo: boolean }) {
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
