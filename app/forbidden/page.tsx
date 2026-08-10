import Link from 'next/link'

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-brand-slate">Access denied</h1>
        <p className="mt-2 text-sm text-text-muted">
          This area is restricted to the CEO role. If you believe this is a mistake, contact your
          administrator.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  )
}
