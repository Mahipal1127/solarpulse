'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutGrid,
  CheckSquare,
  ClipboardCheck,
  Building2,
  LineChart,
  Sparkles,
  Settings,
  HelpCircle,
} from 'lucide-react'
import {
  SIDEBAR_BODY,
  SIDEBAR_FOOTER_GROUP,
  navIconClass,
  navItemClass,
} from '@/components/shared/chrome'

const PRIMARY_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/approvals', label: 'Approvals', icon: ClipboardCheck },
  { href: '/departments', label: 'Departments', icon: Building2 },
  { href: '/analytics', label: 'Analytics', icon: LineChart },
  { href: '/ai', label: 'AI Assistant', icon: Sparkles },
]

const BOTTOM_NAV = [
  { href: '/ai/settings', label: 'AI Settings', icon: Settings },
  { href: '#', label: 'Help', icon: HelpCircle },
]

export function SidebarNav() {
  const pathname = usePathname()

  const renderItem = (item: { href: string; label: string; icon: any }) => {
    const Icon = item.icon
    const active =
      item.href === '#'
        ? false
        : item.href === '/ai'
        ? pathname === '/ai'
        : pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}`))

    return (
      <Link key={item.label} href={item.href} className={navItemClass(active)}>
        <Icon className={navIconClass(active)} />
        <span>{item.label}</span>
      </Link>
    )
  }

  return (
    <div className={SIDEBAR_BODY}>
      <nav className="space-y-1">{PRIMARY_NAV.map(renderItem)}</nav>

      <div className={SIDEBAR_FOOTER_GROUP}>{BOTTOM_NAV.map(renderItem)}</div>
    </div>
  )
}
