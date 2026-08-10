-- ---------------------------------------------------------------------------
-- 0008 — Technical department module
--
-- Site surveys, designs (layout/SLD/BOQ), generation reports, technical queries,
-- product suggestions, IT support tickets, and a backup status log.
--
-- Three tiers, the same shape Sales established in 0005:
--   CEO               → every row in the org, read-only in practice (the service
--                       layer refuses writes from outside the department)
--   Technical Manager → the whole department's surveys and designs
--   Technical Exec    → only surveys assigned to them, and designs they authored
--
-- One deliberate departure from the module-scoped pattern used elsewhere,
-- required by the blueprint rather than incidental:
--
--   it_support_tickets is org-wide on insert. IT issues come from every
--   department — the Report button sits in every module's header — so any
--   authenticated member may raise a ticket and read their own; only Technical may
--   see or manage the whole queue.
--
-- Statuses are enums, not free-text check constraints, matching 0005 and 0007.
-- photo_type stays free text on purpose: the spec's list of values ends in
-- "etc.", the same reason leads.source was left open in 0005.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type survey_status          as enum ('assigned', 'in_progress', 'completed', 'cancelled');
create type design_status          as enum ('draft', 'under_review', 'approved', 'sent_to_sales');
create type it_ticket_status       as enum ('open', 'in_progress', 'resolved', 'closed');
create type it_issue_type          as enum ('erp_bug', 'software_access', 'hardware', 'data_backup', 'other');
create type backup_target          as enum ('database', 'storage');
create type backup_result          as enum ('success', 'failed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table site_surveys (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references organizations(id),
  -- Sales' handoff row. Nullable: a survey can also be logged standalone, with
  -- no Sales request behind it.
  site_visit_request_id       uuid references site_visit_requests(id),
  -- Denormalised on purpose, so Technical does not join through
  -- site_visit_requests on every read. Nullable for the standalone case.
  lead_id                     uuid references leads(id),
  assigned_engineer_id        uuid not null references users(id),
  scheduled_date              timestamptz,
  status                      survey_status not null default 'assigned',
  -- Deliberately jsonb rather than more columns: usable area, shading notes and
  -- orientation vary enough site to site that normalising them would mean a
  -- migration every time a surveyor needs a new field.
  roof_measurements           jsonb,
  gps_latitude                numeric(10, 7),
  gps_longitude              numeric(10, 7),
  electricity_bill_avg_units  numeric(12, 2),
  electricity_bill_file_path  text,
  is_drone_survey             boolean not null default false,
  notes                       text,
  created_by                  uuid not null references users(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- One survey per Sales request. Without this, two engineers converting the
  -- same request both succeed and the lead gets surveyed twice.
  unique (site_visit_request_id)
);

create index site_surveys_engineer_idx  on site_surveys (assigned_engineer_id);
create index site_surveys_lead_idx      on site_surveys (lead_id);
create index site_surveys_org_idx       on site_surveys (organization_id);
-- Backs the dashboard's "Sales asked, I haven't scheduled it" handoff queue.
create index site_surveys_handoff_idx   on site_surveys (status, scheduled_date)
  where site_visit_request_id is not null;

create table survey_photos (
  id          uuid primary key default gen_random_uuid(),
  survey_id   uuid not null references site_surveys(id) on delete cascade,
  file_path   text not null,
  file_name   text not null,
  -- Free text: the spec's value list ('roof_overview', 'shading_obstruction',
  -- 'meter_box', 'drone_aerial') ends in "etc.", so an enum would be wrong here.
  photo_type  text,
  uploaded_by uuid not null references users(id),
  created_at  timestamptz not null default now()
);

create index survey_photos_survey_idx on survey_photos (survey_id);

