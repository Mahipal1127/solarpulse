'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  CalendarDays,
  Megaphone,
  Sparkles,
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
  { href: '/marketing/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/marketing/content-calendar', label: 'Content Calendar', icon: CalendarDays },
  { href: '/marketing/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/marketing/insights', label: 'AI Insights', icon: Sparkles },
  { href: '/marketing/my-tasks', label: 'My Tasks', icon: ListChecks },
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
