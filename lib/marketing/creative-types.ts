/**
 * Marketing AI Creative — shared types.
 *
 * The row shapes for the four 0021 tables, the context objects handed to the model, and the
 * generator's return shapes. Kept in one file the client components and the server code both
 * import, so the "what the model saw" contract (the `facts` blobs) has exactly one definition.
 *
 * `| null` throughout means "not provided / could not be read", never a zero or an empty
 * claim — the same rule the rest of the AI code follows.
 */

// ---------------------------------------------------------------------------
// Enumerated string unions (plain-text columns, per the 0021 convention)
// ---------------------------------------------------------------------------

export type ScriptSource = 'own' | 'competitor' | 'inspiration' | 'ai_approved'
export type ScriptContentType = 'reel' | 'post'
export type ScriptStatus = 'draft' | 'approved' | 'rejected'
export type PlanRangeKind = 'week' | 'month'
export type PlanStatus = 'proposed' | 'committed' | 'discarded'

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface BrandProfile {
  id: string
  organization_id: string
  business_name: string | null
  what_we_sell: string | null
  target_audience: string | null
  tone_voice: string | null
  key_offers: string | null
  seo_keywords: string | null
  extra_notes: string | null
  updated_by: string | null
  updated_by_name: string | null
  created_at: string
  updated_at: string
}

export interface ScriptLibraryEntry {
  id: string
  source: ScriptSource
  title: string
  body: string
  content_type: string | null
  platform: string
  attribution: string | null
  notes: string | null
  origin_script_id: string | null
  added_by: string | null
  added_by_name: string | null
  created_at: string
}

export interface MarketingScript {
  id: string
  brief: string
  content_type: ScriptContentType
  status: ScriptStatus
  facts: ScriptFacts
  title: string | null
  hook: string | null
  script_body: string | null
  caption: string | null
  hashtags: string[] | null
  seo_keywords: string[] | null
  ai_generated: boolean
  unavailable_reason: string | null
  requested_by: string | null
  requested_by_name: string | null
  approved_by: string | null
  approved_by_name: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

/** One proposed calendar entry inside a content plan's `items` array. */
export interface PlanItem {
  /** 0-based day within the range; scheduled_date is the resolved calendar date. */
  day_offset: number
  scheduled_date: string
  content_type: ScriptContentType | 'story'
  title: string
  hook: string | null
  caption_idea: string | null
  rationale: string | null
}

export interface ContentPlan {
  id: string
  range_kind: PlanRangeKind
  start_date: string
  end_date: string
  brief: string | null
  status: PlanStatus
  facts: PlanFacts
  items: PlanItem[]
  ai_generated: boolean
  unavailable_reason: string | null
  created_by: string | null
  created_by_name: string | null
  committed_by: string | null
  committed_at: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Context handed to the model (stored verbatim in the `facts` columns)
// ---------------------------------------------------------------------------

/** The brand form, flattened to what the prompt needs. Blank fields are omitted upstream. */
export interface BrandContext {
  business_name: string | null
  what_we_sell: string | null
  target_audience: string | null
  tone_voice: string | null
  key_offers: string | null
  seo_keywords: string | null
  extra_notes: string | null
}

/**
 * The distilled findings from the org's latest Instagram audit — NOT the full facts blob.
 * Just the signals a script writer uses: niche words, which formats and times land, top
 * hashtags, and the honest engagement caveat. Null when no audit has been run.
 */
export interface AuditSignals {
  username: string
  as_of: string | null
  followers: number | null
  best_formats: string[]
  best_times_ist: string[]
  top_hashtags: string[]
  caption_keywords: string[]
  avg_engagement_rate_pct: number | null
  /** Verbatim from the audit's data_gaps, so the model repeats no metric it cannot see. */
  data_gaps: string[]
}

/** One reference script as the model is shown it. Body is truncated upstream. */
export interface ReferenceExample {
  source: ScriptSource
  title: string
  content_type: string | null
  attribution: string | null
  body: string
}

/** The full context object for a single script generation — stored as marketing_scripts.facts. */
export interface ScriptFacts {
  brief: string
  content_type: ScriptContentType
  brand: BrandContext | null
  audit: AuditSignals | null
  own_examples: ReferenceExample[]
  contrast_examples: ReferenceExample[]
  approved_examples: ReferenceExample[]
  /** True when at least one brand field or audit was available — drives the "thin context" note. */
  had_grounding: boolean
}

/** Context for a calendar plan — stored as marketing_content_plans.facts. */
export interface PlanFacts {
  range_kind: PlanRangeKind
  start_date: string
  end_date: string
  dates: string[]
  brief: string | null
  brand: BrandContext | null
  audit: AuditSignals | null
  /** Titles already on the calendar in/near the range, so the model does not repeat them. */
  existing_titles: string[]
}

// ---------------------------------------------------------------------------
// Generator return shapes
// ---------------------------------------------------------------------------

export interface GeneratedScript {
  title: string | null
  hook: string | null
  script_body: string | null
  caption: string | null
  hashtags: string[] | null
  seo_keywords: string[] | null
}

export interface ScriptGenerationResult {
  facts: ScriptFacts
  script: GeneratedScript | null
  unavailableReason: string | null
}

export interface PlanGenerationResult {
  facts: PlanFacts
  items: PlanItem[]
  unavailableReason: string | null
}
