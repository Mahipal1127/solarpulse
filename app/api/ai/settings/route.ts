import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { errorResponse, badRequest } from '@/lib/api/responses'
import { PROVIDERS } from '@/lib/ai/provider'
import { z } from 'zod'
import type { AIProvider } from '@/lib/types'

const upsertSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  model: z.string().min(1),
  is_enabled: z.boolean(),
  daily_token_limit: z.number().int().positive().nullable().optional(),
  api_key: z.string().optional(),
})

export async function GET(_req: NextRequest) {
  try {
    const user = await requireRoleOrThrow('CEO')
    const supabase = await createSupabaseServerClient()

    const { data } = await supabase
      .from('ai_settings_public')
      .select('*')
      .eq('organization_id', user.organization_id)
      .maybeSingle()

    return NextResponse.json({ settings: data ?? null })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireRoleOrThrow('CEO')
    const body = await req.json()
    const parsed = upsertSchema.safeParse(body)
    if (!parsed.success) return badRequest('Invalid settings', parsed.error.flatten())

    const { provider, model, is_enabled, daily_token_limit, api_key } = parsed.data

    const providerDef = PROVIDERS[provider as AIProvider]
    if (!providerDef) return badRequest('Unknown provider')
    if (!providerDef.models.find((m) => m.id === model)) {
      return badRequest(`Model "${model}" is not available for ${providerDef.label}`)
    }

    const supabase = createSupabaseServiceClient()

    // Read existing row to get id for audit
    const { data: existing } = await supabase
      .from('ai_settings')
      .select('id')
      .eq('organization_id', user.organization_id)
      .maybeSingle()

    const payload: Record<string, unknown> = {
      organization_id: user.organization_id,
      provider,
      model,
      is_enabled,
      daily_token_limit: daily_token_limit ?? null,
      updated_by: user.id,
    }
    // Only overwrite the key column when the caller sends a non-empty string.
    // Sending nothing = preserve the existing key. Sending "" = clear it.
    if (api_key !== undefined) {
      payload.encrypted_api_key = api_key === '' ? null : api_key
    }

    const { error } = existing
      ? await supabase.from('ai_settings').update(payload).eq('id', existing.id)
      : await supabase.from('ai_settings').insert(payload)

    if (error) {
      console.error('[ai_settings] upsert failed', error)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'ai_settings.updated',
      entityType: 'ai_settings',
      metadata: {
        provider,
        model,
        is_enabled,
        key_changed: api_key !== undefined,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
