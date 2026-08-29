import { AppShellSkeleton } from '@/components/ui/Skeleton'

/**
 * Root loading boundary — the fallback for navigation that crosses into a module whose layout has
 * not rendered yet (Finance → HR, or any first load). The module's own loading.tsx cannot cover that
 * case, because the thing still being awaited IS its layout guard.
 *
 * Draws the shell rather than a spinner so the app keeps its shape while the server works.
 */
export default function Loading() {
  return <AppShellSkeleton />
}
