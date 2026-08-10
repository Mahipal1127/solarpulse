import { requireRole } from '@/lib/auth/guards'
import { SidebarNav } from '@/components/ceo/SidebarNav'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

export default async function CeoLayout({ children }: { children: React.ReactNode }) {
  await requireRole('CEO')

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand />
        <SidebarNav />
      </aside>

      {/* Main content — scrolls independently */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">{children}</main>
    </div>
  )
}
