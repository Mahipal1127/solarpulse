import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

/**
 * The branded 404 page. Replaces the bare Next default with a "page not found" experience that
 * offers a way back to the dashboard. A server component — there's no client interaction to
 * justify the boundary cost.
 *
 * Authenticated users land here when they hit a deep link that does not exist; the home
 * redirect uses lib/auth/home-route to land them on the correct module, which is the one route
 * we can guarantee they have access to.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-surface-bg p-6">
      <div className="max-w-md rounded-2xl border border-border-subtle bg-surface-card px-8 py-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-status-warning/10 text-status-warning">
          <FileQuestion className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-brand-slate">Page not found</h1>
        <p className="mt-2 text-sm text-text-muted">
          The link you followed may be broken, or the page may have been moved. You can return to
          your dashboard below.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
