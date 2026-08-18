'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Plug,
  BadgeIndianRupee,
  FolderArchive,
  ShieldCheck,
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
  { href: '/discom/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/discom/net-metering', label: 'Net Metering', icon: Plug },
  { href: '/discom/subsidy', label: 'Subsidy', icon: BadgeIndianRupee },
  { href: '/discom/documents', label: 'Documents', icon: FolderArchive },
  { href: '/discom/verification', label: 'Verification', icon: ShieldCheck },
  { href: '/discom/my-tasks', label: 'My Tasks', icon: ListChecks },
]

export function DiscomSidebarNav({ isCeo }: { isCeo: boolean }) {
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
