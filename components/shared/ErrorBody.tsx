import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * The body shared by app/error.tsx and app/global-error.tsx. Two constraints drive keeping this
 * generic: (1) global-error runs without the app's global CSS, so the markup here re-asserts the
 * theme tokens inline rather than depending on Tailwind; (2) the only safe side-effects in an error
 * boundary are logging, so the "Try again" button just calls retry().
 *
 * If a real error tracker (Sentry etc.) is wired in later, `onActivate` is the hook — it receives
 * the error and digest and is the one place to call the tracker's capture method. Right now it
 * console.errors so operators at least see the digest in the platform logs.
 */

export function ErrorBody({
  error,
  onRetry,
}: {
  error: Error & { digest?: string }
  onRetry: () => void
}) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        backgroundColor: '#f6f7f9',
        color: '#1a2332',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '32rem',
          width: '100%',
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '1rem',
          padding: '2rem',
          textAlign: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '3rem',
            height: '3rem',
            borderRadius: '9999px',
            backgroundColor: '#fff3e0',
            color: '#b45309',
            marginBottom: '1rem',
          }}
          aria-hidden
        >
          <AlertTriangle size={20} />
        </div>

        <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p
          style={{
            fontSize: '0.875rem',
            color: '#6b7280',
            marginTop: '0.5rem',
            marginBottom: '1.5rem',
            lineHeight: 1.5,
          }}
        >
          The page hit an unexpected error. You can try again — if the problem keeps happening,
          please share the reference below with the team.
        </p>

        {error.digest && (
          <p
            style={{
              fontSize: '0.75rem',
              color: '#6b7280',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              marginBottom: '1.5rem',
            }}
          >
            Ref: {error.digest}
          </p>
        )}

        <button
          onClick={onRetry}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: '#f7c948',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.5rem',
            padding: '0.625rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={14} />
          Try again
        </button>
      </div>
    </main>
  )
}
