-- Migration 0021: Marketing AI Creative
--
-- Four tables behind the "AI Creative" surface under Marketing → AI Insights, plus the
-- "AI Calendar" planner in the content calendar. All four are org-scoped and all four read
-- to "marketing member OR CEO", write to "marketing member" only — the same visibility the
-- IG-audit tables (0020) and ai_marketing_insights (0014) use, and the same reason: the CEO
-- reads everything in this department and writes nothing (isReadOnlyFor in guards.ts, RLS
-- here). Every table uses plain-text status/source columns with the value list documented in
-- a comment, not enums or check constraints — the 0015/0019/0020 convention.
--
-- WHAT "TRAINING DATA" MEANS HERE, PRECISELY.
-- The user asked that an approved script "go to training data so future scripts get more
-- refined". We do not fine-tune a model — that needs infrastructure we do not have and
-- thousands of examples. What we do instead genuinely refines output: an approved script is
-- copied into marketing_script_library as source 'ai_approved', and every later generation is
-- shown the org's own best approved scripts as worked examples ("write in this voice, this
-- hook style, this structure"). The refinement is real; it happens at write-time by example,
-- not by changing model weights. This is the same shape as every other AI feature in the app
-- — facts in, phrasing out — and it keeps the AI rule (lib/ai/summary.ts) intact: the model
-- is shown material, never trusted as the source of a fact.
--
-- THE AI RULE, RESTATED FOR THIS MODULE. marketing_scripts.facts and
-- marketing_content_plans.facts each store the EXACT context object handed to the model, so
-- the generated script or plan can always be checked against what it was written from. A
-- creative brief is more open-ended than a report, but the brand facts, the audit findings
-- and the reference scripts the model was given are still recorded and inspectable.

