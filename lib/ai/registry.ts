/**
 * Pure data registry — no server-only guard, safe to import from client components.
 * Contains provider/model definitions and pricing for display + cost calculation.
 * The actual Anthropic SDK lives in provider.ts (server-only).
 */
import type { AIProvider } from '@/lib/types'

export interface ModelOption {
  id: string
  label: string
  inputPerMillion: number
  outputPerMillion: number
  contextWindow: number
}

export interface ProviderDefinition {
  id: AIProvider
  label: string
  implemented: boolean
  defaultModel: string
  models: ModelOption[]
}

export const PROVIDERS: Record<AIProvider, ProviderDefinition> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    implemented: true,
    defaultModel: 'claude-opus-5',
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
    label: 'OpenAI',
    implemented: false,
    defaultModel: '',
    models: [],
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    implemented: false,
    defaultModel: '',
    models: [],
  },
}

export function findModel(provider: AIProvider, modelId: string): ModelOption | null {
  return PROVIDERS[provider]?.models.find((m) => m.id === modelId) ?? null
}