create table designs (
  id               uuid primary key default gen_random_uuid(),
  survey_id        uuid not null references site_surveys(id) on delete cascade,
  designed_by      uuid not null references users(id),
  system_size_kw   numeric(10, 2),
  panel_count      int,
  panel_wattage    numeric(10, 2),
  inverter_spec    text,
  -- Uploaded files, not drawings this app produces. This module records a design;
  -- it is not a CAD tool.
  layout_file_path text,
  sld_file_path    text,
  -- [{ "item": "panel", "qty": 20, "unit": "pcs" }, ...]
  boq_data         jsonb,
  status           design_status not null default 'draft',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index designs_survey_idx   on designs (survey_id);
create index designs_designer_idx on designs (designed_by);

create table generation_reports (
  id                              uuid primary key default gen_random_uuid(),
  design_id                       uuid not null references designs(id) on delete cascade,
  estimated_annual_generation_kwh numeric(14, 2),
  -- { "jan": 420, "feb": 460, ... } — optional month-by-month breakdown.
  estimated_monthly_generation_kwh jsonb,
  -- Set when the engineer ran the numbers in PVsyst/PVWatts and uploaded the
  -- output. Nothing in this system computes generation figures.
  report_file_path                text,
  generated_by                    uuid not null references users(id),
  created_at                      timestamptz not null default now()
);

create index generation_reports_design_idx on generation_reports (design_id);

create table it_support_tickets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  raised_by       uuid not null references users(id),
  issue_type      it_issue_type,
  description     text not null,
  status          it_ticket_status not null default 'open',
  assigned_to     uuid references users(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index it_support_tickets_raiser_idx   on it_support_tickets (raised_by);
create index it_support_tickets_assignee_idx on it_support_tickets (assigned_to);
create index it_support_tickets_org_idx      on it_support_tickets (organization_id);

-- A status log, not a scheduler. Automated backups were specified in the CEO
-- module's security blueprint as infrastructure (Supabase's own backup feature or
-- a cron job); this table only gives IT Support something to display. Nothing in
-- the app writes it — see the policies below, which grant no insert to anyone.
create table data_backup_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  backup_type     backup_target not null,
  status          backup_result not null,
  performed_at    timestamptz not null default now(),
  notes           text
);

create index data_backup_logs_org_time_idx on data_backup_logs (organization_id, performed_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers, reusing set_updated_at() from 0001
-- ---------------------------------------------------------------------------

create trigger site_surveys_set_updated_at
  before update on site_surveys
  for each row execute function set_updated_at();

create trigger designs_set_updated_at
  before update on designs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers
--
-- security definer + a pinned search_path, same as every prior module: these read
-- `users`, which is itself under RLS, and would otherwise recurse.
-- ---------------------------------------------------------------------------

create or replace function auth_is_technical_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'technical'
  );
$$;

-- The department-wide tier.
--
-- Accepts 'Technical Manager' or 'Technical Lead'. The build spec named the role
-- "Technical Lead", but auth_is_department_manager() (0006) matches `name like
-- '%Manager'` and isDepartmentManager() in guards.ts matches /\sManager$/ — a
-- role called "Technical Lead" satisfies neither, so CEO-assigned unclaimed tasks
-- would have no one to delegate them. The seed at the bottom creates 'Technical
-- Manager' to keep that convention intact; this function also honours 'Technical
-- Lead' so a manually-created role still works inside this module.
create or replace function auth_is_technical_lead()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'technical'
      and r.name in ('Technical Manager', 'Technical Lead')
  );
$$;

-- Executive scoping for tables hanging off a survey, which carry no assignee of
-- their own.
create or replace function auth_owns_survey(p_survey_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from site_surveys s
    where s.id = p_survey_id
      and s.assigned_engineer_id = auth.uid()
      and s.organization_id = auth_org_id()
  );
$$;

-- Lead/CEO scoping for the same child tables: the survey only has to be in their
-- org.
create or replace function auth_survey_in_org(p_survey_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from site_surveys s
    where s.id = p_survey_id and s.organization_id = auth_org_id()
  );
$$;

-- generation_reports reaches the assignee through design_id -> designs -> survey.
create or replace function auth_owns_design(p_design_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from designs dg
    join site_surveys s on s.id = dg.survey_id
    where dg.id = p_design_id
      and s.organization_id = auth_org_id()
      and (dg.designed_by = auth.uid() or s.assigned_engineer_id = auth.uid())
  );
$$;

