-- ---------------------------------------------------------------------------
-- 0020 — Instagram account audit
--
-- WHAT THIS IS FOR
-- A Marketing member connects the company Instagram account, a local tool pulls that
-- profile's own posts and their public counters, and the AI reads the numbers this
-- module computes from them to describe the niche, the strategy, and what is and is
-- not working. Four tables:
--   1. instagram_accounts    — the connected profile and its headline counts
--   2. instagram_posts       — one row per post, the raw material for every metric
--   3. instagram_audits      — a generated audit, with the facts it was given
--   4. instagram_sync_tokens — how the local tool proves who it is
--
-- WHY NOT ai_marketing_insights (0014)
-- That table is a flat (summary, recommendation) pair written by the CEO module's AI
-- Marketing Officer, with no account, no posts, and no per-post metrics to stand on.
-- Its own comment says this module "never calls an AI provider or analyses Instagram
-- itself — it only consumes what that system leaves here". An audit is the opposite
-- shape: it is anchored to one account, derived from a body of posts that must be
-- stored to be recomputed, and re-run on demand. Widening that table would break the
-- insight feed the Marketing team and the CEO read today.
--
-- WHERE THE DATA COMES FROM, AND WHAT IS HONESTLY AVAILABLE
-- No Instagram API. A local tool (tools/instagram-audit) opens a real browser, the
-- OPERATOR logs into Instagram themselves, and the tool reads the profile's own grid.
-- That means:
--   * we get what a logged-in viewer of the profile can see — captions, hashtags,
--     media type, like and comment counts, video view counts, timestamps;
--   * we do NOT get reach, impressions, saves, shares or profile visits. Those live
--     behind the Professional dashboard's Insights panes and are not on the page the
--     tool reads. Every column below is a number a human could read off the screen.
-- The nullability of view_count and the ABSENCE of a reach column are therefore load
-- bearing, not an oversight — see the AI rule.
--
-- NO INSTAGRAM CREDENTIAL IS EVER STORED. There is no password column here and no
-- encrypted-secret column either, because the operator logs in interactively in their
-- own browser session. The same rule that keeps ERP passwords out of our tables and
-- out of audit-log metadata applies here, and this schema is what makes it structural
-- rather than a promise.
--
-- THE AI RULE, INHERITED FROM lib/ai/summary.ts
-- Every figure in an audit is computed in code from instagram_posts and handed to the
-- model finished; the model may only phrase it. instagram_audits.facts stores that
-- exact payload, so a reader can always check the narrative against the numbers it was
-- built from. A null in facts means "could not be read", never zero — the system
-- prompt is required to omit nulls rather than report them as no activity.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. instagram_accounts
-- ---------------------------------------------------------------------------

create table instagram_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- The handle, without the leading '@'. Lowercased by the service layer so
  -- 'SolarPulse' and 'solarpulse' cannot both be connected as separate accounts.
  username        text not null,

  -- Who connected it. on delete set null, not cascade: the account belongs to the
  -- company, so it must survive the employee who happened to link it leaving.
  connected_by    uuid references users(id) on delete set null,

  -- Profile fields, all nullable — a private or sparsely filled profile legitimately
  -- has no bio, no category and no link, and a null here must not read as "empty bio"
  -- when it actually means the tool could not see it.
  display_name    text,
  biography       text,
  category        text,
  external_url    text,
  is_professional boolean,

  -- Headline counts as of last_synced_at. Nullable for the window between connecting
  -- an account and the first successful sync, and after a sync that failed part-way.
  follower_count  integer,
  following_count integer,
  post_count      integer,

  -- 'never' | 'ok' | 'partial' | 'failed'. Plain text with a documented value list,
  -- matching the 0015/0016/0017/0019 convention: no new enum type and no check
  -- constraint, so adding a state later is an app change, not a column rewrite.
  sync_status     text not null default 'never',
  -- Operator-facing reason for the last non-ok sync. Never a stack trace, and never
  -- anything the operator typed into Instagram's login form.
  sync_error      text,
  last_synced_at  timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per handle per organization. Re-connecting the same account updates the
-- existing row rather than creating a second one that would split its post history.
create unique index instagram_accounts_org_username_idx
  on instagram_accounts (organization_id, lower(username));

