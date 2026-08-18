'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileText,
  ShoppingCart,
  Stamp,
  Receipt,
  PiggyBank,
  ArrowLeftRight,
  Landmark,
  BookOpen,
  AlertCircle,
  BarChart3,
  ListChecks,
  ArrowLeft,
} from 'lucide-react'
import {
  SIDEBAR_BODY,
  SIDEBAR_FOOTER_GROUP,
  navIconClass,
  navItemClass,
} from '@/components/shared/chrome'

/**
 * Finance sidebar. Reports (P&L / Balance Sheet) is the sensitive, lead/CEO-only surface —
 * shown only when isLead, and the page behind it gates again (a plain Finance Executive who
 * navigates in directly sees an access notice, not data). The nav is a map, not the
 * permission boundary; RLS and the service layer are.
 */
const NAV_BASE = [
  { href: '/finance/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/finance/invoices', label: 'Invoices', icon: FileText },
  { href: '/finance/purchases', label: 'Purchases', icon: ShoppingCart },
  { href: '/finance/approvals', label: 'Approvals', icon: Stamp },
  { href: '/finance/expenses', label: 'Expenses', icon: Receipt },
  { href: '/finance/budgets', label: 'Budgets', icon: PiggyBank },
  { href: '/finance/cash-flow', label: 'Cash Flow', icon: ArrowLeftRight },
  { href: '/finance/tax', label: 'Tax', icon: Landmark },
  { href: '/finance/ledger', label: 'Ledger', icon: BookOpen },
  { href: '/finance/outstanding', label: 'Outstanding', icon: AlertCircle },
]

const NAV_SENSITIVE = [{ href: '/finance/reports', label: 'Reports', icon: BarChart3 }]

const NAV_TAIL = [{ href: '/finance/my-tasks', label: 'My Tasks', icon: ListChecks }]

export function FinanceSidebarNav({ isCeo, isLead }: { isCeo: boolean; isLead: boolean }) {
  const pathname = usePathname()
  const items = [...NAV_BASE, ...(isLead ? NAV_SENSITIVE : []), ...NAV_TAIL]

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