create or replace function auth_design_in_org(p_design_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from designs dg
    join site_surveys s on s.id = dg.survey_id
    where dg.id = p_design_id and s.organization_id = auth_org_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: site_surveys
-- ---------------------------------------------------------------------------

alter table site_surveys enable row level security;

create policy "ceo_full_access_surveys" on site_surveys
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "technical_lead_full_access_surveys" on site_surveys
  for all
  using (auth_is_technical_lead() and organization_id = auth_org_id())
  with check (auth_is_technical_lead() and organization_id = auth_org_id());

-- The individual tier. Note this is narrower than the department: a Technical
-- executive sees surveys assigned to them and nothing else, which is what the
-- acceptance checklist asks be verified by RLS rejection rather than UI filtering.
create policy "engineer_own_surveys" on site_surveys
  for all
  using (
    auth_is_technical_member()
    and organization_id = auth_org_id()
    and assigned_engineer_id = auth.uid()
  )
  with check (
    auth_is_technical_member()
    and organization_id = auth_org_id()
    and assigned_engineer_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- RLS: survey_photos
-- ---------------------------------------------------------------------------

alter table survey_photos enable row level security;

create policy "ceo_full_access_survey_photos" on survey_photos
  for all
  using (auth_is_ceo() and auth_survey_in_org(survey_id))
  with check (auth_is_ceo() and auth_survey_in_org(survey_id));

create policy "technical_lead_full_access_survey_photos" on survey_photos
  for all
  using (auth_is_technical_lead() and auth_survey_in_org(survey_id))
  with check (auth_is_technical_lead() and auth_survey_in_org(survey_id));

create policy "engineer_own_survey_photos" on survey_photos
  for all
  using (auth_is_technical_member() and auth_owns_survey(survey_id))
  with check (auth_is_technical_member() and auth_owns_survey(survey_id));

-- ---------------------------------------------------------------------------
-- RLS: designs
-- ---------------------------------------------------------------------------

alter table designs enable row level security;

create policy "ceo_full_access_designs" on designs
  for all
  using (auth_is_ceo() and auth_survey_in_org(survey_id))
  with check (auth_is_ceo() and auth_survey_in_org(survey_id));

create policy "technical_lead_full_access_designs" on designs
  for all
  using (auth_is_technical_lead() and auth_survey_in_org(survey_id))
  with check (auth_is_technical_lead() and auth_survey_in_org(survey_id));

-- Either the surveying engineer or the design's author. A design is often drawn
-- by a Design Engineer from another engineer's survey, so scoping this to the
-- survey's assignee alone would lock the designer out of their own work.
--
-- auth_survey_in_org() is required on top of that, not redundant with it: on
-- insert, `designed_by = auth.uid()` is a value the caller supplies, so without
-- the org check a Technical member could create a design against any survey in
-- any tenant simply by naming themselves as its author.
create policy "engineer_own_designs" on designs
  for all
  using (
    auth_is_technical_member()
    and auth_survey_in_org(survey_id)
    and (designed_by = auth.uid() or auth_owns_survey(survey_id))
  )
  with check (
    auth_is_technical_member()
    and auth_survey_in_org(survey_id)
    and (designed_by = auth.uid() or auth_owns_survey(survey_id))
  );

-- ---------------------------------------------------------------------------
-- RLS: generation_reports
-- ---------------------------------------------------------------------------

alter table generation_reports enable row level security;

create policy "ceo_full_access_generation_reports" on generation_reports
  for all
  using (auth_is_ceo() and auth_design_in_org(design_id))
  with check (auth_is_ceo() and auth_design_in_org(design_id));

create policy "technical_lead_full_access_generation_reports" on generation_reports
  for all
  using (auth_is_technical_lead() and auth_design_in_org(design_id))
  with check (auth_is_technical_lead() and auth_design_in_org(design_id));

create policy "engineer_own_generation_reports" on generation_reports
  for all
  using (auth_is_technical_member() and auth_owns_design(design_id))
  with check (auth_is_technical_member() and auth_owns_design(design_id));

-- ---------------------------------------------------------------------------
-- RLS: it_support_tickets
--
-- THE DELIBERATE EXCEPTION. Every other table in this module is department-scoped;
-- this one is not, because ERP problems are reported by Sales, Finance, HR and
-- everyone else. Any authenticated org member may raise a ticket and read their
-- own; only Technical sees or manages the full queue.
--
-- Worth stating plainly, since it is the thing most likely to look like a bug to
-- someone reading these policies later: "org_member_*" here is intentional, not a
-- missing department check.
-- ---------------------------------------------------------------------------

alter table it_support_tickets enable row level security;

create policy "ceo_full_access_it_tickets" on it_support_tickets
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

-- Technical runs the queue: reads everything, updates anything.
create policy "technical_manage_it_tickets" on it_support_tickets
  for all
  using (auth_is_technical_member() and organization_id = auth_org_id())
  with check (auth_is_technical_member() and organization_id = auth_org_id());

create policy "org_member_raise_it_ticket" on it_support_tickets
  for insert
  with check (organization_id = auth_org_id() and raised_by = auth.uid());

-- Their own ticket only — not the queue. A Sales employee can follow the ticket
-- they filed and nothing else.
create policy "raiser_read_own_it_ticket" on it_support_tickets
  for select
  using (organization_id = auth_org_id() and raised_by = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: data_backup_logs
--
-- Read-only for the CEO and the Technical lead, and no insert policy for anyone:
-- these rows come from infrastructure (Supabase's backup feature or a cron job)
-- via the service-role client, which bypasses RLS. An app-writable backup log
-- would be a log that can be falsified from a browser.
-- ---------------------------------------------------------------------------

alter table data_backup_logs enable row level security;

create policy "ceo_read_backup_logs" on data_backup_logs
  for select
  using (auth_is_ceo() and organization_id = auth_org_id());

create policy "technical_lead_read_backup_logs" on data_backup_logs
  for select
  using (auth_is_technical_lead() and organization_id = auth_org_id());

-- ---------------------------------------------------------------------------
-- Cross-department reads this module cannot work without
--
-- Not in the build spec, but the conversion flow in §3.2 is impossible without
-- them. site_visit_requests carries no organization_id and its only policies
-- (0005) are Sales-scoped, so Technical currently cannot see the handoff it is
-- supposed to receive, let alone mark it scheduled. Same gap as `leads` in 0007.
--
-- Both are deliberately narrow: select on requests that are still open, and an
-- update that exists only so the conversion can set status = 'scheduled'.
-- ---------------------------------------------------------------------------

create policy "technical_read_site_visit_requests" on site_visit_requests
  for select
  using (
    (auth_is_technical_member() or auth_is_technical_lead())
    and auth_lead_in_org(lead_id)
  );

create policy "technical_schedule_site_visit_requests" on site_visit_requests
  for update
  using (
    (auth_is_technical_member() or auth_is_technical_lead())
    and auth_lead_in_org(lead_id)
  )
  with check (
    (auth_is_technical_member() or auth_is_technical_lead())
    and auth_lead_in_org(lead_id)
    -- Technical may move a request forward, never edit its substance. The
    -- with-check cannot see the old row, so the column-level guarantee comes from
    -- the trigger below.
    and status in ('scheduled', 'completed')
  );

-- A with-check expression cannot compare old to new, so the only way to hold
-- "Technical may change status and nothing else" is a before-update trigger.
create or replace function enforce_technical_site_visit_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Sales and the CEO keep full edit rights; this only constrains Technical.
  if auth_is_ceo() or auth_is_sales_member() then
    return new;
  end if;

  if auth_is_technical_member() or auth_is_technical_lead() then
    if new.lead_id        is distinct from old.lead_id
       or new.requested_by   is distinct from old.requested_by
       or new.preferred_date is distinct from old.preferred_date
       or new.notes          is distinct from old.notes then
      raise exception 'Technical may only update a site visit request''s status'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger site_visit_requests_technical_scope
  before update on site_visit_requests
  for each row execute function enforce_technical_site_visit_scope();

-- Surveys and the dashboard show the project name, and 0005 grants `leads` reads
-- to the CEO, Sales managers, and a lead's own assignee only. Without this every
-- project name in this module renders blank.
--
-- Two arms, and the second is load-bearing rather than cosmetic:
--
--   * a lead a survey already points at — what the lists and dashboard render;
--   * a lead with a site visit request Sales has raised — needed *before* any
--     survey exists. create_survey_from_visit_request() joins `leads` to read the
--     organization_id it stamps on the new survey, and it runs as the caller so
--     that read is subject to this policy. With only the first arm, that join
--     returns no row on every conversion and the function raises "not found or
--     not visible" — the module's central handoff could never complete once.
create policy "technical_read_survey_leads" on leads
  for select
  using (
    (auth_is_technical_member() or auth_is_technical_lead())
    and organization_id = auth_org_id()
    and (
      exists (select 1 from site_surveys s where s.lead_id = leads.id)
      or exists (select 1 from site_visit_requests r where r.lead_id = leads.id)
    )
  );

-- ---------------------------------------------------------------------------
-- Storage
--
-- Objects live at '{parent_id}/{filename}', the convention 0003 established for
-- tender documents. The guarded cast matters: an object uploaded outside the
-- convention has a non-uuid first segment, and must match nothing rather than
-- error the whole policy.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('survey-media', 'survey-media', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('design-files', 'design-files', false)
on conflict (id) do nothing;

create or replace function survey_object_folder(object_name text)
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

-- survey-media: the assigned engineer, the lead, or the CEO.
create policy "survey_media_ceo_objects" on storage.objects
  for all
  using (
    bucket_id = 'survey-media'
    and auth_is_ceo()
    and auth_survey_in_org(survey_object_folder(name))
  )
  with check (
    bucket_id = 'survey-media'
    and auth_is_ceo()
    and auth_survey_in_org(survey_object_folder(name))
  );

create policy "survey_media_lead_objects" on storage.objects
  for all
  using (
    bucket_id = 'survey-media'
    and auth_is_technical_lead()
    and auth_survey_in_org(survey_object_folder(name))
  )
  with check (
    bucket_id = 'survey-media'
    and auth_is_technical_lead()
    and auth_survey_in_org(survey_object_folder(name))
  );

create policy "survey_media_engineer_objects" on storage.objects
  for all
  using (
    bucket_id = 'survey-media'
    and auth_is_technical_member()
    and auth_owns_survey(survey_object_folder(name))
  )
  with check (
    bucket_id = 'survey-media'
    and auth_is_technical_member()
    and auth_owns_survey(survey_object_folder(name))
  );

-- design-files: same three tiers, scoped through the design.
create policy "design_files_ceo_objects" on storage.objects
  for all
  using (
    bucket_id = 'design-files'
    and auth_is_ceo()
    and auth_design_in_org(survey_object_folder(name))
  )
  with check (
    bucket_id = 'design-files'
    and auth_is_ceo()
    and auth_design_in_org(survey_object_folder(name))
  );

create policy "design_files_lead_objects" on storage.objects
  for all
  using (
    bucket_id = 'design-files'
    and auth_is_technical_lead()
    and auth_design_in_org(survey_object_folder(name))
  )
  with check (
    bucket_id = 'design-files'
    and auth_is_technical_lead()
    and auth_design_in_org(survey_object_folder(name))
  );

create policy "design_files_engineer_objects" on storage.objects
  for all
  using (
    bucket_id = 'design-files'
    and auth_is_technical_member()
    and auth_owns_design(survey_object_folder(name))
  )
  with check (
    bucket_id = 'design-files'
    and auth_is_technical_member()
    and auth_owns_design(survey_object_folder(name))
  );

-- ---------------------------------------------------------------------------
-- Atomic conversion: Sales' site visit request -> Technical's survey
--
-- One transaction, per §3.2: create the survey and mark the source request
-- scheduled together. Split across two client calls, a failure between them
-- leaves either a survey Sales never sees acknowledged, or a request marked
-- scheduled with no survey behind it.
--
-- NOT security definer, deliberately — the close_deal() pattern from 0005. It
-- runs as the caller so RLS applies to every write inside it, including the
-- cross-department update above. A definer function here would be a hole straight
-- through the policies it is supposed to respect.
-- ---------------------------------------------------------------------------

create or replace function create_survey_from_visit_request(
  p_request_id           uuid,
  p_assigned_engineer_id uuid,
  p_scheduled_date       timestamptz default null,
  p_notes                text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_org_id    uuid;
  v_lead_id   uuid;
  v_status    site_visit_status;
  v_survey_id uuid;
begin
  select l.organization_id, r.lead_id, r.status
    into v_org_id, v_lead_id, v_status
    from site_visit_requests r
    join leads l on l.id = r.lead_id
   where r.id = p_request_id
   for update of r;

  -- Also the RLS answer: a request this caller cannot see returns no row.
  if v_org_id is null then
    raise exception 'Site visit request not found or not visible'
      using errcode = 'no_data_found';
  end if;

  if v_status <> 'requested' then
    raise exception 'This site visit request is already %', v_status;
  end if;

  insert into site_surveys (
    organization_id, site_visit_request_id, lead_id,
    assigned_engineer_id, scheduled_date, notes, created_by
  )
  values (
    v_org_id, p_request_id, v_lead_id,
    p_assigned_engineer_id, p_scheduled_date, p_notes, auth.uid()
  )
  returning id into v_survey_id;

  update site_visit_requests
     set status = 'scheduled', updated_at = now()
   where id = p_request_id;

  return v_survey_id;
end;
$$;

revoke execute on function create_survey_from_visit_request(uuid, uuid, timestamptz, text) from anon;

-- ---------------------------------------------------------------------------
-- Seed: Technical Manager role + module permissions
--
-- 0002 seeds only CEO and '<Department> Executive'. The department-wide tier here
-- needs a role, and it is named 'Technical Manager' rather than the spec's
-- 'Technical Lead' so that auth_is_department_manager() (0006) and
-- isDepartmentManager() (guards.ts) keep working — see auth_is_technical_lead()
-- above for the full reasoning.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id       uuid;
  tech_dept_id uuid;
  mgr_role_id  uuid;
  exec_role_id uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into tech_dept_id
    from departments
   where organization_id = org_id and slug = 'technical';
  if tech_dept_id is null then return; end if;

  select id into mgr_role_id
    from roles
   where organization_id = org_id and name = 'Technical Manager';

  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, tech_dept_id, 'Technical Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array['tasks','approvals','departments','surveys','designs','generation_reports','it_support']) as m
  on conflict (role_id, module) do nothing;

  select id into exec_role_id
    from roles
   where organization_id = org_id and name = 'Technical Executive';

  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array['surveys','designs','generation_reports','it_support']) as m
    on conflict (role_id, module) do nothing;
  end if;
end;
$$;
