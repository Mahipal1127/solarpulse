import type {
  InstallationStatus,
  ServiceTicketStatus,
  AmcVisitStatus,
} from '@/lib/types'

/**
 * Operations & Maintenance domain vocabularies and status transition tables.
 *
 * No 'server-only': the transition tables decide which buttons a status control
 * offers, so client components import them. Nothing here is a permission check —
 * the service layer and RLS do that. Display labels and colours live in
 * lib/format.ts alongside every other module's.
 */

// ---------------------------------------------------------------------------
// Vocabularies (suggested sets, not DB constraints — these columns are free text)
// ---------------------------------------------------------------------------

/** Roles offered by the team-assignment picker. role_on_site is free text. */
export const TEAM_ROLES = ['electrician', 'helper', 'supervisor', 'technician'] as const

/** Photo stage tags offered by the upload picker. photo_stage is free text. */
export const PHOTO_STAGES = [
  'before',
  'during',
  'panel_mounting',
  'wiring',
  'after',
  'final',
] as const

/** Complaint categories offered by the ticket form. issue_type is free text. */
export const SERVICE_ISSUE_TYPES = [
  'no_generation',
  'inverter_fault',
  'physical_damage',
  'billing_query',
  'other',
] as const

/** AMC visit cadences offered by the contract form. visit_frequency is free text. */
export const VISIT_FREQUENCIES = ['quarterly', 'half_yearly', 'annual'] as const

// ---------------------------------------------------------------------------
// Status flows
// ---------------------------------------------------------------------------

/**
 * 'assigned -> completed' directly is allowed: a small install can finish in a
 * single visit and forcing 'in_progress' first would be busywork. 'on_hold' is
 * reachable from the two live states and returns only to 'in_progress' — coming
 * off hold means work resumes.
 *
 * 'completed' and 'cancelled' are terminal, matching survey/PO: the record becomes
 * history. A completed install that turns out wrong is corrected with service work
 * or a fresh install, not by flipping the status back and losing the completion
 * date. §3.2's "completion report prompts marking completed" is the UI nudging this
 * transition, not a separate mechanism.
 */
export const INSTALLATION_TRANSITIONS: Record<InstallationStatus, InstallationStatus[]> = {
  assigned: ['in_progress', 'on_hold', 'completed', 'cancelled'],
  in_progress: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
}

/**
 * The report gate on 'resolved' is NOT expressed here — a transition table cannot
 * see whether a service report exists. It lives in resolveGuardedTicketUpdate() in
 * the service layer, per §3.4 ("don't allow a ticket to go straight to resolved
 * without at least one report logged, enforce this in the Route Handler").
 *
 * 'resolved -> in_progress' reopens a ticket whose fix did not hold. 'closed' is
 * terminal.
 */
export const SERVICE_TICKET_TRANSITIONS: Record<ServiceTicketStatus, ServiceTicketStatus[]> = {
  open: ['assigned', 'in_progress', 'resolved', 'closed'],
  assigned: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
}

/**
 * A visit can be completed or rescheduled from scheduled; a rescheduled visit is
 * still actionable (it was moved, not cancelled) so it can still complete or move
 * again. 'completed' is terminal. 'missed' is never set here — it is derived from a
 * passed scheduled_date (isAmcVisitMissed), so it is not a transition anyone makes.
 */
export const AMC_VISIT_TRANSITIONS: Record<AmcVisitStatus, AmcVisitStatus[]> = {
  scheduled: ['completed', 'rescheduled'],
  rescheduled: ['completed', 'rescheduled'],
  completed: [],
}

/** Order for the installation status tracker. Excludes on_hold/cancelled (side states). */
export const INSTALLATION_STATUS_ORDER: InstallationStatus[] = [
  'assigned',
  'in_progress',
  'completed',
]

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Private bucket created in migration 0012. Objects live at '{installation_id}/{filename}'. */
export const INSTALLATION_MEDIA_BUCKET = 'installation-media'

/**
 * How long a download link stays valid. Short on purpose: a signed URL is a bearer
 * token, and site photos and completion documents are customer property. The bucket
 * is private; nothing is served from a public URL.
 */
export const SIGNED_URL_TTL_SECONDS = 300

/** Upload ceiling. Site photos and scanned completion reports are the large cases. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
