import { requireRole } from '@/lib/auth/guards'
import { SidebarNav } from '@/components/ceo/SidebarNav'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { UserMenu } from '@/components/ceo/UserMenu'
import { NotificationBell } from '@/components/shared/NotificationBell'
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
        {/*
          The CEO area has no top bar (see the content-column note below), so the notification bell
          lives at the foot of the sidebar, just above the account menu. Its panel opens upward and
          rightward into the content area — the sidebar column is too narrow to hold it. A short
          label sits beside the icon so it doesn't read as an orphaned glyph in the rail.
        */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-4 py-2">
          <NotificationBell placement="sidebar" />
          <span className="text-xs font-medium text-text-muted">Notifications</span>
        </div>
        <UserMenu user={{ full_name: user.full_name, email: user.email }} />
      </aside>

      {/* The content column owns no chrome now — pages render straight into it. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-bg">
        {children}
      </main>
    </div>
  )
}
