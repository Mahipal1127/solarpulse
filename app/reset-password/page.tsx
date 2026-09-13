import Link from 'next/link'
import { ResetPasswordWizard } from '@/components/auth/ResetPasswordWizard'
import { ShieldCheck } from 'lucide-react'

/**
 * The self-service password reset screen — reached from the login card's "Forgot password?"
 * link. PUBLIC by design: the whole point is helping someone who cannot sign in. Identity is
 * established inside the wizard (Employee ID + the attendance QR card), not by a session; the
 * proxy allowlists this route so the forced-change gate can never trap a user away from it.
 */
export default function ResetPasswordPage() {
  return (
    <main className="login-bg-sky relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4 py-12">
      {/*
        Decorative arcs, identical to the login and change-password screens — the three auth
        surfaces read as one family.
      */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="h-[600px] w-[600px] rounded-full border border-brand-gold/20 sm:h-[800px] sm:w-[800px]" />
        <div className="absolute h-[850px] w-[850px] rounded-full border border-brand-gold/10 sm:h-[1100px] sm:w-[1100px]" />
        <div className="absolute top-1/4 h-[350px] w-[350px] rounded-full login-arc-1 blur-3xl opacity-70" />
      </div>

      <div className="relative z-10 w-full max-w-[420px] rounded-[2rem] login-card-glass p-8 sm:p-10 transition-all duration-300">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-subtle bg-surface-card text-brand-slate">
          <ShieldCheck className="h-6 w-6 stroke-[1.8]" />
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-brand-slate">Reset your password</h1>
          <p className="mt-2 text-xs sm:text-sm text-text-muted leading-relaxed max-w-[300px] mx-auto">
            Verify your Employee ID and scan your attendance QR card, then choose a new password.
          </p>
        </div>

        <ResetPasswordWizard />

        <p className="mt-6 text-center text-xs text-text-muted">
          Remembered it after all?{' '}
          <Link href="/login" className="font-medium text-brand-slate hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}