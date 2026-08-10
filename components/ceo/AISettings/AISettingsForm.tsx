'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader } from '@/components/ui/primitives'
import { PROVIDERS } from '@/lib/ai/registry'
import type { AIProvider } from '@/lib/types'
import type { AISettingsPublic } from '@/lib/types'

interface Props {
  settings: AISettingsPublic | null
}

export function AISettingsForm({ settings }: Props) {
  const router = useRouter()
  const [provider, setProvider] = useState<AIProvider>(settings?.provider ?? 'anthropic')
  const [model, setModel] = useState(settings?.model ?? PROVIDERS.anthropic.defaultModel)
  const [isEnabled, setIsEnabled] = useState(settings?.is_enabled ?? false)
  const [dailyLimit, setDailyLimit] = useState(settings?.daily_token_limit?.toString() ?? '')
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const providerDef = PROVIDERS[provider]
  const availableModels = providerDef?.models ?? []

  function handleProviderChange(p: AIProvider) {
    setProvider(p)
    setModel(PROVIDERS[p]?.defaultModel ?? '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const body: Record<string, unknown> = {
      provider,
      model,
      is_enabled: isEnabled,
      daily_token_limit: dailyLimit ? parseInt(dailyLimit, 10) : null,
    }
    if (clearKey) {
      body.api_key = ''
    } else if (apiKey.trim()) {
      body.api_key = apiKey.trim()
    }

    try {
      const res = await fetch('/api/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Save failed')
      } else {
        setSaved(true)
        setApiKey('')
        setClearKey(false)
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="text-sm font-semibold text-slate-900">AI Provider Settings</h2>
        <p className="mt-0.5 text-xs text-slate-500">CEO-only. All changes are audit-logged.</p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {/* Provider */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {Object.values(PROVIDERS).map((p) => (
                <option key={p.id} value={p.id} disabled={!p.implemented}>
                  {p.label}{!p.implemented ? ' (coming soon)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Daily token limit */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Daily Token Limit{' '}
              <span className="normal-case font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="number"
              min={1}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              placeholder="Unlimited"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3 pt-6">
            <button
              type="button"
              role="switch"
              aria-checked={isEnabled}
              onClick={() => setIsEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                isEnabled ? 'bg-indigo-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-medium text-slate-800">
                {isEnabled ? 'AI assistant enabled' : 'AI assistant disabled'}
              </p>
              <p className="text-xs text-slate-500">Toggle to enable or disable for all users.</p>
            </div>
          </div>

          {/* API key — full width */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              API Key{' '}
              {settings?.has_api_key && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium normal-case text-emerald-700">
                  ✓ Configured
                </span>
              )}
            </label>

            {clearKey ? (
              <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
                <p className="flex-1 text-sm text-rose-700">API key will be cleared on save.</p>
                <button
                  type="button"
                  onClick={() => setClearKey(false)}
                  className="text-xs font-medium text-rose-600 underline hover:no-underline"
                >
                  Undo
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="new-password"
                  placeholder={settings?.has_api_key ? 'Leave blank to keep existing key' : 'Paste your API key'}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
                {settings?.has_api_key && (
                  <button
                    type="button"
                    onClick={() => setClearKey(true)}
                    className="rounded-lg border border-rose-200 px-3 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    Clear key
                  </button>
                )}
              </div>
            )}
            <p className="mt-1.5 text-xs text-slate-500">
              Stored server-side only. The key is never returned to the browser.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-5">
          <div>
            {error && (
              <p className="flex items-center gap-1.5 text-sm text-rose-600">
                <span>⚠</span> {error}
              </p>
            )}
            {saved && (
              <p className="flex items-center gap-1.5 text-sm text-emerald-600">
                <span>✓</span> Settings saved successfully.
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
