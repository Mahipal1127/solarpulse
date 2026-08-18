-- ---------------------------------------------------------------------------
-- 0014 — Marketing & Training department module
--
-- The pipeline's ENTRY POINT. Every prior module received a handoff from the one
-- upstream of it (Sales from a lead, Technical from a site visit, O&M from a closed
-- deal, DISCOM from a completed install). Marketing receives nothing — it originates
-- the work: content goes out, campaigns run, and a lead is born and handed to Sales.
-- That handoff (create_marketing_lead below) is the reason this module sits ahead of
-- Sales in the company workflow rather than being a purely internal function.
--
-- Three tiers, the shape every module since 0005 has reused:
--   CEO             → every row in the org, read-only in practice (service layer
--                     refuses writes from outside the department)
--   Marketing Manager → the whole department's content, campaigns, sessions
--   Marketing employee→ only what is assigned to them (own = assigned_to /
--                     managed_by / conducted_by, depending on the table)
--
-- THE SLUG IS 'marketing-training' (hyphen), seeded already in 0002 alongside the
-- other ten departments. This migration must NOT re-insert the department row — it
-- only adds the Manager role and its permissions, exactly as 0012/0013 do. Every
-- RLS check and requireDepartment() guard keys off that slug.
--
-- TWO tables break the standard three-tier shape, each for a documented reason:
--   ai_marketing_insights — WRITTEN by the CEO module's AI Marketing Officer (its
--     own code, using the service-role client which bypasses RLS), READ here by the
--     whole Marketing team. No authenticated-user INSERT policy exists, so a client
--     can never fabricate an insight; only acknowledge (an UPDATE) is granted.
--   leads (Sales' table) — Marketing gets a narrow INSERT-only grant so the lead
--     handoff can originate an unassigned inbound lead. It gets NO select/update, so
--     Marketing can create a Sales lead but never read or steer Sales' pipeline.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tables
--
-- Statuses stay as text with a documented value list rather than enums. Content and
-- campaign lifecycles are the kind of thing a growing team renames ('in_production'
-- today, 'shooting'/'editing' tomorrow); the blueprint itself is loose here ("etc."
-- lists), so a new state should be a value change, not a migration — the same call
-- 0005 made for lead.source. The two lifecycles that ARE closed and safety-relevant
-- (net metering, subsidy in 0013) got enums; these do not need that rigidity.
-- ---------------------------------------------------------------------------

create table content_calendar_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title           text not null,
  -- 'reel' | 'post' | 'story' | 'ad_creative'
  content_type    text not null,
  -- kept as a field rather than hardcoded: the blueprint flags Facebook/LinkedIn as
  -- future platforms, so a new one is a data change.
  platform        text not null default 'instagram',
  scheduled_date  date not null,
  -- 'planned' | 'in_production' | 'ready' | 'posted' | 'skipped'
  status          text not null default 'planned',
  -- The employee answerable for producing and posting it. NOT NULL: a calendar item
  -- nobody owns is one nobody is reminded about, which defeats the daily-reminder
  -- point of §3.1.
  assigned_to     uuid not null references users(id),
  caption_draft   text,
  notes           text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index content_calendar_org_date_idx on content_calendar_items (organization_id, scheduled_date);
create index content_calendar_assignee_idx  on content_calendar_items (assigned_to);
create index content_calendar_status_idx     on content_calendar_items (organization_id, status);

-- Assets for a calendar item: raw footage → edited video → final graphic. Scoped to
-- the org through content_calendar_item_id (no org column, like 0012's installation
-- child tables and 0013's history tables). The file lives in the private
-- marketing-assets bucket; this row is the metadata and the only way to discover the
-- file_path a signed URL is minted from.
create table content_assets (
  id                       uuid primary key default gen_random_uuid(),
  content_calendar_item_id uuid not null references content_calendar_items(id) on delete cascade,
  file_path                text not null,
  file_name                text not null,
  -- 'raw_footage' | 'edited_video' | 'graphic' | 'script' | 'thumbnail'
  asset_type               text,
  uploaded_by              uuid not null references users(id),
  created_at               timestamptz not null default now()
);

create index content_assets_item_idx on content_assets (content_calendar_item_id, created_at desc);

create table campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  -- 'lead_generation' | 'brand_awareness' | 'website_traffic'
  objective       text,
  -- 'instagram' | 'facebook' | 'google' | 'other'
  platform        text,
  -- 'planning' | 'active' | 'paused' | 'completed'
  status          text not null default 'planning',
  start_date      date,
  end_date        date,
  budget_amount   numeric(14, 2),
  -- Manually logged as spend data comes in from the ad platform (no live sync, per
  -- scope). numeric arrives from supabase-js as a string; the read layer Number()s it.
  amount_spent    numeric(14, 2) not null default 0,
  -- Denormalised counter, incremented by create_marketing_lead when a lead is
  -- originated against this campaign. The cost-per-lead column divides by it.
  leads_generated integer not null default 0,
  -- The employee running it. NOT NULL — same "someone must own it" rule as content.
  managed_by      uuid not null references users(id),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index campaigns_org_status_idx on campaigns (organization_id, status);
create index campaigns_manager_idx     on campaigns (managed_by);

-- The lead-origination record: which campaign or content produced which Sales lead.
-- It exists specifically so Marketing can trace a lead back to its source WITHOUT
-- bolting marketing columns onto Sales' leads table — the two modules' schemas stay
-- clean. lead_id points into Sales' table; campaign_id is nullable (organic content
-- has no campaign). This row is created inside create_marketing_lead, in the same
-- transaction as the lead itself.
create table lead_sources (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references organizations(id) on delete cascade,
  campaign_id              uuid references campaigns(id) on delete set null,
  content_calendar_item_id uuid references content_calendar_items(id) on delete set null,
  -- 'organic_reel' | 'paid_ad' | 'referral' | 'website_form' | 'walk_in'
  source_detail            text,
  lead_id                  uuid not null references leads(id) on delete cascade,
  created_by               uuid not null references users(id),
  created_at               timestamptz not null default now()
);

create index lead_sources_org_idx      on lead_sources (organization_id);
create index lead_sources_campaign_idx  on lead_sources (campaign_id);
create index lead_sources_content_idx   on lead_sources (content_calendar_item_id);
create index lead_sources_lead_idx      on lead_sources (lead_id);

-- Written by the CEO module's AI Marketing Officer (service-role client, bypasses
-- RLS), read by the whole Marketing team. This module never calls an AI provider or
-- analyses Instagram itself — it only consumes what that system leaves here. No
-- authenticated-user INSERT policy is granted below, so a client can never fabricate
-- an insight; acknowledge is the only write the team may do.
create table ai_marketing_insights (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  insight_date    date not null default current_date,
  summary         text not null,
  recommendation  text,
  source          text not null default 'ai_marketing_officer',
  acknowledged_by uuid references users(id),
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now()
);

