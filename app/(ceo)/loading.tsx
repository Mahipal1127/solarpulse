import { PageSkeleton } from '@/components/ui/Skeleton'

/**
 * CEO content-area fallback. `stats` is on because every surface in this group leads with a KPI
 * row — the dashboard, analytics, and reports all open on tiles.
 */
export default function Loading() {
  return <PageSkeleton stats />
}
