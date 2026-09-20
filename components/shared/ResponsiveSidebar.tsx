'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

type SidebarDrawerState = { open: boolean; setOpen: (open: boolean) => void } | null

const SidebarDrawerContext = createContext<SidebarDrawerState>(null)

/**
 * The drawer state, read by the hamburger in the top bar. Null on surfaces
 * with no module sidebar (/me, the kiosk) — callers then render no toggle.
 */
export function useSidebarDrawer(): SidebarDrawerState {
  return useContext(SidebarDrawerContext)
}

/**
 * The hamburger that opens the drawer. Rendered at the head of every module's
 * top bar; draws nothing where there is no drawer behind it. Hidden from `lg`
 * up, where the real sidebar column is on screen anyway.
 */
export function SidebarDrawerToggle() {
  const drawer = useSidebarDrawer()
  if (!drawer) return null
  return (
    <button
      type="button"
      onClick={() => drawer.setOpen(true)}
      aria-label="Open navigation"
      aria-expanded={drawer.open}
      className="-ml-1 rounded-lg p-1.5 text-brand-slate transition-colors hover:bg-surface-bg lg:hidden"
    >
      <Menu className="h-5 w-5" />
    </button>
  )
}

/**
 * The module shell. From `lg` up this is exactly the sidebar column every
 * module has always had. Below it, the same sidebar becomes an off-canvas
 * drawer behind a scrim, opened by the top bar's hamburger — the phone gets
 * the full screen for content and the navigation slides over it.
 *
 * `sidebar` is a server-rendered node (brand + nav + whatever else the module
 * pins to its rail) passed through and rendered into both the desktop column
 * and the drawer, so the two can never drift.
 */
export function ResponsiveSidebar({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  // "Open" is derived from the pathname rather than set from an effect:
  // opening records the path it was opened on, and any navigation — a different
  // pathname — closes the drawer by construction. A phone should not sit on an
  // open menu after the navigation has already happened, and this way closing
  // needs no effect and cannot race one.
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  // The drawer mounts lazily — on first open, not on first render. Desktop
  // users never open it, and the sidebar's interactive children (the nav, the
  // notification bell, the account menu) must not live in two mounted copies.
  // Marked inside the open handler, so no effect body needs a setState.
  const [everOpened, setEverOpened] = useState(false)
  const pathname = usePathname()

  const open = drawerPath !== null && drawerPath === pathname

  function setOpen(next: boolean) {
    setDrawerPath(next ? pathname : null)
    if (next) setEverOpened(true)
  }

  // Escape closes; the page behind the scrim does not scroll underneath it.
  // The close calls the stable setter directly, so the effect's dependencies
  // stay exactly [open].
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerPath(null)
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <SidebarDrawerContext.Provider value={{ open, setOpen }}>
      <div className="flex h-full">
        <aside className={`${SIDEBAR_SHELL} hidden lg:flex`}>{sidebar}</aside>

        {everOpened && (
          <div
            className={`fixed inset-0 z-50 lg:hidden ${open ? '' : 'pointer-events-none'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Module navigation"
          >
            <div
              onClick={() => setOpen(false)}
              className={`absolute inset-0 bg-brand-slate/50 transition-opacity duration-200 ${
                open ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <aside
              className={`${SIDEBAR_SHELL} absolute inset-y-0 left-0 shadow-lg transition-transform duration-200 ${
                open ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              {sidebar}
            </aside>
          </div>
        )}

        {children}
      </div>
    </SidebarDrawerContext.Provider>
  )
}