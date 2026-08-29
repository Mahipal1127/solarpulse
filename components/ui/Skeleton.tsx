/**
 * Loading skeletons for the route-level loading.tsx boundaries.
 *
 * WHY THESE EXIST. Every page in this app is `dynamic = 'force-dynamic'` — correct for an
 * RLS-scoped multi-tenant ERP, where a cached page is a cross-tenant leak waiting to happen. The
 * cost is that nothing can be served until the server has finished the whole render: the proxy's
 * session check, the layout guard, the page guard, then the page's own queries. Without a Suspense
 * boundary the browser paints none of that progress, so a click leaves the OLD screen sitting there
 * and the app reads as broken rather than busy.
 *
 * A loading.tsx per module turns that dead time into an immediate response. It also makes <Link>
 * prefetch worth something on dynamic routes: the fallback is prerenderable, so Next can have the
 * skeleton ready before the click.
 *
 * Deliberately plain markup — no images, no client JS, no data. A fallback that has to fetch
 * anything to render is not a fallback.
 */

/** One shimmering grey block. Sized entirely by the caller. */
export function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-border-subtle ${className}`} aria-hidden />
}

/**
 * A stand-in for one Card: header strip, then `rows` list rows separated the way the real
 * divide-y lists are, so the fallback and the loaded page have the same rhythm.
 */
export function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card">
      <div className="border-b border-border-subtle px-5 py-4">
        <SkeletonBar className="h-4 w-40" />
        <SkeletonBar className="mt-2 h-3 w-64" />
      </div>
      <div className="divide-y divide-border-subtle">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <SkeletonBar className="h-3.5 w-48" />
              <SkeletonBar className="mt-2 h-3 w-32" />
            </div>
            <SkeletonBar className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A row of stat tiles, for the dashboards that lead with KPIs. */
export function SkeletonStats({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="rounded-2xl border border-border-subtle bg-surface-card px-5 py-4">
          <SkeletonBar className="h-3 w-24" />
          <SkeletonBar className="mt-3 h-7 w-20" />
        </div>
      ))}
    </div>
  )
}

/**
 * The content-area fallback: what a module's loading.tsx renders. It sits INSIDE the module layout,
 * so the sidebar and header stay on screen and interactive while this shows — the whole point of
 * putting the boundary here rather than at the root.
 *
 * Matches the `space-y-6 p-6` wrapper every page in this app uses, so the skeleton occupies the same
 * space as the content that replaces it and the page does not jump on arrival.
 */
export function PageSkeleton({ stats = false, cards = 2 }: { stats?: boolean; cards?: number }) {
  return (
    <div className="space-y-6 p-6">
      <header>
        <SkeletonBar className="h-6 w-52" />
        <SkeletonBar className="mt-2 h-3.5 w-80" />
      </header>

      {stats && <SkeletonStats />}

      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} rows={i === 0 ? 5 : 3} />
      ))}
    </div>
  )
}

/**
 * The whole-app fallback for the root boundary, used when navigation crosses INTO a module whose
 * layout has not rendered yet (Finance → HR, say). At that point the module's own loading.tsx cannot
 * help: its layout is the thing still awaiting its guard. So this draws the shell itself — an empty
 * sidebar column and a header strip — which keeps the app's shape on screen instead of a white page.
 */
export function AppShellSkeleton() {
  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-5 py-4">
          <SkeletonBar className="h-6 w-36" />
          <SkeletonBar className="mt-2 h-3 w-20" />
        </div>
        <div className="space-y-1.5 px-3 py-4">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonBar key={i} className="h-9 w-full rounded-xl" />
          ))}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden bg-surface-bg">
        <div className="flex items-center justify-between gap-4 border-b border-border-subtle bg-surface-card px-6 py-3.5">
          <div>
            <SkeletonBar className="h-4 w-44" />
            <SkeletonBar className="mt-2 h-3 w-28" />
          </div>
          <SkeletonBar className="h-9 w-9 rounded-full" />
        </div>
        <PageSkeleton stats />
      </main>
    </div>
  )
}
