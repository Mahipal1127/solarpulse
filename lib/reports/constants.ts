/**
 * Employee report submissions — shared constants.
 *
 * Its own file rather than an addition to a department's constants, because this is the
 * one feature every department has. Nothing here is department-specific.
 */

import type { ReportPeriod, ReportStatus } from '@/lib/types'

/** Private bucket from 0019. Nothing in it is ever served from a public URL. */
export const REPORT_BUCKET = 'employee-reports'

/**
 * Storage path shape: '{organization_id}/{user_id}/{uuid}-{filename}'.
 *
 * The uuid prefix, not the report id: the file is uploaded from the browser BEFORE the
 * report row exists, so there is no report id to put in the path yet. The storage
 * policies in 0019 only parse the first two segments (org, then author), so the tail is
 * free-form — and the read policies join on attachment_path = objects.name, which does
 * not care about the shape at all.
 */
export function reportAttachmentPath(organizationId: string, userId: string, fileName: string) {
  return `${organizationId}/${userId}/${crypto.randomUUID()}-${fileName}`
}

/**
 * 20 MB. A report is prose plus at most a supporting document or a photo of a site — a
 * scanned PDF or a phone photo fits comfortably. Matches the HR and Finance document
 * ceiling rather than the 200 MB marketing one, which exists for raw video.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * How long a download link stays valid. Short on purpose: a signed URL is a bearer
 * token, and an employee's report attachment is personal — the same reasoning as the
 * other private buckets, which all use 300.
 */
export const SIGNED_URL_TTL_SECONDS = 300

export const REPORT_PERIODS: ReportPeriod[] = ['daily', 'weekly', 'monthly']

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

/** What each period actually covers, shown next to the picker so nobody has to guess. */
export const REPORT_PERIOD_HINTS: Record<ReportPeriod, string> = {
  daily: 'Today',
  weekly: 'The last 7 days',
  monthly: 'The last 30 days',
}

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
}

export const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  draft: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  submitted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
}
