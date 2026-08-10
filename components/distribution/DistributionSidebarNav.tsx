'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Store,
  FileText,
  Truck,
  PackageCheck,
  Undo2,
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
  { href: '/distribution/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/distribution/vendors', label: 'Vendors', icon: Store },
  { href: '/distribution/purchase-orders', label: 'Purchase Orders', icon: FileText },
  { href: '/distribution/allocations', label: 'Allocations', icon: PackageCheck },
  { href: '/distribution/dispatches', label: 'Dispatches', icon: Truck },
  { href: '/distribution/returns', label: 'Returns', icon: Undo2 },
  { href: '/distribution/my-tasks', label: 'My Tasks', icon: ListChecks },
]

/** The only thing a Finance visitor comes here to do. */
const APPROVER_NAV = NAV.filter((item) => item.href === '/distribution/purchase-orders')

export function DistributionSidebarNav({
  isCeo,
  /**
   * Finance, who may approve a purchase order but has no business in the rest of
   * the module. Trimming the nav is courtesy, not enforcement — each page
   * re-guards, and RLS gives Finance nothing outside purchase orders to read.
   */
  approverOnly = false,
}: {
  isCeo: boolean
  approverOnly?: boolean
}) {
  const pathname = usePathname()
  const items = approverOnly ? APPROVER_NAV : NAV

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
