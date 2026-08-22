'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Lock, Eye, EyeOff } from 'lucide-react'

// Mirrors changePasswordSchema on the server. Kept local so this file has no server import.
const formSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })

type FormValues = z.infer<typeof formSchema>

/**
 * The forced first-login password change. The user is already authenticated (the proxy gate
 * bounced them here), so this only sets a new password and clears the flag server-side. On
 * success we send them to '/', which resolves to their role's home — the gate no longer fires.
 */
export function ChangePasswordForm() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) })

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })

    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string }
      setServerError(error ?? 'Could not update your password. Try again.')
      return
    }

    // Flag is cleared; '/' now resolves to the role home instead of bouncing back here.
    router.replace('/')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <div className="relative flex items-center rounded-2xl bg-surface-bg px-4 py-3.5 ring-1 ring-border-subtle transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-slate focus-within:shadow-sm">
          <Lock className="h-4 w-4 shrink-0 text-text-muted/60 mr-3" />
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="New password"
            autoComplete="new-password"
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

      <div>
        <div className="relative flex items-center rounded-2xl bg-surface-bg px-4 py-3.5 ring-1 ring-border-subtle transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-slate focus-within:shadow-sm">
          <Lock className="h-4 w-4 shrink-0 text-text-muted/60 mr-3" />
          <input
            id="confirm"
            type={showPassword ? 'text' : 'password'}
            placeholder="Confirm new password"
            autoComplete="new-password"
            {...register('confirm')}
            className="w-full bg-transparent text-sm text-brand-slate placeholder:text-text-muted/60 outline-none"
          />
        </div>
        {errors.confirm && (
          <p className="mt-1.5 px-3 text-xs font-medium text-status-danger">{errors.confirm.message}</p>
        )}
      </div>

      {serverError && (
        <p className="rounded-2xl bg-status-danger/5 px-4 py-2.5 text-xs font-medium text-status-danger border border-status-danger/15">
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-2xl bg-brand-gold px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-brand-orange active:scale-[0.99] disabled:opacity-60"
      >
        {isSubmitting ? 'Saving…' : 'Set password & continue'}
      </button>
    </form>
  )
}
