import 'server-only'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { ServiceError } from '@/lib/services/tasks'
import { PROVIDERS, createAdapter, estimateCost, findModel, resolveApiKey } from '@/lib/ai/provider'
import type { ProviderAdapter, TokenUsage } from '@/lib/ai/provider'
import type { AIProvider } from '@/lib/types'

/**
 * Loads AI configuration and the API key. Uses the service client because
 * encrypted_api_key is deliberately unreadable through the client-facing view,
 * and because ai_usage_logs has no insert policy for anyone.
 */

export interface ResolvedAIConfig {
  organizationId: string
  provider: AIProvider
  model: string
  isEnabled: boolean
  dailyTokenLimit: number | null
  apiKey: string | null
}

export async function loadAIConfig(organizationId: string): Promise<ResolvedAIConfig> {
  const supabase = createSupabaseServiceClient()

  const { data } = await supabase
    .from('ai_settings')
    .select('provider, model, is_enabled, daily_token_limit, encrypted_api_key')
    .eq('organization_id', organizationId)
    .maybeSingle()

  const provider = (data?.provider ?? 'anthropic') as AIProvider
  const model = data?.model ?? PROVIDERS[provider].defaultModel

  return {
    organizationId,
    provider,
    model,
    isEnabled: data?.is_enabled ?? false,
    dailyTokenLimit: data?.daily_token_limit ?? null,
    apiKey: resolveApiKey(provider, data?.encrypted_api_key ?? null),
  }
}

export class AIUnavailableError extends Error {
  reason: 'disabled' | 'no_key' | 'quota'
  constructor(reason: 'disabled' | 'no_key' | 'quota', message: string) {
    super(message)
    this.name = 'AIUnavailableError'
    this.reason = reason
  }
}

/** Sum of today's tokens for the org. Drives the daily limit and the usage card. */
export async function getTodayTokenUsage(organizationId: string): Promise<number> {
  const supabase = createSupabaseServiceClient()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { data } = await supabase
    .from('ai_usage_logs')
    .select('tokens_used')
    .eq('organization_id', organizationId)
    .gte('created_at', startOfDay.toISOString())

  return (data ?? []).reduce((sum, row) => sum + (row.tokens_used ?? 0), 0)
}

/** Throws unless AI is configured, enabled, and under today's token limit. */
export async function requireUsableAI(config: ResolvedAIConfig): Promise<ProviderAdapter> {
  if (!config.isEnabled) {
    throw new AIUnavailableError('disabled', 'The AI assistant is turned off in AI Settings.')
  }
  if (!config.apiKey) {
    throw new AIUnavailableError('no_key', 'No API key is configured for the selected provider.')
  }
  if (config.dailyTokenLimit !== null) {
    const used = await getTodayTokenUsage(config.organizationId)
    if (used >= config.dailyTokenLimit) {
      throw new AIUnavailableError('quota', "Today's AI token limit has been reached.")
    }
  }
  return createAdapter(config.provider, config.model, config.apiKey)
}

export async function recordUsage(params: {
  config: ResolvedAIConfig
  userId: string
  usage: TokenUsage
  promptSummary: string
}): Promise<void> {
  const model = findModel(params.config.provider, params.config.model)
  const cost = model ? estimateCost(model, params.usage) : 0

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('ai_usage_logs').insert({
    organization_id: params.config.organizationId,
    user_id: params.userId,
    tokens_used: params.usage.totalTokens,
    estimated_cost: Number(cost.toFixed(6)),
    prompt_summary: params.promptSummary.slice(0, 500),
  })

  // Usage accounting must never break the user-facing request.
  if (error) console.error('[ai] failed to record usage', error)
}

export { ServiceError }
