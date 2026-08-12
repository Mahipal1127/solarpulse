import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { errorResponse, badRequest } from '@/lib/api/responses'
import { PROVIDERS } from '@/lib/ai/provider'
import { normalizeBaseUrl, BaseUrlError } from '@/lib/ai/baseUrl'
import { allowLocalBaseUrl } from '@/lib/ai/env'
import { z } from 'zod'
import type { AIProvider } from '@/lib/types'

/**
 * CEO-only AI configuration.
 *
 * WHAT THIS ROUTE VALIDATES, AND WHAT IT DELIBERATELY DOES NOT
 * It validates the provider (a closed enum, because it selects a code path), and
 * the base URL (because the server then makes an outbound request to it — see
 * lib/ai/baseUrl.ts).
 *
 * It does NOT validate the model id against the registry any more. The old version
 * did, which meant a model released after the registry was last edited could not be
 * selected until someone changed code and redeployed — and it made gateways
 * unusable, since their ids are arbitrary (`anthropic/claude-opus-4.6`, or whatever
 * an operator named a local vLLM route). A wrong id now comes back from the
 * provider as a 404 that names what it expected, which is a better error than this
 * app insisting a real model does not exist.
 */

const upsertSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'compatible']),
  /*
   * Free text, length-bounded only. 200 is far above any real model id and stops
   * the column being used as scratch storage.
   */
  model: z.string().trim().min(1).max(200),
  is_enabled: z.boolean(),
  daily_credit_limit: z.number().int().positive().max(1_000_000_000).nullable().optional(),
  api_key: z.string().max(500).optional(),
  /*
   * Three distinct meanings, which is why it is nullable AND optional:
   *   absent  → leave whatever is stored alone
   *   null/'' → clear it, fall back to the vendor default
   *   string  → validate and store
   */
  base_url: z.string().max(500).nullable().optional(),
})

export async function GET() {
  try {
    const user = await requireRoleOrThrow('CEO')
    const supabase = await createSupabaseServerClient()

    // The view, not the table: it has no key column at all.
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

    const { provider, model, is_enabled, daily_credit_limit, api_key, base_url } = parsed.data

    const providerDef = PROVIDERS[provider as AIProvider]
    if (!providerDef) return badRequest('Unknown provider')

    /*
     * Normalise the base URL before storing so every later read is already safe and
     * consistently shaped — trailing slash stripped, credentials and query rejected,
     * internal hosts refused. Doing it here rather than at request time means a bad
     * value is reported to the person typing it, while they can still see the field.
     */
    let normalizedBaseUrl: string | null | undefined
    if (base_url !== undefined) {
      const trimmed = base_url?.trim() ?? ''
      if (!trimmed) {
        normalizedBaseUrl = null
      } else {
        try {
          normalizedBaseUrl = normalizeBaseUrl(trimmed, allowLocalBaseUrl())
        } catch (err) {
          if (err instanceof BaseUrlError) return badRequest(err.message)
          throw err
        }
      }
    }

    /*
     * A gateway has no default host, so it cannot be saved without one. Checked
     * against the value that will actually be in the row after this write —
     * `undefined` here means "unchanged", so the stored value has to be consulted
     * rather than assumed absent, or switching provider to `compatible` without
     * re-typing an existing URL would be rejected for no reason.
     */
    const supabase = createSupabaseServiceClient()

    const { data: existing } = await supabase
      .from('ai_settings')
      .select('id, base_url, provider, model')
      .eq('organization_id', user.organization_id)
      .maybeSingle()

    const effectiveBaseUrl =
      normalizedBaseUrl !== undefined ? normalizedBaseUrl : (existing?.base_url ?? null)

    if (providerDef.requiresBaseUrl && !effectiveBaseUrl) {
      return badRequest(`${providerDef.label} needs a base URL, e.g. https://openrouter.ai/api/v1`)
    }

    const payload: Record<string, unknown> = {
      organization_id: user.organization_id,
      provider,
      model,
      is_enabled,
      daily_credit_limit: daily_credit_limit ?? null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }

    if (normalizedBaseUrl !== undefined) {
      payload.base_url = normalizedBaseUrl
    }

    /*
     * Only touch the key column when the caller sends the field. Absent preserves
     * the existing key, '' clears it. This is what lets the form show "leave blank
     * to keep existing key" without ever round-tripping the secret to the browser
     * and back.
     */
    if (api_key !== undefined) {
      payload.encrypted_api_key = api_key.trim() === '' ? null : api_key.trim()
    }

    const { error } = existing
      ? await supabase.from('ai_settings').update(payload).eq('id', existing.id)
      : await supabase.from('ai_settings').insert(payload)

    if (error) {
      console.error('[ai_settings] upsert failed', error)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    /*
     * The audit row records the host and whether the key changed — never the key
     * itself, and never its length or prefix, which would narrow a brute force.
     * base_url is safe to log in full: it is a hostname, and knowing which endpoint
     * the org's AI traffic goes to is exactly the kind of change an audit trail
     * exists to capture.
     */
    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'ai_settings.updated',
      entityType: 'ai_settings',
      entityId: existing?.id ?? null,
      metadata: {
        provider,
        model,
        is_enabled,
        base_url: effectiveBaseUrl,
        key_changed: api_key !== undefined,
        provider_changed: existing ? existing.provider !== provider : true,
        model_changed: existing ? existing.model !== model : true,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
