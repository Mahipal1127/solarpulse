import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import { ServiceError } from '@/lib/services/tasks'
// findModel is re-exported below but not used here any more: createAdapter no
// longer validates the model id against the registry. See the note in registry.ts.
import { PROVIDERS, resolveBaseUrl } from '@/lib/ai/registry'
import type { ModelOption } from '@/lib/ai/registry'
import { toAnthropicSchema, toOpenAISchema, toGeminiSchema } from '@/lib/ai/schemaDialect'
import type { AIProvider } from '@/lib/types'

export type { ModelOption, ProviderDefinition, ProviderDialect } from '@/lib/ai/registry'
export { PROVIDERS, PROVIDER_ORDER, findModel, resolveBaseUrl } from '@/lib/ai/registry'

/**
 * Three adapters behind one interface: Anthropic Messages, OpenAI chat completions
 * (which also covers every gateway), and Gemini generateContent.
 *
 * WHY ONLY ANTHROPIC USES AN SDK
 * @anthropic-ai/sdk is already a dependency and gives typed errors worth having.
 * OpenAI and Gemini are reached with fetch instead of adding two more SDKs, for
 * reasons that are about this feature specifically rather than about weight:
 *
 *   - The `compatible` provider exists to talk to hosts that are *nearly* OpenAI.
 *     Gateways differ in small ways, and an SDK that validates responses strictly
 *     turns a gateway quirk into an unfixable client-side error. Raw fetch reads
 *     the four fields we need and ignores the rest.
 *   - Two of the three code paths here (openai, compatible) share one
 *     implementation precisely because the wire format is the contract, not the
 *     vendor.
 *
 * WHAT EVERY ADAPTER MUST GUARANTEE
 *   - Never throw a raw provider error. Translate to ServiceError, because these
 *     messages reach the CEO and "fetch failed" is not a sentence anyone can act
 *     on.
 *   - Never let a hung request hang a route handler. A user-supplied base URL can
 *     point at a host that accepts the connection and then says nothing, so every
 *     request carries its own timeout.
 *   - Report token usage without double-counting cached tokens; see normaliseUsage
 *     callers below, since the three providers disagree about whether the prompt
 *     count already includes the cache.
 */

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
}

export interface CompletionRequest {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens?: number
  jsonSchema?: { schema: Record<string, unknown> }
}

export interface CompletionResult {
  text: string
  json: unknown | null
  refused: boolean
  usage: TokenUsage
}

export interface ProviderAdapter {
  provider: AIProvider
  model: string
  complete(request: CompletionRequest): Promise<CompletionResult>
}

/**
 * 60s. Long enough for a slow reasoning model on a long context, short enough that
 * a dead gateway does not pin a serverless function until the platform kills it.
 */
const REQUEST_TIMEOUT_MS = 60_000

const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1

/**
 * Cost in USD, or null when the price is not known.
 *
 * Null rather than 0 is the whole point: a CEO can now point this at any model id
 * on any gateway, and most of those have no price in the registry. Returning 0
 * would render "$0.0000" — a number that looks like a measurement and is actually
 * an absence. Callers persist null and the UI shows an em dash.
 */
export function estimateCost(model: ModelOption | null, usage: TokenUsage): number | null {
  if (!model || model.inputPerMillion === null || model.outputPerMillion === null) return null

  const inputRate = model.inputPerMillion / 1_000_000
  const outputRate = model.outputPerMillion / 1_000_000
  return (
    usage.inputTokens * inputRate +
    usage.cacheCreationTokens * inputRate * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * inputRate * CACHE_READ_MULTIPLIER +
    usage.outputTokens * outputRate
  )
}

/** Sums the four buckets. Each adapter fills them so this addition is correct. */
function withTotal(usage: Omit<TokenUsage, 'totalTokens'>): TokenUsage {
  return {
    ...usage,
    totalTokens:
      usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens + usage.outputTokens,
  }
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** Best-effort JSON parse of a model's text output. */
function parseJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    /*
     * Fenced output. Providers without a strict schema mode — most gateway-hosted
     * open models — wrap JSON in ```json fences even when told not to. Recovering
     * here rather than failing the turn, because the alternative is telling the CEO
     * "unexpected format" over a response that is entirely correct inside a fence.
     */
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim())
      } catch {
        return null
      }
    }
    return null
  }
}

// ───────────────────────────── Anthropic ──────────────────────────────────

class AnthropicAdapter implements ProviderAdapter {
  private client: Anthropic

