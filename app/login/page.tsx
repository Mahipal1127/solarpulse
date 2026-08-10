import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/LoginForm'
import { LogIn } from 'lucide-react'

export default function LoginPage() {
  return (
    <main className="login-bg-sky relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4 py-12">
      {/*
        Decorative arcs. Warm gold rather than white — the canvas behind them is
        off-white now, and white-on-off-white left them invisible.
      */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="h-[600px] w-[600px] rounded-full border border-brand-gold/20 sm:h-[800px] sm:w-[800px]" />
        <div className="absolute h-[850px] w-[850px] rounded-full border border-brand-gold/10 sm:h-[1100px] sm:w-[1100px]" />
        <div className="absolute top-1/4 h-[350px] w-[350px] rounded-full login-arc-1 blur-3xl opacity-70" />
      </div>

      {/* Glassmorphic Login Card */}
      <div className="relative z-10 w-full max-w-[420px] rounded-[2rem] login-card-glass p-8 sm:p-10 transition-all duration-300">
        {/* Top Header Icon */}
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-subtle bg-surface-card text-brand-slate">
          <LogIn className="h-6 w-6 stroke-[1.8]" />
        </div>

        {/* Title & Subtitle */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-brand-slate">Sign in with email</h1>
          <p className="mt-2 text-xs sm:text-sm text-text-muted leading-relaxed max-w-[300px] mx-auto">
            Make a new doc to bring your words, data, and teams together. For free
          </p>
        </div>

        <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-surface-bg" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}

