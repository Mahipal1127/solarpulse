import { PageSkeleton } from '@/components/ui/Skeleton'

/** Personal surfaces (/me/*) content-area fallback — see components/ui/Skeleton.tsx. */
export default function Loading() {
  return <PageSkeleton cards={1} />
}