  constructor(
    apiKey: string,
    public model: string,
    public provider: AIProvider,
    baseUrl: string | null
  ) {
    this.client = new Anthropic({
      apiKey,
      // Only pass baseURL when overridden; the SDK's own default is correct and
      // handing it undefined explicitly is not the same as omitting it in all
      // SDK versions.
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      timeout: REQUEST_TIMEOUT_MS,
    })
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        system: request.system,
        messages: request.messages,
        thinking: { type: 'adaptive' },
        ...(request.jsonSchema
          ? {
              output_config: {
                format: {
                  type: 'json_schema' as const,
                  schema: toAnthropicSchema(request.jsonSchema.schema),
                },
              },
            }
          : {}),
      })

      /*
       * Anthropic reports input_tokens *excluding* cached tokens, so the four
       * buckets are already disjoint and simply add up.
       */
      const usage = withTotal({
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      })

      if (response.stop_reason === 'refusal') {
        return { text: '', json: null, refused: true, usage }
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim()

      return {
        text,
        json: request.jsonSchema ? parseJson(text) : null,
        refused: false,
        usage,
      }
    } catch (err) {
      throw translateAnthropicError(err)
    }
  }
}

function translateAnthropicError(err: unknown): ServiceError {
  if (err instanceof Anthropic.BadRequestError)
    return new ServiceError('The AI provider rejected the request.', 400)
  if (err instanceof Anthropic.AuthenticationError)
    return new ServiceError('The configured AI API key was rejected.', 502)
  if (err instanceof Anthropic.NotFoundError)
    return new ServiceError('That model id was not found for this provider.', 400)
  if (err instanceof Anthropic.RateLimitError)
    return new ServiceError('AI provider rate limit reached. Try again shortly.', 429)
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new ServiceError('The AI provider took too long to respond.', 504)
  if (err instanceof Anthropic.APIConnectionError)
    return new ServiceError('Could not reach the AI provider.', 504)
  if (err instanceof Anthropic.APIError)
    return new ServiceError('The AI provider returned an error.', 502)
  console.error('[ai] unexpected anthropic error', err)
  return new ServiceError('AI request failed.', 500)
}

// ─────────────────── Shared HTTP plumbing for the fetch adapters ───────────

/**
 * One POST with a timeout, and a uniform translation of every failure mode.
 *
 * `label` names the provider in log lines only. It is never put in a user-facing
 * message, because a CEO reading "OpenRouter returned 502" learns nothing they can
 * act on beyond what "the AI provider returned an error" already says, and the raw
 * body may echo the request.
 */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  label: string
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // No credentials, no cookies. This is a server-to-server call to a host the
      // operator named; nothing about this app's session should ride along.
      cache: 'no-store',
      redirect: 'follow',
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new ServiceError('The AI provider took too long to respond.', 504)
    }
    console.error(`[ai] ${label} connection failed`, err)
    throw new ServiceError('Could not reach the AI provider. Check the base URL.', 504)
  }

  const raw = await response.text()

  if (!response.ok) {
    // Logged in full server-side; summarised for the user.
    console.error(`[ai] ${label} HTTP ${response.status}`, raw.slice(0, 1000))
    throw translateHttpStatus(response.status, raw)
  }

  const parsed = parseJson(raw)
  if (!parsed || typeof parsed !== 'object') {
    console.error(`[ai] ${label} non-JSON response`, raw.slice(0, 500))
    throw new ServiceError('The AI provider returned a malformed response.', 502)
  }
  return parsed as Record<string, unknown>
}

function translateHttpStatus(status: number, body: string): ServiceError {
  /*
   * The provider's own message is surfaced for 400 and 404 only. Those two are
   * almost always a wrong model id or an unsupported parameter, and the provider
   * names the offending field — which is genuinely the most useful thing we can
   * show. Truncated hard, and only these two statuses, so an error body cannot
   * become a channel for arbitrary text from a third-party host.
   */
  const detail = extractErrorMessage(body)

  if (status === 400)
    return new ServiceError(
      detail
        ? `The AI provider rejected the request: ${detail}`
        : 'The AI provider rejected the request.',
      400
    )
  if (status === 401 || status === 403)
    return new ServiceError('The configured AI API key was rejected.', 502)
  if (status === 404)
    return new ServiceError(
      detail ? `Not found at that endpoint: ${detail}` : 'That model or endpoint was not found.',
      400
    )
  if (status === 429)
    return new ServiceError('AI provider rate limit reached. Try again shortly.', 429)
  if (status >= 500) return new ServiceError('The AI provider is unavailable right now.', 502)
  return new ServiceError('The AI provider returned an error.', 502)
}

