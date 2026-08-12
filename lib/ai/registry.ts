/**
 * Provider and model catalogue.
 *
 * Pure data — no server-only guard, so the settings form and the server adapters
 * read the same definitions. The SDK calls live in provider.ts.
 *
 * ── THE MODEL ID IS FREE TEXT, AND THAT IS THE POINT ───────────────────────
 * The lists below are *suggestions*, not an allowlist. The settings form accepts
 * any model id the CEO types, and the server sends it through unchanged.
 *
 * The old registry worked the other way: the route rejected any model not in this
 * file, which meant a model released after this file was written was unreachable
 * until someone edited code and redeployed. That is the wrong failure mode for a
 * setting an operator is supposed to own. It is also unworkable for a gateway —
 * OpenRouter model ids look like `anthropic/claude-opus-4.6` and there are
 * hundreds, LiteLLM ids are whatever the operator named their own routes, and a
 * self-hosted vLLM id is a local directory name.
 *
 * The tradeoff is that a typo now reaches the provider instead of being caught
 * here. That is the better error anyway: the provider answers "model not found"
 * and names what it expected, which is more useful than this app claiming a real
 * model does not exist.
 *
 * ── WHY MOST PRICES ARE NULL ───────────────────────────────────────────────
 * Pricing is only filled in where it was verifiable at the time of writing. For
 * everything else it is null, which means "unknown" and renders as an em dash
 * rather than $0.0000.
 *
 * A wrong price is worse than no price. It is not visibly wrong — it is a
 * plausible number on a cost card that a CEO might use to decide something,
 * quietly understating or overstating spend forever. Null is the truthful value
 * and it says so on screen. Token counts are always exact regardless, since those
 * come from the provider's own usage response.
 *
 * Anthropic prices come from Anthropic's published list. The OpenAI and Gemini
 * entries are model ids only: at the time this file was written the pricing could
 * not be confirmed from a primary source, so inventing figures would have put
 * fabricated costs in front of the CEO. If you know the current rate, fill it in
 * here — one edit and the cost card starts working for that model.
 */
import type { AIProvider } from '@/lib/types'

/**
 * The wire format, which is the only thing an adapter branches on.
 *
 * Three dialects, not four. `compatible` is OpenAI's dialect pointed at another
 * host, which is precisely why the ecosystem standardised on it — every gateway
 * worth using speaks POST /chat/completions.
 */
export type ProviderDialect = 'anthropic' | 'openai' | 'gemini'

export interface ModelOption {
  id: string
  label: string
  /** USD per million input tokens. Null when unverified — never guess. */
  inputPerMillion: number | null
  /** USD per million output tokens. Null when unverified. */
  outputPerMillion: number | null
  contextWindow: number | null
}

export interface ProviderDefinition {
  id: AIProvider
  label: string
  dialect: ProviderDialect
  /** Vendor default host. Null for `compatible`, which has no default to fall back on. */
  defaultBaseUrl: string | null
  /** True when base_url is mandatory — there is nowhere else to send the request. */
  requiresBaseUrl: boolean
  defaultModel: string
  /** Env var consulted before the stored key, so a deployment can inject one. */
  keyEnvVar: string | null
  /** Shown under the key field so a pasted wrong-vendor key is obvious. */
  keyHint: string
  docsUrl: string
  /** Suggestions for the model field, which accepts any value. */
  models: ModelOption[]
}

export const PROVIDERS: Record<AIProvider, ProviderDefinition> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    dialect: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    requiresBaseUrl: false,
    defaultModel: 'claude-opus-5',
    keyEnvVar: 'ANTHROPIC_API_KEY',
    keyHint: 'Starts with sk-ant-. From console.anthropic.com.',
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
    models: [
      {
        id: 'claude-opus-5',
        label: 'Claude Opus 5',
        inputPerMillion: 5,
        outputPerMillion: 25,
        contextWindow: 1_000_000,
      },
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        inputPerMillion: 3,
        outputPerMillion: 15,
        contextWindow: 1_000_000,
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        inputPerMillion: 1,
        outputPerMillion: 5,
        contextWindow: 200_000,
      },
    ],
  },

  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    dialect: 'openai',
    // The /v1 is part of the base: the adapter appends /chat/completions.
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresBaseUrl: false,
    defaultModel: 'gpt-5',
    keyEnvVar: 'OPENAI_API_KEY',
    keyHint: 'Starts with sk-. From platform.openai.com.',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    models: [
      // Prices null — see the header note. Ids are a starting point; type any id.
      { id: 'gpt-5', label: 'GPT-5', inputPerMillion: null, outputPerMillion: null, contextWindow: null },
      { id: 'gpt-5-mini', label: 'GPT-5 mini', inputPerMillion: null, outputPerMillion: null, contextWindow: null },
      { id: 'gpt-4.1', label: 'GPT-4.1', inputPerMillion: null, outputPerMillion: null, contextWindow: null },
      { id: 'o4-mini', label: 'o4-mini', inputPerMillion: null, outputPerMillion: null, contextWindow: null },
    ],
  },

  google: {
    id: 'google',
    label: 'Google (Gemini)',
    dialect: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresBaseUrl: false,
    defaultModel: 'gemini-2.5-pro',
    keyEnvVar: 'GOOGLE_API_KEY',
    keyHint: 'An AI Studio key, from aistudio.google.com/apikey.',
    docsUrl: 'https://ai.google.dev/api/generate-content',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', inputPerMillion: null, outputPerMillion: null, contextWindow: null },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', inputPerMillion: null, outputPerMillion: null, contextWindow: null },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro', inputPerMillion: null, outputPerMillion: null, contextWindow: null },
    ],
  },

  compatible: {
    id: 'compatible',
    label: 'Custom / gateway (OpenAI-compatible)',
    dialect: 'openai',
    defaultBaseUrl: null,
    requiresBaseUrl: true,
    defaultModel: '',
    /*
     * No env var. The whole point of this option is that the operator names the
     * endpoint and the key together — falling back to OPENAI_API_KEY here would
     * send an OpenAI key to a third-party gateway, which is both a leak and a
     * confusing failure when it is rejected.
     */
    keyEnvVar: null,
    keyHint: 'Whatever key the gateway issues. Sent as an Authorization: Bearer header.',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    models: [],
  },
}

/** Ordered for the picker: implemented vendors first, the catch-all last. */
export const PROVIDER_ORDER: AIProvider[] = ['anthropic', 'openai', 'google', 'compatible']

/** Suggestion lookup. Null simply means "no published price for this id". */
export function findModel(provider: AIProvider, modelId: string): ModelOption | null {
  return PROVIDERS[provider]?.models.find((m) => m.id === modelId) ?? null
}

/** The host a request will actually go to, given an optional override. */
export function resolveBaseUrl(provider: AIProvider, override: string | null): string | null {
  return override?.trim() ? override.trim() : (PROVIDERS[provider]?.defaultBaseUrl ?? null)
}
