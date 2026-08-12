import 'server-only'

import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { AISettingsForm } from '@/components/ceo/AISettings/AISettingsForm'
import { Card, CardHeader, StatCard } from '@/components/ui/primitives'
import { PROVIDERS, findModel, resolveBaseUrl } from '@/lib/ai/registry'
import { allowLocalBaseUrl } from '@/lib/ai/env'
import { formatCredits } from '@/lib/ai/credits'
import type { AISettingsPublic, AIProvider } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * AI configuration and spend.
 *
 * WHY EVERY COST ON THIS PAGE CAN BE AN EM DASH
 * A CEO can now point the assistant at any model on any gateway, and for most of
 * those the price per token is not something this app knows. `estimated_cost` is
 * therefore nullable, and null means "unknown" — not zero.
 *
 * That distinction has to survive all the way to the screen, and the obvious code
 * breaks it silently: `Number(null)` is `0`, so the previous version of this file
 * would have rendered an unknown cost as "$0.0000" — a plausible-looking figure on
 * a card a CEO might use to judge spend. Every read below goes through
 * `toCost()`/`sumCost()` instead, which keep null as null, and a total that includes
 * unknown rows is shown as a floor ("at least") rather than a fact.
 *
 * Credit counts are always exact. Those come from the provider's own usage response,
 * so the daily limit is enforceable even when the price is not.
 */