create index ai_marketing_insights_org_idx on ai_marketing_insights (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers, reusing set_updated_at() from 0001
--
-- Only the four tables with a mutable lifecycle carry updated_at. Assets, lead
-- sources, attendance and insights are append-only facts (an insight's acknowledge
-- stamps its own acknowledged_at), so they have none — the same choice 0012/0013 made.
-- ---------------------------------------------------------------------------

create trigger content_calendar_items_set_updated_at
  before update on content_calendar_items
  for each row execute function set_updated_at();

create trigger campaigns_set_updated_at
  before update on campaigns
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers
--
-- security definer + a pinned search_path, same as every prior module: these read
-- `users`, itself under RLS, and would otherwise recurse.
-- ---------------------------------------------------------------------------

create or replace function auth_is_marketing_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'marketing-training'
  );
$$;

-- The department-wide tier.
--
-- Accepts 'Marketing Manager' or 'Marketing Lead', the same reasoning as
-- auth_is_discom_lead() (0013) and auth_is_om_lead() (0012): the build spec named
-- the role "Marketing Lead", but auth_is_department_manager() (0006) matches
-- name like '%Manager' and isDepartmentManager() (guards.ts) matches /\sManager$/,
-- so a bare "Marketing Lead" would receive no delegated CEO tasks. The seed at the
-- bottom creates 'Marketing Manager'; this honours either so a hand-made role works.
create or replace function auth_is_marketing_lead()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'marketing-training'
      and r.name in ('Marketing Manager', 'Marketing Lead')
  );
$$;

-- content_assets reaches the org and the owner through content_calendar_item_id.
create or replace function auth_content_item_in_org(p_item_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from content_calendar_items c
    where c.id = p_item_id and c.organization_id = auth_org_id()
  );
$$;

