import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import { ServiceError } from '@/lib/services/tasks'
import { PROVIDERS, findModel } from '@/lib/ai/registry'
import type { ModelOption } from '@/lib/ai/registry'
import type { AIProvider } from '@/lib/types'

export type { ModelOption, ProviderDefinition } from '@/lib/ai/registry'
export { PROVIDERS, findModel } from '@/lib/ai/registry'

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

const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1

export function estimateCost(model: ModelOption, usage: TokenUsage): number {
  const inputRate = model.inputPerMillion / 1_000_000
  const outputRate = model.outputPerMillion / 1_000_000
  return (
    usage.inputTokens * inputRate +
    usage.cacheCreationTokens * inputRate * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * inputRate * CACHE_READ_MULTIPLIER +
    usage.outputTokens * outputRate
  )
}

class AnthropicAdapter implements ProviderAdapter {
  provider: AIProvider = 'anthropic'
  private client: Anthropic

  constructor(
    apiKey: string,
    public model: string
  ) {
    this.client = new Anthropic({ apiKey })
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
                  schema: request.jsonSchema.schema,
                },
              },
            }
          : {}),
      })

      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        totalTokens: 0,
      }
      usage.totalTokens =
        usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens + usage.outputTokens

      if (response.stop_reason === 'refusal') {
        return { text: '', json: null, refused: true, usage }
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim()

      let json: unknown = null
      if (request.jsonSchema && text) {
        try {
          json = JSON.parse(text)
        } catch {
          json = null
        }
      }

      return { text, json, refused: false, usage }
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
  if (err instanceof Anthropic.RateLimitError)
    return new ServiceError('AI provider rate limit reached. Try again shortly.', 429)
  if (err instanceof Anthropic.APIConnectionError)
    return new ServiceError('Could not reach the AI provider.', 504)
  if (err instanceof Anthropic.APIError)
    return new ServiceError('The AI provider returned an error.', 502)
  console.error('[ai] unexpected provider error', err)
  return new ServiceError('AI request failed.', 500)
}

export function resolveApiKey(provider: AIProvider, storedKey: string | null): string | null {
  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY ?? storedKey ?? null
  }
  return storedKey
}

export function createAdapter(
  provider: AIProvider,
  model: string,
  apiKey: string
): ProviderAdapter {
  const definition = PROVIDERS[provider]
  if (!definition?.implemented) {
    throw new ServiceError(
      `The ${definition?.label ?? provider} adapter is not implemented yet.`,
      501
    )
  }
  if (!findModel(provider, model)) {
    throw new ServiceError(`Model "${model}" is not available for ${definition.label}.`, 400)
  }
  return new AnthropicAdapter(apiKey, model)
}
