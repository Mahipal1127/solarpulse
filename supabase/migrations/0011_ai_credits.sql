-- ============================================================================
-- 0011 — Tokens become credits
-- ============================================================================
--
-- WHAT CHANGES
--   1. ai_settings.daily_token_limit  → daily_credit_limit
--   2. ai_usage_logs.tokens_used      → credits_used
--   3. ai_settings_public is rebuilt to expose the new name.
--
-- WHY RENAME RATHER THAN ADD
-- "Tokens" is the provider's billing unit leaking into a CEO's screen. Nobody
-- running a solar EPC company thinks in tokens, and the number is meaningless
-- without knowing which model produced it. "Credits" is the unit this product
-- charges in, so that is what the column should be called.
--
-- ONE CREDIT IS ONE TOKEN, FOR NOW
-- Deliberately a pure rename: no arithmetic, no backfill, no rescaling. A ratio
-- (say 1 credit = 1,000 tokens) would silently change the meaning of every limit
-- already stored — a CEO who set 100,000 would wake up with a hundredfold tighter
-- cap and no explanation. If a coarser unit is wanted later it is one constant in
-- lib/ai/credits.ts plus a data migration, and it should be a deliberate decision
-- rather than a side effect of renaming a column.
--
-- Existing rows therefore carry over exactly. Nothing in the history changes value.
--
-- ORDER MATTERS
-- This must run after 0010, which adds base_url — the view rebuilt at the bottom
-- selects that column. Applying 0011 against a database that has not seen 0010
-- will fail on the view, not silently produce a wrong one.
-- ============================================================================

-- ── 1 & 2. The renames ─────────────────────────────────────────────────────
--
-- `alter ... rename column` preserves the type, the not-null state, the default
-- and every existing value. There is no data movement here at all — Postgres
-- rewrites the catalog entry, so this is instant even on a large ai_usage_logs.
--
-- No IF EXISTS guard: Postgres does not support one on RENAME COLUMN, and a
-- guard is not wanted anyway. If daily_token_limit is already gone, this file has
-- already been applied and failing loudly is the correct outcome — quietly
-- succeeding would let a half-applied migration look complete.
alter table ai_settings  rename column daily_token_limit to daily_credit_limit;
alter table ai_usage_logs rename column tokens_used      to credits_used;

comment on column ai_settings.daily_credit_limit is
  'Credits the organisation may spend per day, or null for unlimited. One credit is one provider token today — see lib/ai/credits.ts.';

comment on column ai_usage_logs.credits_used is
  'Credits consumed by this call, counted from the provider''s own usage response. One credit is one token.';

-- ── 3. Rebuild the client-facing view ──────────────────────────────────────
--
-- DROP then CREATE, not CREATE OR REPLACE. Replace requires every existing column
-- to keep its name, type and position, so it cannot express a rename — it fails
-- with "cannot change name of view column". This is the one case where the
-- grant-preserving trick used in 0010 is unavailable.
--
-- Which means the grants have to be restored by hand, immediately below. Migration
-- 0010's comment noted that dropping this view would silently revoke them and the
-- settings page would start returning 401s; that hazard is now real rather than
-- hypothetical, so it is handled explicitly instead of trusted to Supabase's
-- default privileges.
drop view if exists ai_settings_public;

create view ai_settings_public
with (security_invoker = true)
as select id, organization_id, provider, model, is_enabled, daily_credit_limit,
          (encrypted_api_key is not null) as has_api_key, updated_by, updated_at,
          base_url
   from ai_settings;

-- security_invoker = true is load-bearing and easy to lose in a rebuild: without
-- it the view would run as its owner and hand every organisation's settings to
-- every caller, since ai_settings' RLS policies would no longer be evaluated
-- against the person asking. The key column stays out regardless — has_api_key is
-- a boolean over `is not null`, which is the entire reason this view exists.

-- Restoring what the DROP took away. `authenticated` is the role a signed-in
-- Supabase session assumes; RLS on ai_settings still decides which rows come back,
-- so this grant widens nothing beyond what policy already allows. anon is
-- deliberately not granted: there is no unauthenticated read of AI configuration.
grant select on ai_settings_public to authenticated;
grant select on ai_settings_public to service_role;
