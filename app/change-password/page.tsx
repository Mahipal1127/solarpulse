import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/guards'
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm'
import { KeyRound } from 'lucide-react'

/**
 * The forced first-login password change screen. The proxy gate redirects any onboarded employee
 * here until must_change_password is cleared. An unauthenticated visitor is sent to /login (the
 * gate never redirects anon users here, but a direct visit still needs to be handled). We do NOT
 * bounce a user whose flag is already false — reaching this page voluntarily to rotate a password
 * is legitimate; the form works the same either way.
 */
export default async function ChangePasswordPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <main className="login-bg-sky relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="h-[600px] w-[600px] rounded-full border border-brand-gold/20 sm:h-[800px] sm:w-[800px]" />
        <div className="absolute h-[850px] w-[850px] rounded-full border border-brand-gold/10 sm:h-[1100px] sm:w-[1100px]" />
        <div className="absolute top-1/4 h-[350px] w-[350px] rounded-full login-arc-1 blur-3xl opacity-70" />
      </div>

      <div className="relative z-10 w-full max-w-[420px] rounded-[2rem] login-card-glass p-8 sm:p-10 transition-all duration-300">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-subtle bg-surface-card text-brand-slate">
          <KeyRound className="h-6 w-6 stroke-[1.8]" />
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-brand-slate">Set your password</h1>
          <p className="mt-2 text-xs sm:text-sm text-text-muted leading-relaxed max-w-[300px] mx-auto">
            Your account was created with a temporary password. Choose a new one to continue to your
            workspace.
          </p>
        </div>

        <ChangePasswordForm />
      </div>
    </main>
  )
}
