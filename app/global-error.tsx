'use client'

import { ErrorBody } from '@/components/shared/ErrorBody'

/**
 * The very last line of defence — fires when the root layout itself errors and a segment-level
 * boundary would have nothing to wrap. Per the Next 16 convention (docs/.../error.md), this file
 * REPLACES the root layout and must therefore include its own <html> and <body> tags; the app's
 * globals.css and theme classes are NOT applied here. That's why ErrorBody inlines its theme —
 * Tailwind classes would render as plain class names with no styles.
 *
 * The useEffect for logging is intentionally absent: by definition the app shell has failed, and
 * any client-side SDK that lives in layout context is unreachable. Operators correlate the digest
 * through server-side platform logs.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="en">
      <body>
        <ErrorBody error={error} onRetry={retry} />
      </body>
    </html>
  )
}