create or replace function auth_owns_content_item(p_item_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from content_calendar_items c
    where c.id = p_item_id
      and c.organization_id = auth_org_id()
      and c.assigned_to = auth.uid()
  );
$$;

-- campaign ownership, for lead_sources scoping (a member may file a source row for a
-- campaign they manage).
create or replace function auth_owns_campaign(p_campaign_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from campaigns c
    where c.id = p_campaign_id
      and c.organization_id = auth_org_id()
      and c.managed_by = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: content_calendar_items (own = assigned_to)
-- ---------------------------------------------------------------------------

alter table content_calendar_items enable row level security;

create policy "ceo_full_access_content" on content_calendar_items
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "marketing_lead_full_access_content" on content_calendar_items
  for all
  using (auth_is_marketing_lead() and organization_id = auth_org_id())
  with check (auth_is_marketing_lead() and organization_id = auth_org_id());

-- The individual tier. with-check reuses the using expression, so an employee cannot
-- reassign an item to someone else and keep editing it — verified by RLS rejection,
-- not UI filtering, per the acceptance checklist.
create policy "employee_own_content" on content_calendar_items
  for all
  using (
    auth_is_marketing_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  )
  with check (
    auth_is_marketing_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- RLS: content_assets (scoped through content_calendar_item_id)
-- ---------------------------------------------------------------------------

alter table content_assets enable row level security;

create policy "ceo_full_access_content_assets" on content_assets
  for all
  using (auth_is_ceo() and auth_content_item_in_org(content_calendar_item_id))
  with check (auth_is_ceo() and auth_content_item_in_org(content_calendar_item_id));

create policy "marketing_lead_full_access_content_assets" on content_assets
  for all
  using (auth_is_marketing_lead() and auth_content_item_in_org(content_calendar_item_id))
  with check (auth_is_marketing_lead() and auth_content_item_in_org(content_calendar_item_id));

create policy "employee_own_content_assets" on content_assets
  for all
  using (auth_is_marketing_member() and auth_owns_content_item(content_calendar_item_id))
  with check (auth_is_marketing_member() and auth_owns_content_item(content_calendar_item_id));

-- ---------------------------------------------------------------------------
-- RLS: campaigns (own = managed_by)
-- ---------------------------------------------------------------------------

alter table campaigns enable row level security;

create policy "ceo_full_access_campaigns" on campaigns
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "marketing_lead_full_access_campaigns" on campaigns
  for all
  using (auth_is_marketing_lead() and organization_id = auth_org_id())
  with check (auth_is_marketing_lead() and organization_id = auth_org_id());

create policy "employee_own_campaigns" on campaigns
  for all
  using (
    auth_is_marketing_member()
    and organization_id = auth_org_id()
    and managed_by = auth.uid()
  )
  with check (
    auth_is_marketing_member()
    and organization_id = auth_org_id()
    and managed_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- RLS: lead_sources
--
-- CEO and lead see the department's rows. A member may view/insert a source row for
-- a campaign OR content item they own — the trace-a-lead-to-its-generator point of
-- §3.4. The counter increment and the row insert both happen inside
-- create_marketing_lead as the caller, so the member policy has to admit them.
-- ---------------------------------------------------------------------------

alter table lead_sources enable row level security;

create policy "ceo_full_access_lead_sources" on lead_sources
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "marketing_lead_full_access_lead_sources" on lead_sources
  for all
  using (auth_is_marketing_lead() and organization_id = auth_org_id())
  with check (auth_is_marketing_lead() and organization_id = auth_org_id());

create policy "employee_own_lead_sources" on lead_sources
  for all
  using (
    auth_is_marketing_member()
    and organization_id = auth_org_id()
    and (
      (campaign_id is not null and auth_owns_campaign(campaign_id))
      or (content_calendar_item_id is not null and auth_owns_content_item(content_calendar_item_id))
    )
  )
  with check (
    auth_is_marketing_member()
    and organization_id = auth_org_id()
    and (
      (campaign_id is not null and auth_owns_campaign(campaign_id))
      or (content_calendar_item_id is not null and auth_owns_content_item(content_calendar_item_id))
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: ai_marketing_insights (read team-wide, acknowledge only, NO client insert)
--
-- The one table whose write rule differs from every other. It is populated by the
-- CEO module's AI system through the service-role client, which bypasses RLS — so
-- there is deliberately NO insert policy here. Any client insert therefore fails,
-- exactly what the acceptance checklist asks. The team may read and acknowledge; the
-- acknowledge is an UPDATE, and the service layer only ever writes the two
-- acknowledged_* columns through it.
-- ---------------------------------------------------------------------------

alter table ai_marketing_insights enable row level security;

-- Read: the whole Marketing team plus the CEO. This is team-wide intelligence, not
-- personal data, so there is no per-user narrowing.
create policy "marketing_read_ai_insights" on ai_marketing_insights
  for select
  using (
    (auth_is_marketing_member() or auth_is_ceo())
    and organization_id = auth_org_id()
  );

-- Acknowledge: an update the team may perform. No insert or delete policy exists, so
-- those commands are denied to every authenticated user regardless of role.
create policy "marketing_acknowledge_ai_insights" on ai_marketing_insights
  for update
  using (
    (auth_is_marketing_member() or auth_is_ceo())
    and organization_id = auth_org_id()
  )
  with check (
    (auth_is_marketing_member() or auth_is_ceo())
    and organization_id = auth_org_id()
  );

-- ---------------------------------------------------------------------------
-- Cross-module: Marketing's INSERT-only grant on Sales' leads
--
-- The handoff (§3.4) originates a Sales lead from Marketing. Marketing is not a Sales
-- member, so it has none of Sales' three lead policies (0005). This adds the single
-- narrow grant the handoff needs: a Marketing member may INSERT a lead into their own
-- org, and ONLY as an unassigned inbound lead (assigned_to is null). There is no
-- select/update/delete grant — Marketing can drop a lead into Sales' inbound queue
-- but can never read, reassign, or steer Sales' pipeline. A Sales manager picks the
-- lead up from there under Sales' own policies, matching Sales' existing convention
-- that a null-owner lead is one awaiting assignment (createLead defaults owned leads
-- to their creator, so null only ever means "inbound, unclaimed").
--
-- Because Marketing has no SELECT on leads, create_marketing_lead must NOT use
-- INSERT ... RETURNING (RETURNING applies the SELECT policy to the row and would
-- fail); it generates the id with gen_random_uuid() instead.
-- ---------------------------------------------------------------------------

create policy "marketing_insert_inbound_leads" on leads
  for insert
  with check (
    auth_is_marketing_member()
    and organization_id = auth_org_id()
    and assigned_to is null
  );

-- ---------------------------------------------------------------------------
-- create_marketing_lead(): atomic Marketing → Sales handoff
--
-- One transaction: insert the Sales lead (unassigned inbound), insert the linking
-- lead_sources row, and bump campaigns.leads_generated when a campaign was named.
-- Split across client calls, a mid-sequence failure would leave a lead with no
-- source trace or a counter out of step — the close_deal()/create_installation_
-- from_deal() precedent. Deliberately NOT security definer: it runs as the caller so
-- every write inside still passes RLS (the insert grant above, the lead_sources
-- member policy, and the campaign owner/lead policies for the increment).
--
-- The id is generated in-function rather than via RETURNING: Marketing has no SELECT
-- policy on leads, so INSERT ... RETURNING would trip the SELECT check.
-- ---------------------------------------------------------------------------

create or replace function create_marketing_lead(
  p_name                     text,
  p_phone                    text default null,
  p_source_detail            text default null,
  p_campaign_id              uuid default null,
  p_content_calendar_item_id uuid default null,
  p_notes                    text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_org_id  uuid := auth_org_id();
  v_lead_id uuid := gen_random_uuid();
begin
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Lead name is required';
  end if;

  -- A named campaign must belong to the caller's org and be one they can see. RLS on
  -- campaigns already restricts visibility; this turns an invisible id into a clear
  -- error rather than a silently skipped increment.
  if p_campaign_id is not null
     and not exists (select 1 from campaigns c where c.id = p_campaign_id and c.organization_id = v_org_id) then
    raise exception 'Campaign not found or not visible' using errcode = 'no_data_found';
  end if;

  if p_content_calendar_item_id is not null
     and not exists (
       select 1 from content_calendar_items ci
       where ci.id = p_content_calendar_item_id and ci.organization_id = v_org_id
     ) then
    raise exception 'Content item not found or not visible' using errcode = 'no_data_found';
  end if;

  -- Inbound, unassigned: source is the fixed 'marketing_campaign' string Sales
  -- already documents (0005), assigned_to left null for a Sales manager to claim.
  -- No RETURNING — the id is the one generated above.
  insert into leads (id, organization_id, name, phone, source, status, assigned_to, assigned_by, notes)
  values (v_lead_id, v_org_id, btrim(p_name), p_phone, 'marketing_campaign', 'new', null, null, p_notes);

  insert into lead_sources (organization_id, campaign_id, content_calendar_item_id, source_detail, lead_id, created_by)
  values (v_org_id, p_campaign_id, p_content_calendar_item_id, p_source_detail, v_lead_id, auth.uid());

  if p_campaign_id is not null then
    update campaigns set leads_generated = leads_generated + 1 where id = p_campaign_id;
  end if;

  return v_lead_id;
end;
$$;

revoke execute on function create_marketing_lead(text, text, text, uuid, uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- Storage: marketing-assets
--
-- Raw footage, edited videos, graphics, scripts. Objects live at
-- '{content_calendar_item_id}/{filename}' — the O&M shape (first segment is the
-- owning RECORD, not the org, unlike 0013's org-first documents). So the guard casts
-- foldername[1] to the item id and joins through it, exactly like install_object_
-- folder (0012). An object uploaded outside the convention has a non-uuid first
-- segment and matches nothing rather than erroring the policy.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('marketing-assets', 'marketing-assets', false)
on conflict (id) do nothing;

create or replace function marketing_object_item(object_name text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare folder text;
begin
  folder := (storage.foldername(object_name))[1];
  if folder is null then return null; end if;
  if folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return folder::uuid;
end;
$$;

create policy "marketing_assets_ceo_objects" on storage.objects
  for all
  using (
    bucket_id = 'marketing-assets'
    and auth_is_ceo()
    and auth_content_item_in_org(marketing_object_item(name))
  )
  with check (
    bucket_id = 'marketing-assets'
    and auth_is_ceo()
    and auth_content_item_in_org(marketing_object_item(name))
  );

create policy "marketing_assets_lead_objects" on storage.objects
  for all
  using (
    bucket_id = 'marketing-assets'
    and auth_is_marketing_lead()
    and auth_content_item_in_org(marketing_object_item(name))
  )
  with check (
    bucket_id = 'marketing-assets'
    and auth_is_marketing_lead()
    and auth_content_item_in_org(marketing_object_item(name))
  );

create policy "marketing_assets_member_objects" on storage.objects
  for all
  using (
    bucket_id = 'marketing-assets'
    and auth_is_marketing_member()
    and auth_owns_content_item(marketing_object_item(name))
  )
  with check (
    bucket_id = 'marketing-assets'
    and auth_is_marketing_member()
    and auth_owns_content_item(marketing_object_item(name))
  );

-- ---------------------------------------------------------------------------
-- Seed: Marketing Manager role + module permissions
--
-- 0002 seeds only CEO and '<Department> Executive'. The department-wide tier here
-- needs a role, named 'Marketing Manager' rather than the spec's 'Marketing Lead' so
-- auth_is_department_manager() (0006) and isDepartmentManager() (guards.ts) keep
-- working — see auth_is_marketing_lead() above for the full reasoning. Idempotent,
-- same shape as 0012/0013.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id            uuid;
  marketing_dept_id uuid;
  mgr_role_id       uuid;
  exec_role_id      uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into marketing_dept_id
    from departments
   where organization_id = org_id and slug = 'marketing-training';
  if marketing_dept_id is null then return; end if;

  select id into mgr_role_id
    from roles
   where organization_id = org_id and name = 'Marketing Manager';

  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, marketing_dept_id, 'Marketing Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array[
    'tasks','approvals','departments',
    'content_calendar','campaigns','lead_generation','ai_insights'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- 0002 names the default role '<dept.name> Executive', and this department's name
  -- is 'Marketing & Training' — so the role is 'Marketing & Training Executive', not
  -- 'Marketing Executive'. (DISCOM's dept name IS 'DISCOM', which is why 0013 could
  -- write 'DISCOM Executive' directly; the longer name here is the trap.)
  select id into exec_role_id
    from roles
   where organization_id = org_id and name = 'Marketing & Training Executive';

  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array[
      'content_calendar','campaigns','lead_generation','ai_insights'
    ]) as m
    on conflict (role_id, module) do nothing;
  end if;
end;
$$;