-- ===========================================================================
-- 1. marketing_brand_profile — the one-time brand form (one row per org)
-- ===========================================================================
--
-- The context the user said scripts should draw on "mainly": who we are, what we sell, who we
-- sell to, our voice, our offers, our SEO keywords. One row per org — a unique constraint on
-- organization_id, upserted through the service of the same name. Every field is nullable so
-- a half-filled form still saves and still helps; the generator omits blanks.
create table marketing_brand_profile (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_name   text,
  what_we_sell    text,
  target_audience text,
  -- Free text on purpose: "warm, plain-spoken, a bit cheeky" carries more than any enum could.
  tone_voice      text,
  key_offers      text,
  -- SEO / discovery focus — the words and phrases the team wants to rank and be found for.
  seo_keywords    text,
  -- Anything else the team wants the model to always know: geography, certifications, taboos.
  extra_notes     text,
  updated_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One brand profile per org. The upsert in lib/services/marketing-creative.ts targets this.
create unique index marketing_brand_profile_org_key on marketing_brand_profile (organization_id);

create trigger marketing_brand_profile_set_updated_at
  before update on marketing_brand_profile
  for each row execute function set_updated_at();

-- ===========================================================================
-- 2. marketing_script_library — reference material (the two upload lanes + approved AI)
-- ===========================================================================
--
-- The user asked for two upload bars: one for our own past scripts, one for competitors and
-- inspirations, "so AI can compare and make better scripts". Both land here, told apart by
-- `source`. Approved AI scripts are copied in as 'ai_approved' — that copy IS the "training
-- data" loop: the next generation reads this table for examples.
--
--   source:
--     'own'         — our own past scripts (upload bar 1); write like these, in this voice
--     'competitor'  — a competitor's script (upload bar 2); contrast, do not imitate
--     'inspiration' — a script we admire from anyone (upload bar 2); borrow structure/energy
--     'ai_approved' — an AI script the team approved; the refinement loop's reference set
create table marketing_script_library (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source          text not null default 'own',
  title           text not null,
  -- The script text itself. Capped in the Zod schema, not here, to keep this table dumb.
  body            text not null,
  -- 'reel' | 'post' | 'story' | 'other' — what kind of script this is, for like-with-like
  -- examples. Nullable: an uploaded reference need not declare its format.
  content_type    text,
  platform        text not null default 'instagram',
  -- For 'competitor'/'inspiration', whose it is or where it came from. Never a stored login.
  attribution     text,
  notes           text,
  -- When source = 'ai_approved', the marketing_scripts row it was promoted from, so the loop
  -- is traceable. on delete set null: deleting the origin draft must not delete the reference.
  origin_script_id uuid,
  added_by        uuid references users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index marketing_script_library_org_idx
  on marketing_script_library (organization_id, source, created_at desc);

-- ===========================================================================
-- 3. marketing_scripts — AI-generated scripts, with a generate → approve workflow
-- ===========================================================================
--
-- The user writes a brief, the model writes a script grounded in the brand profile, the
-- latest IG audit findings, and the reference library. The team reviews, edits, and either
-- approves (which promotes a copy into the library) or rejects.
--
--   status: 'draft' | 'approved' | 'rejected'
--   content_type: 'reel' | 'post'
--
-- facts jsonb is the EXACT context handed to the model (brand + audit summary + which
-- reference titles were shown). ai_generated is false when AI was off and the row is a
-- placeholder the team will write themselves — mirrors employee_reports.
create table marketing_scripts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  -- What the user asked for. The one genuinely free-form input to the generator.
  brief              text not null,
  content_type       text not null default 'reel',
  status             text not null default 'draft',
  facts              jsonb not null,
  -- The generated pieces, kept apart so the UI can show and copy each. All nullable: AI off,
  -- or a model that returned prose but no clean hashtag line, must still store a usable row.
  title              text,
  hook               text,
  script_body        text,
  caption            text,
  hashtags           text[],
  seo_keywords       text[],
  ai_generated       boolean not null default true,
  unavailable_reason text,
  requested_by       uuid references users(id) on delete set null,
  approved_by        uuid references users(id) on delete set null,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index marketing_scripts_org_idx on marketing_scripts (organization_id, status, created_at desc);

create trigger marketing_scripts_set_updated_at
  before update on marketing_scripts
  for each row execute function set_updated_at();

-- ===========================================================================
-- 4. marketing_content_plans — AI calendar proposals (propose → commit)
-- ===========================================================================
--
-- The "AI Calendar" button. The model proposes a week or a month of content; the team reviews
-- it in a panel and commits the items it wants, which then become real content_calendar_items
-- (owned by the committer, editable). Nothing touches the live calendar or anyone's reminders
-- until commit — the user's explicit choice ("Propose, then you commit").
--
--   range_kind: 'week' | 'month'
--   status:     'proposed' | 'committed' | 'discarded'
--
-- items jsonb is the proposed plan: an array of { day_offset, scheduled_date, content_type,
-- title, hook, caption_idea, rationale }. It stays on the plan row after commit as the record
-- of what was proposed, so a committed plan can be compared with what was actually scheduled.
create table marketing_content_plans (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  range_kind         text not null default 'week',
  start_date         date not null,
  end_date           date not null,
  -- Optional steer from the user ("push the subsidy offer", "we have a site launch Thursday").
  brief              text,
  status             text not null default 'proposed',
  facts              jsonb not null,
  items              jsonb not null default '[]'::jsonb,
  ai_generated       boolean not null default true,
  unavailable_reason text,
  created_by         uuid references users(id) on delete set null,
  committed_by       uuid references users(id) on delete set null,
  committed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint marketing_content_plans_range_order check (end_date >= start_date)
);

create index marketing_content_plans_org_idx
  on marketing_content_plans (organization_id, status, created_at desc);

create trigger marketing_content_plans_set_updated_at
  before update on marketing_content_plans
  for each row execute function set_updated_at();

-- ===========================================================================
-- RLS — marketing member OR CEO reads; marketing member writes; CEO writes nothing
-- ===========================================================================
--
-- Reuses auth_is_marketing_member(), auth_is_ceo(), auth_org_id() from 0001/0014. The read
-- policy is "(member or ceo) and same org"; writes are member-only, so the CEO's access to
-- this department stays read-only in the database, not merely in the UI. Identical shape to
-- the four IG-audit tables in 0020.

alter table marketing_brand_profile   enable row level security;
alter table marketing_script_library  enable row level security;
alter table marketing_scripts          enable row level security;
alter table marketing_content_plans    enable row level security;

-- --- marketing_brand_profile ----------------------------------------------
create policy "read_brand_profile" on marketing_brand_profile
  for select
  using ((auth_is_marketing_member() or auth_is_ceo()) and organization_id = auth_org_id());

create policy "member_write_brand_profile" on marketing_brand_profile
  for all
  using (auth_is_marketing_member() and organization_id = auth_org_id())
  with check (auth_is_marketing_member() and organization_id = auth_org_id());

-- --- marketing_script_library ---------------------------------------------
create policy "read_script_library" on marketing_script_library
  for select
  using ((auth_is_marketing_member() or auth_is_ceo()) and organization_id = auth_org_id());

create policy "member_write_script_library" on marketing_script_library
  for all
  using (auth_is_marketing_member() and organization_id = auth_org_id())
  with check (auth_is_marketing_member() and organization_id = auth_org_id());

-- --- marketing_scripts -----------------------------------------------------
-- Reads for member + CEO. Member INSERT/UPDATE/DELETE is allowed so the team can generate,
-- edit, approve and reject through the RLS client — facts is assembled server-side but the
-- write itself is authorised by this policy, so it is genuinely RLS-enforced rather than
-- slipped past through the service client. CEO gets no write, matching every Marketing path.
create policy "read_scripts" on marketing_scripts
  for select
  using ((auth_is_marketing_member() or auth_is_ceo()) and organization_id = auth_org_id());

create policy "member_write_scripts" on marketing_scripts
  for all
  using (auth_is_marketing_member() and organization_id = auth_org_id())
  with check (auth_is_marketing_member() and organization_id = auth_org_id());

-- --- marketing_content_plans -----------------------------------------------
create policy "read_content_plans" on marketing_content_plans
  for select
  using ((auth_is_marketing_member() or auth_is_ceo()) and organization_id = auth_org_id());

create policy "member_write_content_plans" on marketing_content_plans
  for all
  using (auth_is_marketing_member() and organization_id = auth_org_id())
  with check (auth_is_marketing_member() and organization_id = auth_org_id());
