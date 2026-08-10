import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { Database } from 'lucide-react'
import {
  formatDateTime,
  BACKUP_TARGET_LABELS,
  BACKUP_RESULT_STYLES,
  BACKUP_RESULT_LABELS,
} from '@/lib/format'
import type { DataBackupLog, BackupTarget } from '@/lib/types'

/**
 * Backup status, read from data_backup_logs.
 *
 * A display of a log, and deliberately nothing more. There is no "run backup now"
 * button here and no schedule to configure: actual backup execution is an
 * infrastructure concern — Supabase's own backup feature or a cron job — settled in
 * the CEO module's security blueprint rather than in application code. A second
 * backup mechanism living in the app would be one more thing that can silently stop
 * working while appearing to be in charge.
 *
 * Rows arrive through the service-role client, which bypasses RLS. No policy grants
 * insert to anyone, so nothing reachable from a browser can write or falsify one.
 *
 * Not a client component: this is a read-only panel with no interactivity, so there
 * is nothing to ship to the browser.
 */
export function BackupStatusPanel({ logs }: { logs: DataBackupLog[] }) {
  /**
   * The most recent run per target, which is the question someone actually has — "is
   * the database backed up?" rather than "how many times has it run?". The list below
   * still shows the history behind it.
   */
  const latest = new Map<BackupTarget, DataBackupLog>()
  for (const log of logs) {
    const existing = latest.get(log.backup_type)
    if (!existing || new Date(log.performed_at) > new Date(existing.performed_at)) {
      latest.set(log.backup_type, log)
    }
  }

  const targets: BackupTarget[] = ['database', 'storage']

  return (
    <Card>
      <CardHeader
        title="Backup status"
        subtitle="Reported by infrastructure — not run from here"
      />

      {logs.length === 0 ? (
        <EmptyState
          title="No backup runs reported yet"
          description="Backups are executed at the infrastructure level and report their results here. An empty log means nothing has reported in, which is worth chasing rather than ignoring."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 border-b border-border-subtle px-5 py-4 sm:grid-cols-2">
            {targets.map((target) => {
              const log = latest.get(target)
              return (
                <div key={target} className="rounded-lg bg-surface-bg px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
                    <Database className="h-3.5 w-3.5 text-text-muted/60" />
                    {BACKUP_TARGET_LABELS[target]}
                  </p>
                  {log ? (
                    <>
                      <div className="mt-1.5">
                        <Badge className={BACKUP_RESULT_STYLES[log.status]}>
                          {BACKUP_RESULT_LABELS[log.status]}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-xs text-text-muted">
                        {formatDateTime(log.performed_at)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1.5 text-xs text-text-muted">Nothing reported</p>
                  )}
                </div>
              )
            })}
          </div>

          <ul className="divide-y divide-border-subtle">
            {logs.slice(0, 20).map((log) => (
              <li key={log.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-slate">
                    {BACKUP_TARGET_LABELS[log.backup_type]}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {formatDateTime(log.performed_at)}
                  </p>
                  {log.notes && <p className="mt-1 text-xs text-text-muted">{log.notes}</p>}
                </div>
                <Badge className={BACKUP_RESULT_STYLES[log.status]}>
                  {BACKUP_RESULT_LABELS[log.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
