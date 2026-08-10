import 'server-only'

import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { AISettingsForm } from '@/components/ceo/AISettings/AISettingsForm'
import { Card, CardHeader, StatCard } from '@/components/ui/primitives'
import { PROVIDERS } from '@/lib/ai/provider'
import type { AISettingsPublic, AIProvider } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function AISettingsPage() {
  const user = await requireRole('CEO')

  // Settings public view — no key column
  const supabase = await createSupabaseServerClient()
  const { data: settingsRaw } = await supabase
    .from('ai_settings_public')
    .select('*')
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  const settings = settingsRaw as AISettingsPublic | null

  // Usage: service client because ai_usage_logs has no user INSERT policy
  // and we want org-wide aggregates the CEO should see.
  const service = createSupabaseServiceClient()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [allTimeRes, thirtyDayRes, todayRes, recentRes] = await Promise.all([
    service.from('ai_usage_logs')
      .select('tokens_used, estimated_cost')
      .eq('organization_id', user.organization_id),
    service.from('ai_usage_logs')
      .select('tokens_used, estimated_cost')
      .eq('organization_id', user.organization_id)
      .gte('created_at', thirtyDaysAgo),
    service.from('ai_usage_logs')
      .select('tokens_used, estimated_cost')
      .eq('organization_id', user.organization_id)
      .gte('created_at', todayStart.toISOString()),
    service.from('ai_usage_logs')
      .select('tokens_used, estimated_cost, prompt_summary, created_at')
      .eq('organization_id', user.organization_id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  function sumLogs(rows: { tokens_used: number; estimated_cost: number }[]) {
    return rows.reduce(
      (acc, r) => ({ tokens: acc.tokens + r.tokens_used, cost: acc.cost + Number(r.estimated_cost) }),
      { tokens: 0, cost: 0 }
    )
  }

  const allTime = sumLogs(allTimeRes.data ?? [])
  const thirtyDay = sumLogs(thirtyDayRes.data ?? [])
  const today = sumLogs(todayRes.data ?? [])

  type UsageRow = { tokens_used: number; estimated_cost: number; prompt_summary: string | null; created_at: string }
  const recentLogs = (recentRes.data ?? []) as UsageRow[]

  const providerDef = settings ? PROVIDERS[settings.provider as AIProvider] : null
  const modelDef = providerDef?.models.find((m) => m.id === settings?.model)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">AI Settings</h1>
        <p className="text-sm text-slate-500">Configure the AI assistant and monitor usage.</p>
      </div>

      <AISettingsForm settings={settings} />

      {/* Usage stats */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Token Usage
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Today"
            value={today.tokens.toLocaleString('en-IN')}
            hint={`$${today.cost.toFixed(4)} est.`}
            tone={
              settings?.daily_token_limit && today.tokens >= settings.daily_token_limit
                ? 'danger'
                : 'default'
            }
          />
          <StatCard
            label="Last 30 days"
            value={thirtyDay.tokens.toLocaleString('en-IN')}
            hint={`$${thirtyDay.cost.toFixed(4)} est.`}
          />
          <StatCard
            label="All time"
            value={allTime.tokens.toLocaleString('en-IN')}
            hint={`$${allTime.cost.toFixed(4)} est.`}
          />
        </div>
        {settings?.daily_token_limit && (
          <p className="mt-2 text-xs text-slate-500">
            Daily limit: {settings.daily_token_limit.toLocaleString('en-IN')} tokens
            {today.tokens >= settings.daily_token_limit && (
              <span className="ml-2 font-medium text-rose-600">Limit reached</span>
            )}
          </p>
        )}
      </section>

      {/* Current config summary */}
      {settings && (
        <Card>
          <CardHeader title="Current Configuration" />
          <div className="divide-y divide-slate-100">
            <Row label="Provider" value={providerDef?.label ?? settings.provider} />
            <Row
              label="Model"
              value={modelDef ? `${modelDef.label} ($${modelDef.inputPerMillion}/M in · $${modelDef.outputPerMillion}/M out)` : settings.model}
            />
            <Row label="Status" value={settings.is_enabled ? 'Enabled' : 'Disabled'} />
            <Row label="API Key" value={settings.has_api_key ? 'Configured' : 'Not set'} />
            <Row
              label="Daily Token Limit"
              value={settings.daily_token_limit ? settings.daily_token_limit.toLocaleString('en-IN') : 'Unlimited'}
            />
          </div>
        </Card>
      )}

      {/* Recent usage log */}
      {recentLogs.length > 0 && (
        <Card>
          <CardHeader title="Recent AI Calls" subtitle="Last 20" />
          <div className="divide-y divide-slate-100">
            {recentLogs.map((log, i) => (
              <div key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">
                    {log.prompt_summary ?? 'AI call'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(log.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium text-slate-700">
                    {log.tokens_used.toLocaleString('en-IN')} tokens
                  </p>
                  <p className="text-xs text-slate-500">${Number(log.estimated_cost).toFixed(4)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
    </div>
  )
}