create trigger instagram_accounts_set_updated_at
  before update on instagram_accounts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. instagram_posts
--
-- The audit's evidence. Stored rather than computed-and-discarded for two reasons: an
-- audit can be re-run with a different window without re-scraping, and a later sync
-- can show how a given post's counters moved.
-- ---------------------------------------------------------------------------

create table instagram_posts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id      uuid not null references instagram_accounts(id) on delete cascade,

  -- Instagram's own short id from the post URL (/p/{shortcode}/ or /reel/{shortcode}/).
  -- The natural key: stable across syncs, which is what makes the upsert below idempotent.
  shortcode       text not null,

  -- 'image' | 'carousel' | 'reel' | 'video'. Plain text, documented list, same
  -- convention as sync_status. Nullable because a grid tile whose type could not be
  -- determined is still worth keeping for its counters.
  media_type      text,
  -- For carousels, how many cards. Null for single-media posts.
  carousel_count  integer,

  caption         text,
  -- Extracted from the caption in code, lowercased, '#' stripped. An empty array means
  -- "read the caption, found none"; null means the caption itself could not be read.
  hashtags        text[],

  -- The counters. ALL nullable, and that is the point: Instagram hides like counts on
  -- some posts, and view_count exists only for video and reels. Null here must never be
  -- rendered or summarised as 0 — see the AI rule in the header.
  like_count      integer,
  comment_count   integer,
  view_count      integer,

  -- When the post was published, from the tile's own timestamp. Nullable, but a post
  -- without one is excluded from every time-based metric rather than bucketed as today.
  posted_at       timestamptz,

  -- When we last read this row's counters, so a stale post is visibly stale.
  scraped_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- The upsert target for a sync, and the guarantee that one post is one row.
create unique index instagram_posts_account_shortcode_idx
  on instagram_posts (account_id, shortcode);

-- Every metric query is "this account's posts, newest first, within a window".
create index instagram_posts_account_posted_idx
  on instagram_posts (account_id, posted_at desc nulls last);

-- ---------------------------------------------------------------------------
-- 3. instagram_audits
--
-- Append-only. An audit is a dated opinion about a body of posts; editing one after
-- the fact would make the stored facts stop matching the narrative, so there is no
-- updated_at and no update policy.
-- ---------------------------------------------------------------------------

create table instagram_audits (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id      uuid not null references instagram_accounts(id) on delete cascade,

  -- Who asked for it. set null for the same reason as connected_by.
  requested_by    uuid references users(id) on delete set null,

  -- The EXACT payload handed to the model: every figure, already computed. This is the
  -- audit trail for the AI rule — the narrative below can always be checked against it,
  -- and a figure that is not in here did not come from our data.
  facts           jsonb not null,

  -- The model's prose. Nullable, and null is a normal outcome, not an error: when AI is
  -- switched off or unreachable the facts are still worth storing, and unavailable_reason
  -- says why there are no words with them.
  narrative       text,
  unavailable_reason text,

  -- Provenance, not a quality judgement, exactly as employee_reports.ai_generated (0019).
  ai_generated    boolean not null default true,

  -- The window and sample the audit covers, denormalised out of facts so the list can be
  -- rendered and sorted without parsing jsonb.
  posts_analysed  integer not null default 0,
  window_start    date,
  window_end      date,

  created_at      timestamptz not null default now(),

  constraint instagram_audits_window_order
    check (window_end is null or window_start is null or window_end >= window_start)
);

create index instagram_audits_account_idx
  on instagram_audits (account_id, created_at desc);

