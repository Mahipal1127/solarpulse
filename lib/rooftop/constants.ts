import type { RooftopProjectStatus } from '@/lib/types'

/**
 * Rooftop status transitions — the single source of truth, imported by the
 * service (which re-checks on every write) and by the status picker (which
 * offers only what the server will accept). No 'server-only' here: the client
 * needs it too, the way lib/om/constants.ts serves both sides.
 *
 * Deliberately conservative: a site can be paused, finished or cancelled
 * while active; a paused site resumes or is cancelled; a completed site can
 * be reopened (a commissioning issue surfacing later); a cancelled one can be
 * reactivated (the customer came back). There is no path straight to
 * 'completed' from 'on_hold' — resume first, so the timeline shows the site
 * actually resumed.
 */
export const ROOFTOP_TRANSITIONS: Record<RooftopProjectStatus, RooftopProjectStatus[]> = {
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: ['active'],
  cancelled: ['active'],
}
