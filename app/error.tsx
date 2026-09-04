'use client'

import { useEffect } from 'react'
import { ErrorBody } from '@/components/shared/ErrorBody'

/**
 * Segment-level error boundary. Wraps every route segment below `app/` and renders the branded
 * fallback if a page, layout, or client component throws. A `retry` button re-renders the
 * segment — useful for transient failures (a flaky RPC, a temporarily unhealthy dependency).
 *
 * The only side-effect on activate is console.error with the digest. Wire a real error tracker
 * (Sentry etc.) by adding the SDK call inside this useEffect — `error.digest` is the safe
 * correlation key the server logs carry.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // Server-side errors land here with a sanitised message; the digest ties this client render
    // back to the server-side stack the platform logged. Both together let operators correlate.
    console.error('[app] render error', { digest: error.digest, message: error.message })
  }, [error])

  return <ErrorBody error={error} onRetry={retry} />
}
