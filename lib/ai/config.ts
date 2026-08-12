import 'server-only'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { ServiceError } from '@/lib/services/tasks'
import { PROVIDERS, createAdapter, estimateCost, findModel, resolveApiKey } from '@/lib/ai/provider'
import type { ProviderAdapter, TokenUsage } from '@/lib/ai/provider'
import { creditLimitReachedMessage, tokensToCredits } from '@/lib/ai/credits'
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
  /** Credits allowed per day, or null for unlimited. */
  dailyCreditLimit: number | null
  apiKey: string | null
  /** Operator override. Null means the provider's own default host. */
  baseUrl: string | null
}

export async function loadAIConfig(organizationId: string): Promise<ResolvedAIConfig> {
  const supabase = createSupabaseServiceClient()

  const { data } = await supabase
    .from('ai_settings')
    .select('provider, model, is_enabled, daily_credit_limit, encrypted_api_key, base_url')
    .eq('organization_id', organizationId)
    .maybeSingle()

  const provider = (data?.provider ?? 'anthropic') as AIProvider
  /*
   * `?? default` rather than `|| default`: for provider = 'compatible' the stored
   * model is meaningful only if the CEO set it, and the registry default is ''.
   * Coalescing on null keeps an intentionally-stored value and lets the empty case
   * fail loudly in createAdapter with "No model is configured" — which names the
   * fix — rather than silently sending a wrong vendor's default model id to a
   * gateway.
   */
  const model = data?.model ?? PROVIDERS[provider]?.defaultModel ?? ''

  return {
    organizationId,
    provider,
    model,
    isEnabled: data?.is_enabled ?? false,
    dailyCreditLimit: data?.daily_credit_limit ?? null,
    apiKey: resolveApiKey(provider, data?.encrypted_api_key ?? null),
    baseUrl: data?.base_url ?? null,
  }
}

export class AIUnavailableError extends Error {
  reason: 'disabled' | 'no_key' | 'quota'
  /**
   * Credits spent and allowed today. Set only when reason is 'quota'.
   *
   * Carried on the error rather than re-queried by the caller: the check has just
   * counted these rows, and a second count could disagree with the first if a
   * concurrent request landed in between — which would put two different numbers
   * in front of the CEO for the same refusal.
   */
  usage?: { used: number; limit: number }

  constructor(
    reason: 'disabled' | 'no_key' | 'quota',
    message: string,
    usage?: { used: number; limit: number }
  ) {
    super(message)
    this.name = 'AIUnavailableError'
    this.reason = reason
    this.usage = usage
  }
}

/**
 * Credits spent by this org since midnight.
 *
 * Server-local midnight, matching the settings page's own daily card. Not IST —
 * the two have to agree on where the day starts or the assistant would refuse
 * while the usage card still showed headroom, and aligning both on the server's
 * zone is the change that does not require a migration.
 */
export async function getTodayCreditUsage(organizationId: string): Promise<number> {
  const supabase = createSupabaseServiceClient()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { data } = await supabase
    .from('ai_usage_logs')
    .select('credits_used')
    .eq('organization_id', organizationId)
    .gte('created_at', startOfDay.toISOString())

  return (data ?? []).reduce((sum, row) => sum + (row.credits_used ?? 0), 0)
}

/** Throws unless AI is configured, enabled, and under today's credit limit. */
export async function requireUsableAI(config: ResolvedAIConfig): Promise<ProviderAdapter> {
  if (!config.isEnabled) {
    throw new AIUnavailableError('disabled', 'The AI assistant is turned off in AI Settings.')
  }
  if (!config.apiKey) {
    throw new AIUnavailableError('no_key', 'No API key is configured for the selected provider.')
  }
  if (config.dailyCreditLimit !== null) {
    const used = await getTodayCreditUsage(config.organizationId)
    if (used >= config.dailyCreditLimit) {
      /*
       * The message comes from lib/ai/credits.ts so the wording is identical
       * wherever it surfaces — the chat, the daily summary's unavailable line, and
       * anywhere else that renders err.message. This is a limit being honoured, not
       * a fault, and it is phrased that way.
       */
      throw new AIUnavailableError(
        'quota',
        creditLimitReachedMessage(used, config.dailyCreditLimit),
        { used, limit: config.dailyCreditLimit }
      )
    }
  }
  return createAdapter(config.provider, config.model, config.apiKey, config.baseUrl)
}

export async function recordUsage(params: {
  config: ResolvedAIConfig
  userId: string
  usage: TokenUsage
  promptSummary: string
}): Promise<void> {
  /*
   * Null when the model's price is not in the registry — which is now the common
   * case, since the CEO can name any model on any gateway. Persisted as null
   * rather than 0 so the usage card can render an em dash: "$0.0000" against a
   * call that certainly cost something reads as a measurement, and a CEO watching
   * spend would be reading a fabrication. Token counts stay exact either way,
   * because those come from the provider's own usage response.
   */
  const cost = estimateCost(findModel(params.config.provider, params.config.model), params.usage)

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('ai_usage_logs').insert({
    organization_id: params.config.organizationId,
    user_id: params.userId,
    /*
     * Converted rather than assigned. One credit is one token today, so this is an
     * identity — but routing it through tokensToCredits() means changing the ratio
     * later is a one-line edit in lib/ai/credits.ts instead of a hunt for every
     * place a raw token count was written to a credits column.
     */
    credits_used: tokensToCredits(params.usage.totalTokens),
    estimated_cost: cost === null ? null : Number(cost.toFixed(6)),
    prompt_summary: params.promptSummary.slice(0, 500),
  })

  // Usage accounting must never break the user-facing request.
  if (error) console.error('[ai] failed to record usage', error)
}

export { ServiceError }
