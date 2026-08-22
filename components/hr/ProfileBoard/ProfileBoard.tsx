'use client'

import { useState, type ReactNode } from 'react'

type TabKey = 'id-card' | 'documents' | 'performance'

/**
 * The shared employee Profile Board shell, used by BOTH the HR route (/hr/employees/[id]) and the
 * CEO route (/(ceo)/employees/[id]). It owns only the tab chrome; each tab's content is passed in
 * pre-rendered so the server can do the RLS-scoped fetching (ID card signing, documents, the
 * gated performance summary) and this stays a thin client shell.
 *
 * WHY CONTENT AS PROPS, not fetched here. The performance tab is strict-tier — the entitlement
 * check lives in getPerformanceSummary on the server. Passing rendered nodes down means an
 * unentitled viewer's page never even ships the figures; the panel prop is the locked notice
 * instead. The board cannot leak what the server never sent it.
 */
export function ProfileBoard({
  idCard,
  documents,
  performance,
}: {
  idCard: ReactNode
  documents: ReactNode
  performance: ReactNode
}) {
  const [tab, setTab] = useState<TabKey>('id-card')

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'id-card', label: 'ID Card' },
    { key: 'documents', label: 'Documents' },
    { key: 'performance', label: 'Performance' },
  ]

  return (
    <div>
      <div className="flex gap-1 border-b border-border-subtle px-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-brand-gold text-brand-slate'
                : 'border-transparent text-text-muted hover:text-brand-slate'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-5">
        {tab === 'id-card' && idCard}
        {tab === 'documents' && documents}
        {tab === 'performance' && performance}
      </div>
    </div>
  )
}
