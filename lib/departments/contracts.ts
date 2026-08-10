import 'server-only'

import type { PendingDataSource } from '@/lib/types'

/**
 * Contracts for data the CEO module consumes but does not own. Each department
 * module will implement its side later; until then these resolve to null and
 * the UI renders an "Awaiting <Department> module" state rather than a number.
 *
 * The point of the null returns is that no fabricated figure ever reaches a
 * chart or a summary card.
 */

export interface RevenueSnapshot {
  monthToDate: number
  previousMonth: number
  currency: 'INR'
}

export interface AttendanceSnapshot {
  date: string
  presentCount: number
  totalCount: number
  percentPresent: number
}

export interface SalesTrendPoint {
  month: string
  revenue: number
  ordersWon: number
}

export interface ProjectPortfolio {
  active: number
  completed: number
  pending: number
}

/** Owned by Finance. Returns null until the Finance module ships. */
export async function getRevenueSnapshot(
  _organizationId: string
): Promise<RevenueSnapshot | null> {
  return null
}

/** Owned by HR. Returns null until the HR module ships. */
export async function getAttendanceSnapshot(
  _organizationId: string
): Promise<AttendanceSnapshot | null> {
  return null
}

/** Owned by Sales. Returns null until the Sales module ships. */
export async function getSalesTrend(_organizationId: string): Promise<SalesTrendPoint[] | null> {
  return null
}

/**
 * Owned by Technical/Distribution. Project records live in those modules — the
 * CEO task board is not a project registry, so this stays stubbed rather than
 * being faked from the tasks table.
 */
export async function getProjectPortfolio(
  _organizationId: string
): Promise<ProjectPortfolio | null> {
  return null
}

export const PENDING_SOURCES: Record<string, PendingDataSource> = {
  revenue: { metric: 'Revenue', awaitingDepartment: 'Finance' },
  attendance: { metric: "Today's attendance", awaitingDepartment: 'HR' },
  salesTrend: { metric: 'Sales trend', awaitingDepartment: 'Sales' },
  projects: { metric: 'Project portfolio', awaitingDepartment: 'Technical' },
}