/** A numeric cost, or null. Never coerces null to zero — that is the whole point. */
function toCost(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

type UsageRow = {
  credits_used: number | null
  estimated_cost: number | string | null
}

/**
 * Exact credit total, plus a cost total that admits what it does not know.
 *
 * `unpriced` counts rows whose cost is null. When it is above zero the sum is a
 * lower bound, and the caller renders it as such — the alternative is a total that
 * quietly omits every gateway call and looks complete.
 */
function summarise(rows: UsageRow[]): {
  credits: number
  cost: number | null
  unpriced: number
  total: number
} {
  let credits = 0
  let cost = 0
  let priced = 0
  let unpriced = 0

  for (const row of rows) {
    credits += row.credits_used ?? 0
    const value = toCost(row.estimated_cost)
    if (value === null) {
      unpriced += 1
    } else {
      cost += value
      priced += 1
    }
  }

  return {
    credits,
    // All unknown → no figure at all, rather than a misleading 0.
    cost: priced > 0 ? cost : null,
    unpriced,
    total: rows.length,
  }
}

/** "$0.0042", "at least $0.0042", or "—". */
function formatCost(cost: number | null, unpriced: number): string {
  if (cost === null) return '—'
  const formatted = `$${cost.toFixed(4)}`
  return unpriced > 0 ? `at least ${formatted}` : formatted
}

export default async function AISettingsPage() {
  const user = await requireRole('CEO')

  // The view, never the table: it has no key column to leak.
  const supabase = await createSupabaseServerClient()
  const { data: settingsRaw } = await supabase
    .from('ai_settings_public')
    .select('*')
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  const settings = settingsRaw as AISettingsPublic | null

  /*
   * Service client for usage: ai_usage_logs has no insert policy for anyone, and
   * these are org-wide aggregates the CEO is entitled to. RLS would also allow the
   * read, but the writes elsewhere in this feature already require the service
   * client, so reading the same table two ways would be the odd choice.
   */
  const service = createSupabaseServiceClient()

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  const [allTimeRes, thirtyDayRes, todayRes, recentRes] = await Promise.all([
    service
      .from('ai_usage_logs')
      .select('credits_used, estimated_cost')
      .eq('organization_id', user.organization_id),
    service
      .from('ai_usage_logs')
      .select('credits_used, estimated_cost')
      .eq('organization_id', user.organization_id)
      .gte('created_at', thirtyDaysAgo),
    service
      .from('ai_usage_logs')
      .select('credits_used, estimated_cost')
      .eq('organization_id', user.organization_id)
      .gte('created_at', todayStart.toISOString()),
    service
      .from('ai_usage_logs')
      .select('credits_used, estimated_cost, prompt_summary, created_at')
      .eq('organization_id', user.organization_id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const allTime = summarise((allTimeRes.data ?? []) as UsageRow[])
  const thirtyDay = summarise((thirtyDayRes.data ?? []) as UsageRow[])
  const today = summarise((todayRes.data ?? []) as UsageRow[])

  type RecentRow = UsageRow & { prompt_summary: string | null; created_at: string }
  const recentLogs = (recentRes.data ?? []) as RecentRow[]

  const provider = settings?.provider as AIProvider | undefined
  const providerDef = provider ? PROVIDERS[provider] : null
  const modelDef = provider && settings ? findModel(provider, settings.model) : null

  const limit = settings?.daily_credit_limit ?? null
  /*
   * `>=`, matching requireUsableAI exactly. The two have to agree or this page would
   * show headroom while the assistant refuses — and both count from the server's
   * midnight, which is why todayStart above is not IST.
   */
  const overLimit = limit !== null && today.credits >= limit

  /*
   * What the request will actually be sent to, which is not always what is stored:
   * a blank base_url means the vendor default, and showing "—" there would leave
   * the CEO unable to confirm where their prompts are going.
   */
  const effectiveBaseUrl = provider ? resolveBaseUrl(provider, settings?.base_url ?? null) : null

  return (
    <div className="space-y-6 p-6 sm:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-slate">AI settings</h1>
        <p className="mt-1 text-sm text-text-muted">
          Bring your own key for Claude, ChatGPT or Gemini — or point the assistant at any
          OpenAI-compatible gateway.
        </p>
      </header>

      <AISettingsForm settings={settings} allowLocalBaseUrl={allowLocalBaseUrl()} />

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Credit usage
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Today"
            value={formatCredits(today.credits)}
            hint={formatCost(today.cost, today.unpriced)}
            /*
              Amber, not red. Spending the credits the CEO allocated is the system
              working; red is for faults, and using it here would send someone
              looking for a bug that does not exist. Amber still marks it as the one
              card worth reading.
            */
            tone={overLimit ? 'warning' : 'default'}
          />
          <StatCard
            label="Last 30 days"
            value={formatCredits(thirtyDay.credits)}
            hint={formatCost(thirtyDay.cost, thirtyDay.unpriced)}
          />
          <StatCard
            label="All time"
            value={formatCredits(allTime.credits)}
            hint={formatCost(allTime.cost, allTime.unpriced)}
          />
        </div>

        {limit !== null && (
          <p className="mt-2 text-xs text-text-muted">
            Daily limit: {formatCredits(limit)} credits.
            {overLimit && (
              <span className="ml-1.5 font-medium text-brand-slate">
                Reached — the assistant is paused until midnight. Raise the limit above to
                continue today.
              </span>
            )}
          </p>
        )}

        {/*
          Said once, here, rather than repeated under all three cards. The reason a
          cost is missing is a property of the configuration, not of the time range.
        */}
        {allTime.unpriced > 0 && (
          <p className="mt-2 text-xs text-text-muted">
            {allTime.unpriced === allTime.total
              ? 'No published price is known for this model, so cost is not estimated. Credit counts are exact.'
              : `${allTime.unpriced} of ${allTime.total} calls used a model with no known price, so the totals above are a floor. Credit counts are exact.`}
          </p>
        )}
      </section>

      {settings && (
        <Card>
          <CardHeader title="Current configuration" />
          <div className="divide-y divide-border-subtle">
            <Row label="Provider" value={providerDef?.label ?? settings.provider} />
            <Row label="Model" value={settings.model || 'Not set'} />
            <Row
              label="Price"
              value={
                modelDef?.inputPerMillion != null && modelDef.outputPerMillion != null
                  ? `$${modelDef.inputPerMillion}/M in · $${modelDef.outputPerMillion}/M out`
                  : 'Not known for this model'
              }
            />
            <Row
              label="Endpoint"
              value={effectiveBaseUrl ?? 'Not set'}
              hint={settings.base_url ? undefined : 'Provider default'}
            />
            <Row label="Status" value={settings.is_enabled ? 'Enabled' : 'Disabled'} />
            <Row
              label="API key"
              value={settings.has_api_key ? 'Configured' : 'Not set'}
              hint={
                !settings.has_api_key && providerDef?.keyEnvVar
                  ? `Falls back to ${providerDef.keyEnvVar}`
                  : undefined
              }
            />
            <Row
              label="Daily credit limit"
              value={limit !== null ? formatCredits(limit) : 'Unlimited'}
            />
          </div>
        </Card>
      )}

      {recentLogs.length > 0 && (
        <Card>
          <CardHeader title="Recent AI calls" subtitle="Last 20" />
          <div className="divide-y divide-border-subtle">
            {recentLogs.map((log, index) => {
              const cost = toCost(log.estimated_cost)
              return (
                <div
                  key={`${log.created_at}-${index}`}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-brand-slate">
                      {log.prompt_summary ?? 'AI call'}
                    </p>
                    <p className="text-xs text-text-muted">
                      {new Date(log.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums text-brand-slate">
                      {formatCredits(log.credits_used ?? 0)} credits
                    </p>
                    <p className="text-xs tabular-nums text-text-muted">
                      {cost === null ? '—' : `$${cost.toFixed(4)}`}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <p className="shrink-0 text-sm text-text-muted">{label}</p>
      <div className="min-w-0 text-right">
        {/* break-all: a gateway URL has no spaces and would otherwise force the
            card wider than the grid. */}
        <p className="break-all text-sm font-medium text-brand-slate">{value}</p>
        {hint && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
    </div>
  )
}
