'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ExternalLink, KeyRound } from 'lucide-react'
import { PROVIDERS, PROVIDER_ORDER } from '@/lib/ai/registry'
import { isValidBaseUrl } from '@/lib/ai/baseUrl'
import type { AIProvider, AISettingsPublic } from '@/lib/types'

/**
 * Bring-your-own-key AI configuration.
 *
 * FOUR PROVIDERS, THREE WIRE FORMATS
 * Claude, ChatGPT and Gemini each have their own request shape; the fourth option,
 * "Custom / gateway", is OpenAI's shape pointed at a host the CEO names, which is
 * what OpenRouter, LiteLLM, Groq, Together and a self-hosted vLLM all speak. That
 * one option therefore covers every endpoint not on the list above it.
 *
 * THE MODEL FIELD IS FREE TEXT WITH SUGGESTIONS, NOT A DROPDOWN
 * A <select> can only offer what was hardcoded when this file was written, which
 * makes a model released next month unreachable without a redeploy and makes
 * gateways impossible — their ids are arbitrary strings like
 * `anthropic/claude-opus-4.6`, or whatever an operator named a local route. This is
 * an <input> with a <datalist>, so the common ids are one click away and anything
 * else can still be typed. A wrong id is reported by the provider, which names what
 * it expected.
 *
 * WHY THE BASE URL IS ALWAYS VISIBLE
 * Not just for the gateway option. A CEO may want Claude through a corporate proxy
 * or an Azure-style deployment host, and hiding the field for the three named
 * vendors would mean the only way to reach a proxy is to mislabel the provider as
 * "custom" — which would then send the request in the wrong dialect. Blank means
 * "use the vendor's own host", and the placeholder shows what that is.
 */

interface Props {
  settings: AISettingsPublic | null
  /**
   * Mirrors AI_ALLOW_LOCAL_BASE_URL on the server. Passed in rather than read here
   * because lib/ai/env.ts is server-only — and it must stay that way, since it
   * governs whether the SSRF guard is relaxed.
   *
   * Used only to keep the client's preview of the error in step with what the
   * server will actually accept. The server re-validates regardless; this cannot
   * loosen anything.
   */
  allowLocalBaseUrl?: boolean
}

