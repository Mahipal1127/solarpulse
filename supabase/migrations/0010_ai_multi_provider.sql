-- ============================================================================
-- 0010 — Bring-your-own-key AI: Claude, OpenAI, Gemini, and any compatible gateway
-- ============================================================================
--
-- WHAT CHANGES
--   1. ai_provider gains 'compatible' — the OpenAI-dialect catch-all that covers
--      gateways (OpenRouter, LiteLLM, Together, Groq, a self-hosted vLLM) and any
--      other endpoint that speaks /v1/chat/completions.
--   2. ai_settings gains base_url — where to send the request, when it is not the
--      vendor's own default host.
--   3. ai_usage_logs.estimated_cost becomes nullable, because for a gateway or an
--      unrecognised model the app genuinely does not know the price.
--   4. ai_settings_public exposes base_url. It still never exposes the key.
--
-- WHY 'compatible' RATHER THAN A FREE-TEXT provider COLUMN
-- The column names the *wire dialect*, not the company — that is the only thing
-- the adapter has to branch on. Three dialects exist: Anthropic Messages, OpenAI
-- chat completions, and Gemini generateContent. Keeping it an enum means a typo
-- cannot reach the adapter factory, and 'compatible' is honest about what it is:
-- OpenAI's dialect pointed somewhere else.
--
-- ============================================================================

-- ── 1. The new enum label ──────────────────────────────────────────────────
--
-- Deliberately the only statement that mentions 'compatible' in this file.
-- Postgres refuses to *use* an enum label in the same transaction that added it
-- (it is not committed yet, so no index or default can reference it), and a
-- Supabase migration runs as one transaction. Writing the label into a DEFAULT or
-- a CHECK below would therefore fail at apply time. The application inserts it on
-- a later connection, which is a different transaction and is fine.
--
-- IF NOT EXISTS so re-running this file is harmless.
alter type ai_provider add value if not exists 'compatible';

-- ── 2. Where to send the request ───────────────────────────────────────────
--
-- Null means "use the vendor's documented default host", which is what every
-- existing row wants and why there is no backfill here. A value is only required
-- for provider = 'compatible', and that requirement is enforced in the API route
-- rather than by a CHECK constraint: the check would have had to name the new
-- enum label, which point 1 above explains is not possible in this transaction.
--
-- No format validation in the database either. The server validates this against
-- an allowlist of schemes and a block list of internal hosts before it is ever
-- fetched (lib/ai/baseUrl.ts) — a regex here would imply a guarantee it cannot
-- give, since the dangerous part of a URL is where it resolves, not how it looks.
alter table ai_settings
  add column if not exists base_url text;

comment on column ai_settings.base_url is
  'API base for the configured provider, e.g. https://openrouter.ai/api/v1. Null uses the vendor default. Validated in the application, not here.';

-- ── 3. A cost of zero must mean zero ───────────────────────────────────────
--
-- estimated_cost was `not null default 0`. Once a CEO can point this at a gateway
-- and type any model id, the price per token is frequently unknowable — and a
-- hardcoded 0 renders as "$0.0000", which reads as "this was free" rather than
-- "nobody knows". Null is the truthful value and the usage card renders it as an
-- em dash.
--
-- Existing rows keep their 0. Those were computed from a known price list, so
-- they are real zeros or real small numbers; there is no way to tell retroactively
-- which is which, and rewriting them to null would destroy good data to tidy up
-- the type.
alter table ai_usage_logs
  alter column estimated_cost drop not null,
  alter column estimated_cost drop default;

comment on column ai_usage_logs.estimated_cost is
  'Null when the model''s price is unknown (custom gateway or unrecognised model id). Zero means a genuinely zero-cost call.';

-- ── 4. The client-facing view ──────────────────────────────────────────────
--
-- create or replace rather than drop + create, on purpose: replace preserves the
-- grants Supabase put on this view, while a drop would silently revoke them and
-- the settings page would start 401-ing. Replace requires the existing columns to
-- keep their name, type and position, so base_url is appended at the end rather
-- than slotted in beside `model` where it reads more naturally.
--
-- has_api_key stays a boolean over `encrypted_api_key is not null`. That is the
-- whole point of this view: the CEO's own select must be able to say "a key is
-- configured" without the key crossing into a query result that ends up in the
-- browser. base_url is not a secret — it is a hostname the CEO typed — so it is
-- returned in full.
create or replace view ai_settings_public
with (security_invoker = true)
as select id, organization_id, provider, model, is_enabled, daily_token_limit,
          (encrypted_api_key is not null) as has_api_key, updated_by, updated_at,
          base_url
   from ai_settings;
