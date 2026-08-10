'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    // Logged server-side before the session is torn down, otherwise the audit
    // write has no authenticated user to attribute.
    await fetch('/api/auth/session', { method: 'DELETE' })
    await createClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <button
      onClick={signOut}
      disabled={pending}
      className="w-full rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-muted transition hover:bg-surface-bg disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