create index instagram_audits_org_idx
  on instagram_audits (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. instagram_sync_tokens
--
-- The local tool runs on someone's laptop. It has no ERP session cookie, so it needs
-- some way to prove it is acting for a real Marketing member — this is that, and it is
-- deliberately the weakest possible credential that still works:
--   * opaque and random, generated app-side like qr_tokens.token (0018);
--   * SHORT LIVED — expires_at is minutes, not days;
--   * SINGLE USE — the sync route stamps used_at and a second attempt is refused;
--   * revocable by deleting the row.
-- It authorises exactly one thing: posting scraped Instagram data for this org. It is
-- not a session, it cannot read the ERP, and it grants nothing else.
--
-- NOTE THE ABSENCE OF POLICIES BELOW. RLS is enabled and NO policy is created, which
-- denies every authenticated client every command. Only the service-role client — used
-- by the route that issues a token after guarding on Marketing membership, and by the
-- route that validates one — can touch this table. That is the same reasoning 0018
-- gives for granting employees no SELECT on qr_tokens, carried to its conclusion: a
-- table of live credentials should not be listable from a browser at all.
-- ---------------------------------------------------------------------------

create table instagram_sync_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- The member the token acts for. cascade, not set null: a token that belongs to
  -- nobody must not remain usable.
  user_id         uuid not null references users(id) on delete cascade,

  -- Long random opaque string, globally unique so a presented value resolves to exactly
  -- one row. Never derived from the user id, the email, or anything guessable.
  token           text not null unique,

  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- The validation lookup is by token alone; unique already indexes it. This one supports
-- "clean up / show this user's outstanding tokens".
create index instagram_sync_tokens_user_idx
  on instagram_sync_tokens (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
--
-- Reads mirror ai_marketing_insights (0014) exactly — "(auth_is_marketing_member() or
-- auth_is_ceo()) and organization_id = auth_org_id()" — because this is the same kind
-- of thing: team-wide intelligence about the company's own channel, not personal data.
-- So there is no per-user narrowing, and the whole Marketing department plus the CEO
-- read all of it.
--
-- Writes are narrower than reads, in three tiers:
--   * instagram_accounts — a Marketing MEMBER may connect and disconnect. Connecting is
--     an ordinary act of running the channel, not a lead-only privilege.
--   * instagram_posts and instagram_audits — NO client write policy at all. Both are
--     written by server routes through the service-role client, which bypasses RLS,
--     after their own guard. This is the ai_marketing_insights rule and it exists for
--     the same reason: a client that could insert posts could fabricate the evidence an
--     audit is computed from, and a client that could insert an audit could publish a
--     narrative the numbers do not support.
--   * The CEO reads everything and writes nothing, matching every other module.
-- ---------------------------------------------------------------------------

alter table instagram_accounts enable row level security;
alter table instagram_posts enable row level security;
alter table instagram_audits enable row level security;
alter table instagram_sync_tokens enable row level security;

-- instagram_accounts ---------------------------------------------------------

create policy "marketing_read_instagram_accounts" on instagram_accounts
  for select
  using (
    (auth_is_marketing_member() or auth_is_ceo())
    and organization_id = auth_org_id()
  );

-- Connect. with-check repeats the org test so a member cannot file an account against
-- another organization.
create policy "marketing_connect_instagram_accounts" on instagram_accounts
  for insert
  with check (
    auth_is_marketing_member()
    and organization_id = auth_org_id()
  );

-- Rename or re-point a connected account. The sync route's own writes to the count and
-- sync_status columns go through the service client, so this policy exists for the UI's
-- sake, not the scraper's.
create policy "marketing_update_instagram_accounts" on instagram_accounts
  for update
  using (auth_is_marketing_member() and organization_id = auth_org_id())
  with check (auth_is_marketing_member() and organization_id = auth_org_id());

-- Disconnect. Cascades to posts and audits by design: disconnecting an account is
-- meant to leave nothing of it behind, which is also the only way a member can erase
-- scraped data — there is no per-post delete.
create policy "marketing_disconnect_instagram_accounts" on instagram_accounts
  for delete
  using (auth_is_marketing_member() and organization_id = auth_org_id());

-- instagram_posts ------------------------------------------------------------
-- Read only, for everyone. DELIBERATELY no insert, update or delete policy.

create policy "marketing_read_instagram_posts" on instagram_posts
  for select
  using (
    (auth_is_marketing_member() or auth_is_ceo())
    and organization_id = auth_org_id()
  );

-- instagram_audits -----------------------------------------------------------
-- Read only, for everyone. DELIBERATELY no insert, update or delete policy: an audit is
-- append-only server-written history.

create policy "marketing_read_instagram_audits" on instagram_audits
  for select
  using (
    (auth_is_marketing_member() or auth_is_ceo())
    and organization_id = auth_org_id()
  );

-- instagram_sync_tokens ------------------------------------------------------
-- No policy, on purpose. See the table's own comment above: RLS is enabled and nothing
-- is permitted, so every authenticated client is denied every command and only the
-- service-role client can read or write a live credential.