/** Pulls a short message out of the several error shapes these APIs use. */
function extractErrorMessage(body: string): string | null {
  const parsed = parseJson(body)
  if (!parsed || typeof parsed !== 'object') return null

  const error = (parsed as { error?: unknown }).error
  const candidate =
    typeof error === 'string'
      ? error
      : typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : typeof (parsed as { message?: unknown }).message === 'string'
          ? (parsed as { message: string }).message
          : null

  return candidate ? candidate.slice(0, 200) : null
}

// ──────────────── OpenAI dialect (also every gateway) ─────────────────────

class OpenAICompatibleAdapter implements ProviderAdapter {
  constructor(
    private apiKey: string,
    public model: string,
    public provider: AIProvider,
    private baseUrl: string
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    /*
     * The system prompt goes in as a `system` message rather than `developer`.
     * Both work on current OpenAI models; `system` is what every gateway and
     * open-weight server understands, and this one code path serves both.
     */
    const messages = [
      { role: 'system', content: request.system },
      ...request.messages,
    ]

    /*
     * max_tokens vs max_completion_tokens.
     *
     * OpenAI's reasoning-capable models (the o-series, gpt-5 and later) reject
     * `max_tokens` outright — it is not deprecated there, it is a 400. Gateways
     * and self-hosted servers are the mirror image: many predate
     * `max_completion_tokens` and ignore or reject it, leaving the response
     * unbounded.
     *
     * So the key is chosen by provider rather than by model id, which is the only
     * signal available for a free-text model field. Guessing from the id (does it
     * start with "o", does it contain "gpt-5") would misfire on the first model
     * named outside that pattern.
     */
    const tokenLimitKey = this.provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      [tokenLimitKey]: request.maxTokens ?? 4096,
    }

