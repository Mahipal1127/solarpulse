import { PageSkeleton } from '@/components/ui/Skeleton'

/**
 * HR content-area fallback. Renders inside the HR layout, so the sidebar and header stay put and
 * stay interactive while the page's queries run.
 */
export default function Loading() {
  return <PageSkeleton />
}
