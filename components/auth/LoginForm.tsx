'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: LoginValues) {
    setServerError(null)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    })

    if (error) {
      setServerError('Invalid email or password.')
      return
    }

    // Records the login in audit_logs + sessions_meta server-side, and tells us
    // where this role belongs — /dashboard is CEO-only, so a department user
    // sent there would land on /forbidden.
    const res = await fetch('/api/auth/session', { method: 'POST' })
    const { home } = (await res.json().catch(() => ({}))) as { home?: string }

    router.replace(searchParams.get('next') ?? home ?? '/')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Email Input */}
      <div>
        <div className="relative flex items-center rounded-2xl bg-surface-bg px-4 py-3.5 ring-1 ring-border-subtle transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-slate focus-within:shadow-sm">
          <Mail className="h-4 w-4 shrink-0 text-text-muted/60 mr-3" />
          <input
            id="email"
            type="email"
            placeholder="Email"
            autoComplete="email"
            {...register('email')}
            className="w-full bg-transparent text-sm text-brand-slate placeholder:text-text-muted/60 outline-none"
          />
        </div>
        {errors.email && <p className="mt-1.5 px-3 text-xs font-medium text-status-danger">{errors.email.message}</p>}
      </div>

      {/* Password Input */}
      <div>
        <div className="relative flex items-center rounded-2xl bg-surface-bg px-4 py-3.5 ring-1 ring-border-subtle transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-slate focus-within:shadow-sm">
          <Lock className="h-4 w-4 shrink-0 text-text-muted/60 mr-3" />
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            autoComplete="current-password"
            {...register('password')}
            className="w-full bg-transparent text-sm text-brand-slate placeholder:text-text-muted/60 outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="shrink-0 text-text-muted/60 hover:text-text-muted transition"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password && (
          <p className="mt-1.5 px-3 text-xs font-medium text-status-danger">{errors.password.message}</p>
        )}
      </div>

      {/* Forgot Password Link */}
      <div className="flex justify-end pt-0.5 pb-2">
        <a
          href="#forgot-password"
          onClick={(e) => {
            e.preventDefault()
            alert('Password reset link sent to registered administrator.')
          }}
          className="text-xs font-medium text-text-muted hover:text-brand-slate transition"
        >
          Forgot password?
        </a>
      </div>

      {serverError && (
        <p className="rounded-2xl bg-status-danger/5 px-4 py-2.5 text-xs font-medium text-status-danger border border-status-danger/15">{serverError}</p>
      )}

      {/*
        Gold, like every other primary action in the app. This was a hardcoded
        near-black (#18181b) — the last dark background in the build after the
        light-chrome pass, and the first button anyone sees. Radius stays 2xl to
        match the inputs directly above it on this screen; the drop shadow is gone,
        since shadows are reserved for things that genuinely float (modals,
        dropdowns) and a submit button welded to a form is not one.
      */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-2xl bg-brand-gold px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-brand-orange active:scale-[0.99] disabled:opacity-60"
      >
        {isSubmitting ? 'Signing in…' : 'Get Started'}
      </button>
    </form>
  )
}