    if (request.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'ceo_assistant_turn',
          strict: true,
          schema: toOpenAISchema(request.jsonSchema.schema),
        },
      }
    }

    const data = await postJson(
      `${this.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      body,
      this.provider
    )

    const usageRaw = (data.usage ?? {}) as Record<string, unknown>
    const cachedTokens = num(
      (usageRaw.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens
    )
    /*
     * OpenAI's prompt_tokens *includes* cached tokens, the opposite of Anthropic.
     * Subtracting here keeps the four buckets disjoint so withTotal() does not
     * count the cache twice — which would inflate the CEO's daily-limit usage and
     * cut them off early.
     */
    const promptTokens = num(usageRaw.prompt_tokens)
    const usage = withTotal({
      inputTokens: Math.max(0, promptTokens - cachedTokens),
      outputTokens: num(usageRaw.completion_tokens),
      cacheCreationTokens: 0, // Caching is automatic and not separately reported.
      cacheReadTokens: cachedTokens,
    })

    const choice = (data.choices as unknown[] | undefined)?.[0] as
      | Record<string, unknown>
      | undefined
    const message = (choice?.message ?? {}) as Record<string, unknown>

    // A refusal is a first-class field here, not an error.
    if (typeof message.refusal === 'string' && message.refusal.trim()) {
      return { text: '', json: null, refused: true, usage }
    }

    const text = typeof message.content === 'string' ? message.content.trim() : ''

    if (!text) {
      /*
       * Empty content with a length finish_reason means the answer was cut off
       * before any text survived — most often a reasoning model that spent the
       * whole budget thinking. Worth its own message: "unexpected format" would
       * send someone looking for a bug instead of raising the token limit.
       */
      if (choice?.finish_reason === 'length') {
        throw new ServiceError(
          'The model hit its output limit before replying. Try a shorter question.',
          502
        )
      }
      throw new ServiceError('The AI provider returned an empty response.', 502)
    }

    return {
      text,
      json: request.jsonSchema ? parseJson(text) : null,
      refused: false,
      usage,
    }
  }
}

// ───────────────────────────── Gemini ─────────────────────────────────────

class GeminiAdapter implements ProviderAdapter {
  provider: AIProvider = 'google'

  constructor(
    private apiKey: string,
    public model: string,
    private baseUrl: string
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      // A separate top-level field, not a message with a role — Gemini has no
      // system role in `contents`.
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => ({
        // 'model', not 'assistant'.
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 4096,
        ...(request.jsonSchema
          ? {
              responseMimeType: 'application/json',
              responseSchema: toGeminiSchema(request.jsonSchema.schema),
            }
          : {}),
      },
    }

    /*
     * The key goes in a header, never the query string. Google documents ?key=
     * and it works, but a URL is logged by proxies, CDNs and this app's own error
     * paths — and a leaked provider key is billable to the CEO.
     */
    const data = await postJson(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      body,
      'google'
    )

    const usageRaw = (data.usageMetadata ?? {}) as Record<string, unknown>
    // Like OpenAI, promptTokenCount includes the cached portion.
    const cachedTokens = num(usageRaw.cachedContentTokenCount)
    const usage = withTotal({
      inputTokens: Math.max(0, num(usageRaw.promptTokenCount) - cachedTokens),
      outputTokens: num(usageRaw.candidatesTokenCount),
      cacheCreationTokens: 0,
      cacheReadTokens: cachedTokens,
    })

    /*
     * Two distinct refusals. promptFeedback.blockReason means the *question* was
     * blocked and there is no candidate at all; a candidate finishing on SAFETY or
     * RECITATION means the answer was stopped part-way. Both are refusals rather
     * than errors, so the chat surface shows the assistant declining instead of a
     * red failure.
     */
    const promptFeedback = data.promptFeedback as Record<string, unknown> | undefined
    if (promptFeedback?.blockReason) {
      return { text: '', json: null, refused: true, usage }
    }

    const candidate = (data.candidates as unknown[] | undefined)?.[0] as
      | Record<string, unknown>
      | undefined

    if (!candidate) {
      throw new ServiceError('The AI provider returned no answer.', 502)
    }

    const finishReason = candidate.finishReason
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'PROHIBITED_CONTENT') {
      return { text: '', json: null, refused: true, usage }
    }

    const parts = ((candidate.content as Record<string, unknown> | undefined)?.parts ??
      []) as Record<string, unknown>[]
    const text = parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()

    if (!text) {
      if (finishReason === 'MAX_TOKENS') {
        throw new ServiceError(
          'The model hit its output limit before replying. Try a shorter question.',
          502
        )
      }
      throw new ServiceError('The AI provider returned an empty response.', 502)
    }

    return {
      text,
      json: request.jsonSchema ? parseJson(text) : null,
      refused: false,
      usage,
    }
  }
}

// ───────────────────────────── Factory ────────────────────────────────────

/**
 * The key for a provider: an environment variable wins over the stored one.
 *
 * Env-first is deliberate. A deployment that injects ANTHROPIC_API_KEY should not
 * be silently overridden by a key someone pasted into a form months ago, and it
 * gives an operator a way to rotate without touching the database.
 *
 * `compatible` has no env var by design — see the note in the registry. Its key
 * only ever comes from the row.
 */
export function resolveApiKey(provider: AIProvider, storedKey: string | null): string | null {
  const envVar = PROVIDERS[provider]?.keyEnvVar
  const fromEnv = envVar ? process.env[envVar] : undefined
  return fromEnv?.trim() || storedKey?.trim() || null
}

export function createAdapter(
  provider: AIProvider,
  model: string,
  apiKey: string,
  baseUrlOverride: string | null = null
): ProviderAdapter {
  const definition = PROVIDERS[provider]
  if (!definition) {
    throw new ServiceError(`Unknown AI provider "${provider}".`, 400)
  }

  if (!model.trim()) {
    throw new ServiceError('No model is configured. Set one in AI Settings.', 400)
  }

  const baseUrl = resolveBaseUrl(provider, baseUrlOverride)
  if (!baseUrl) {
    // Only reachable for `compatible`, which has no vendor default.
    throw new ServiceError(
      `${definition.label} needs a base URL. Set one in AI Settings.`,
      400
    )
  }

  /*
   * The model id is NOT checked against the registry. Those lists are suggestions
   * — see the note at the top of registry.ts. A wrong id comes back from the
   * provider as a 404 naming what it expected, which is more useful than this app
   * refusing a model that exists.
   */
  switch (definition.dialect) {
    case 'anthropic':
      // Passed only when overridden, so the SDK keeps its own default otherwise.
      return new AnthropicAdapter(
        apiKey,
        model,
        provider,
        baseUrlOverride?.trim() ? baseUrl : null
      )
    case 'openai':
      return new OpenAICompatibleAdapter(apiKey, model, provider, baseUrl)
    case 'gemini':
      return new GeminiAdapter(apiKey, model, baseUrl)
    default: {
      const exhaustive: never = definition.dialect
      throw new ServiceError(`Unsupported provider dialect "${String(exhaustive)}".`, 501)
    }
  }
}