export function AISettingsForm({ settings, allowLocalBaseUrl = false }: Props) {
  const router = useRouter()
  const [provider, setProvider] = useState<AIProvider>(settings?.provider ?? 'anthropic')
  const [model, setModel] = useState(settings?.model ?? PROVIDERS.anthropic.defaultModel)
  const [baseUrl, setBaseUrl] = useState(settings?.base_url ?? '')
  const [isEnabled, setIsEnabled] = useState(settings?.is_enabled ?? false)
  const [dailyLimit, setDailyLimit] = useState(settings?.daily_credit_limit?.toString() ?? '')
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const providerDef = PROVIDERS[provider]

  /*
   * Switching provider rewrites the model, because a model id is meaningless across
   * vendors — leaving `claude-opus-5` in the box after switching to Gemini would
   * produce a 404 that looks like a bug in the app. The gateway option's default is
   * an empty string, which correctly leaves the field blank for the CEO to fill.
   */
  function handleProviderChange(next: AIProvider) {
    setProvider(next)
    setModel(PROVIDERS[next]?.defaultModel ?? '')
    /*
     * The base URL is cleared too. It is vendor-specific — an OpenAI-shaped
     * gateway URL sent to Gemini's dialect is a guaranteed failure — and silently
     * keeping the old host while changing the dialect is the single most confusing
     * state this form can be in.
     */
    setBaseUrl('')
  }

  /*
   * There is one key column per organisation, not one per provider. So a key saved
   * for Anthropic is still the stored key after switching to OpenAI, and it will be
   * sent to OpenAI and rejected. That is a real limitation of the schema rather
   * than something this form can paper over, so it is stated plainly instead.
   */
  const providerChanged = settings != null && settings.provider !== provider
  const staleKeyWarning = providerChanged && settings.has_api_key && !clearKey && !apiKey.trim()

  const baseUrlRequired = providerDef?.requiresBaseUrl ?? false
  const baseUrlTouched = baseUrl.trim().length > 0
  const baseUrlInvalid = baseUrlTouched && !isValidBaseUrl(baseUrl, allowLocalBaseUrl)
  const baseUrlMissing = baseUrlRequired && !baseUrlTouched

  const modelMissing = !model.trim()
  const canSubmit = !saving && !baseUrlInvalid && !baseUrlMissing && !modelMissing

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    setError(null)
    setSaved(false)

    const body: Record<string, unknown> = {
      provider,
      model: model.trim(),
      is_enabled: isEnabled,
      daily_credit_limit: dailyLimit ? parseInt(dailyLimit, 10) : null,
      // Always sent: '' clears it and falls back to the vendor default, which is
      // the only way to undo a base URL once one has been saved.
      base_url: baseUrl.trim() || null,
    }
    if (clearKey) {
      body.api_key = ''
    } else if (apiKey.trim()) {
      body.api_key = apiKey.trim()
    }
    // Otherwise api_key is omitted entirely, which preserves the stored key.

    try {
      const res = await fetch('/api/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Save failed.')
      } else {
        setSaved(true)
        setApiKey('')
        setClearKey(false)
        router.refresh()
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dashboard-card overflow-hidden">
      <div className="border-b border-border-subtle px-6 py-4">
        <h2 className="text-sm font-semibold text-brand-slate">AI provider</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          CEO-only. Every change is audit-logged. Keys are stored server-side and never sent
          back to this page.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="ai-provider" className={FIELD_LABEL}>
              Provider
            </label>
            <select
              id="ai-provider"
              value={provider}
              onChange={(event) => handleProviderChange(event.target.value as AIProvider)}
              className={CONTROL}
            >
              {PROVIDER_ORDER.map((id) => (
                <option key={id} value={id}>
                  {PROVIDERS[id].label}
                </option>
              ))}
            </select>
            <p className={HINT}>
              <a
                href={providerDef?.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-brand-gold hover:underline"
              >
                API reference
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          <div>
            <label htmlFor="ai-model" className={FIELD_LABEL}>
              Model
            </label>
            <input
              id="ai-model"
              list="ai-model-suggestions"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={baseUrlRequired ? 'e.g. anthropic/claude-opus-4.6' : 'Model id'}
              autoComplete="off"
              spellCheck={false}
              className={CONTROL}
            />
            {/* Suggestions, not a closed list — any id can be typed. */}
            <datalist id="ai-model-suggestions">
              {(providerDef?.models ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </datalist>
            <p className={HINT}>
              {modelMissing
                ? 'Required.'
                : 'Any model id this provider accepts. The listed ones are suggestions.'}
            </p>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="ai-base-url" className={FIELD_LABEL}>
              Base URL{' '}
              <span className="font-normal normal-case text-text-muted">
                {baseUrlRequired ? '(required)' : '(optional)'}
              </span>
            </label>
            <input
              id="ai-base-url"
              type="url"
              inputMode="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={providerDef?.defaultBaseUrl ?? 'https://your-gateway.example.com/v1'}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={baseUrlInvalid || baseUrlMissing}
              aria-describedby="ai-base-url-hint"
              className={baseUrlInvalid || baseUrlMissing ? CONTROL_INVALID : CONTROL}
            />
            <p id="ai-base-url-hint" className={HINT}>
              {baseUrlInvalid ? (
                <span className="text-status-danger">
                  Must be an https:// URL on a public host, with no username, password or
                  query string.
                </span>
              ) : baseUrlMissing ? (
                <span className="text-status-danger">
                  A gateway has no default host, so this is required.
                </span>
              ) : baseUrlRequired ? (
                'Include the version path if the gateway uses one, e.g. https://openrouter.ai/api/v1'
              ) : (
                `Leave blank to use ${providerDef?.defaultBaseUrl}. Set it only for a proxy or a self-hosted endpoint.`
              )}
            </p>
          </div>

          <div>
            <label htmlFor="ai-daily-limit" className={FIELD_LABEL}>
              Daily credit limit{' '}
              <span className="font-normal normal-case text-text-muted">(optional)</span>
            </label>
            <input
              id="ai-daily-limit"
              type="number"
              min={1}
              value={dailyLimit}
              onChange={(event) => setDailyLimit(event.target.value)}
              placeholder="Unlimited"
              className={CONTROL}
            />
            {/* Says what happens at the limit, not just how it is counted. Reaching it
                stops the assistant answering, and a CEO choosing a number needs to
                know that before they pick one rather than after. */}
            <p className={HINT}>
              Counted across the whole organisation, resetting at midnight. The assistant stops
              answering once it is reached.
            </p>
          </div>

          <div className="flex items-start gap-3 sm:pt-7">
            <button
              type="button"
              role="switch"
              aria-checked={isEnabled}
              onClick={() => setIsEnabled((value) => !value)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                isEnabled ? 'bg-brand-gold' : 'bg-border-subtle'
              }`}
            >
              <span className="sr-only">Enable the AI assistant</span>
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-medium text-brand-slate">
                {isEnabled ? 'Assistant enabled' : 'Assistant disabled'}
              </p>
              <p className="text-xs text-text-muted">
                Turns the dashboard chat and the daily summary on or off.
              </p>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="ai-key" className={FIELD_LABEL}>
              API key
              {settings?.has_api_key && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-status-success/10 px-2 py-0.5 text-[11px] font-medium normal-case text-status-success">
                  <Check className="h-3 w-3" />
                  Configured
                </span>
              )}
            </label>

            {clearKey ? (
              <div className="notice-danger flex items-center gap-3 rounded-lg border px-4 py-3">
                <p className="flex-1 text-sm">The key will be removed when you save.</p>
                <button
                  type="button"
                  onClick={() => setClearKey(false)}
                  className="text-xs font-medium underline hover:no-underline"
                >
                  Undo
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  id="ai-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={
                    settings?.has_api_key ? 'Leave blank to keep the current key' : 'Paste the key'
                  }
                  className={`${CONTROL} min-w-[16rem] flex-1`}
                />
                {settings?.has_api_key && (
                  <button
                    type="button"
                    onClick={() => setClearKey(true)}
                    className="rounded-lg border border-border-subtle px-3 py-2.5 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/5"
                  >
                    Remove key
                  </button>
                )}
              </div>
            )}

            <p className={HINT}>
              <KeyRound className="mr-1 inline h-3 w-3" />
              {providerDef?.keyHint}
              {providerDef?.keyEnvVar
                ? ` An ${providerDef.keyEnvVar} environment variable, if set, is used instead.`
                : ''}
            </p>
          </div>
        </div>

        {/*
          The one-key-per-organisation problem, stated rather than hidden. Switching
          provider leaves the previous vendor's key in the column, and it will be
          sent to the new provider and rejected — so the CEO is told to replace it
          while they are still looking at the field.
        */}
        {staleKeyWarning && (
          <div className="notice-warning flex items-start gap-2.5 rounded-lg border px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs">
              The stored key was saved for {PROVIDERS[settings.provider]?.label ?? settings.provider}.
              There is one key per organisation, so {providerDef?.label} will be sent that same key
              and will reject it. Paste a {providerDef?.label} key above before saving.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-5">
          <div aria-live="polite">
            {error && (
              <p className="flex items-center gap-1.5 text-sm text-status-danger">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
            {saved && !error && (
              <p className="flex items-center gap-1.5 text-sm text-status-success">
                <Check className="h-4 w-4 shrink-0" />
                Saved.
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  )
}

const FIELD_LABEL =
  'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted'

const CONTROL =
  'w-full rounded-lg border border-border-subtle bg-white px-3 py-2.5 text-sm text-brand-slate outline-none transition-colors placeholder:text-text-muted focus:border-brand-gold'

const CONTROL_INVALID = CONTROL.replace('border-border-subtle', 'border-status-danger')

const HINT = 'mt-1.5 text-xs text-text-muted'
