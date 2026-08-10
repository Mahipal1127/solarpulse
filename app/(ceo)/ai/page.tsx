import 'server-only'

import { requireRole } from '@/lib/auth/guards'
import { AIChat } from '@/components/ceo/AIChat/AIChat'
import { Card } from '@/components/ui/primitives'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { AISettingsPublic } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function AIChatPage() {
  const user = await requireRole('CEO')
  const supabase = await createSupabaseServerClient()

  const { data: settingsRaw } = await supabase
    .from('ai_settings_public')
    .select('is_enabled, has_api_key, provider, model')
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  const settings = settingsRaw as Pick<
    AISettingsPublic,
    'is_enabled' | 'has_api_key' | 'provider' | 'model'
  > | null

  const isReady = settings?.is_enabled && settings?.has_api_key

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">AI Assistant</h1>
          <p className="text-sm text-slate-500">
            Ask questions or request actions. All actions require explicit confirmation.
          </p>
        </div>
        <Link
          href="/ai/settings"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          AI Settings
        </Link>
      </div>

      {!isReady ? (
        <Card className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
          {!settings ? (
            <>
              <p className="text-sm font-medium text-slate-700">AI assistant is not configured.</p>
              <p className="text-xs text-slate-500">
                Visit{' '}
                <Link href="/ai/settings" className="text-indigo-600 underline">
                  AI Settings
                </Link>{' '}
                to add an API key and enable the assistant.
              </p>
            </>
          ) : !settings.has_api_key ? (
            <>
              <p className="text-sm font-medium text-slate-700">No API key configured.</p>
              <p className="text-xs text-slate-500">
                Add an API key in{' '}
                <Link href="/ai/settings" className="text-indigo-600 underline">
                  AI Settings
                </Link>{' '}
                to enable the assistant.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700">AI assistant is disabled.</p>
              <p className="text-xs text-slate-500">
                Enable it in{' '}
                <Link href="/ai/settings" className="text-indigo-600 underline">
                  AI Settings
                </Link>
                .
              </p>
            </>
          )}
        </Card>
      ) : (
        <Card className="flex flex-1 overflow-hidden">
          <AIChat />
        </Card>
      )}
    </div>
  )
}
