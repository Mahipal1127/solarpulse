import { requireRole } from '@/lib/auth/guards'
import { SidebarNav } from '@/components/ceo/SidebarNav'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { UserMenu } from '@/components/ceo/UserMenu'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

export default async function CeoLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('CEO')

  return (
    <div className="flex h-full">
      {/*
        Logo, navigation, then the account menu pinned at the foot.

        UserMenu is a sibling of SidebarNav rather than living inside it: that component
        renders SIDEBAR_BODY, which is `overflow-y-auto`, and a scroll container clips
        the absolutely-positioned dropdown instead of letting it float.
      */}
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand />
        <SidebarNav />
        <UserMenu user={{ full_name: user.full_name, email: user.email }} />
      </aside>

      {/* The content column owns no chrome now — pages render straight into it. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-bg">
        {children}
      </main>
    </div>
  )
}
