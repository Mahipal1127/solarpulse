import type { SurveyStatus, DesignStatus, ITTicketStatus } from '@/lib/types'

/**
 * Technical's domain vocabularies and status transition tables.
 *
 * No 'server-only': the transition tables decide which buttons the survey and
 * design status controls offer, so client components import them. Nothing here is
 * a permission check — the service layer and RLS do that.
 *
 * Display labels and colours live in lib/format.ts alongside every other module's.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Photo tags offered by the upload picker. `survey_photos.photo_type` is free text
 * in the database on purpose — the blueprint's list ends in "etc." — so a surveyor
 * is never blocked by a missing option. This is the suggested set, not a
 * constraint.
 */
export const SURVEY_PHOTO_TYPES = [
  'roof_overview',
  'shading_obstruction',
  'meter_box',
  'roof_access',
  'drone_aerial',
  'electrical_panel',
  'other',
] as const

export type SurveyPhotoType = (typeof SURVEY_PHOTO_TYPES)[number]

/** Matches the it_issue_type enum in migration 0008. */
export const IT_ISSUE_TYPES = [
  'erp_bug',
  'software_access',
  'hardware',
  'data_backup',
  'other',
] as const

/**
 * Units for BOQ lines. Overlaps Distribution's MATERIAL_UNITS but is deliberately
 * its own list: a BOQ is an engineering document and uses 'pcs', which
 * Distribution's material vocabulary does not. Sharing the two would mean one
 * department's picker changing when the other's needs shifted.
 */
export const BOQ_UNITS = ['pcs', 'nos', 'meter', 'set', 'kg', 'roll', 'box', 'litre'] as const

export const DEFAULT_BOQ_UNIT = 'pcs'

/**
 * Keys of generation_reports.estimated_monthly_generation_kwh, in calendar order.
 * The column is jsonb and every month is optional — an engineer may record only an
 * annual figure — so readers must tolerate gaps.
 */
export const GENERATION_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const

export type GenerationMonth = (typeof GENERATION_MONTHS)[number]

/** Roof orientations offered by the survey form. Stored inside the jsonb blob. */
export const ROOF_ORIENTATIONS = [
  'south-facing',
  'south-east',
  'south-west',
  'east-facing',
  'west-facing',
  'north-facing',
  'flat',
  'mixed',
] as const

// ---------------------------------------------------------------------------
// Status flows
// ---------------------------------------------------------------------------

/**
 * `assigned -> completed` directly is allowed on purpose. A short survey often
 * gets done in one visit and marking 'in_progress' first would be busywork whose
 * only effect is a missing audit row when the engineer skips it.
 *
 * 'completed' is terminal, matching how 'received' works for a purchase order: it
 * is the point the record becomes history. Reopening is not a status flip — a
 * survey that turns out to be wrong gets a new survey, so the original findings
 * and the corrected ones both survive.
 */
export const SURVEY_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  assigned: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

/**
 * There is deliberately no `draft -> approved` edge: approving is what review
 * means, so skipping it would make the 'under_review' state decorative.
 *
 * Note this module does NOT gate approval by role, unlike Distribution's Finance
 * gate on purchase orders. The blueprint names an approver for a PO and does not
 * for a design, and inventing a lead-only gate here would stall a solo engineer
 * with nobody above them. If the client does want design sign-off restricted to
 * the Technical Manager, that is a policy plus a trigger, the same three-layer
 * shape used for POs — not a change to this table.
 *
 * 'sent_to_sales' is terminal because Sales acts on what it receives. Quietly
 * revising a design after handing it over would leave a quotation resting on
 * figures that no longer exist; a revision is a new design.
 */
export const DESIGN_TRANSITIONS: Record<DesignStatus, DesignStatus[]> = {
  draft: ['under_review'],
  under_review: ['approved', 'draft'],
  approved: ['sent_to_sales', 'under_review'],
  sent_to_sales: [],
}

/** 'resolved' can return to 'in_progress': an IT problem that recurs was not fixed. */
export const IT_TICKET_TRANSITIONS: Record<ITTicketStatus, ITTicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
}

/** Progress order for the survey and design status trackers. */
export const SURVEY_STATUS_ORDER: SurveyStatus[] = ['assigned', 'in_progress', 'completed']

export const DESIGN_STATUS_ORDER: DesignStatus[] = [
  'draft',
  'under_review',
  'approved',
  'sent_to_sales',
]

/** Statuses where a survey is still outstanding work, for dashboard counts. */
export const SURVEY_OPEN_STATUSES: SurveyStatus[] = ['assigned', 'in_progress']

/** Statuses where a design is still being worked on. */
export const DESIGN_WIP_STATUSES: DesignStatus[] = ['draft', 'under_review']

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Private buckets created in migration 0008. Objects live at '{parent_id}/{filename}'. */
export const SURVEY_MEDIA_BUCKET = 'survey-media'
export const DESIGN_FILES_BUCKET = 'design-files'

/**
 * How long a download link stays valid. Short on purpose: survey photos and
 * electricity bills are customer property, and a signed URL is a bearer token —
 * anyone holding it can read the file, so it should outlive the click and little
 * else. Both buckets are private; nothing is ever served from a public URL.
 */
export const SIGNED_URL_TTL_SECONDS = 300

/** Upload ceiling. Drone imagery and PDF bills are the large cases. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
