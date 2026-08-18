-- ---------------------------------------------------------------------------
-- 0012 — Operations & Maintenance department module
--
-- Installations (the receiving end of Technical's approved design + Sales' closed
-- deal), on-site team assignment, daily progress, photos, a per-install quality
-- checklist and final inspection, completion reports, service/complaint tickets
-- with mandatory service reports, AMC contracts and their visits, and manually
-- logged performance readings.
--
-- Three tiers, the shape Sales established in 0005 and Technical reused in 0008:
--   CEO             → every row in the org, read-only in practice (the service
--                     layer refuses writes from outside the department)
--   O&M Manager     → the whole department's installations, tickets and AMCs
--   O&M Technician  → only the work they are on
--
-- ONE STRUCTURAL DEPARTURE FROM SALES/TECHNICAL, required by the blueprint:
-- an installation has a TEAM, not a single assignee. So "own" here means
-- "team lead OR listed team member", not one assigned_to column — see
-- auth_owns_installation() below. service_tickets and amc_contracts keep the
-- familiar single-assignee shape (own = assigned_to).
--
-- THE SLUG IS 'operations-maintenance' (hyphen), seeded in 0002 alongside
-- 'marketing-training'. Every RLS check and every requireDepartment() guard keys
-- off it; an underscore would silently deny the whole department.
--
-- Statuses are enums, matching 0005/0007/0008. Two states the build spec lists as
-- status values are deliberately NOT stored, because they are functions of the
-- clock and this system computes such things at read time rather than storing a
-- value that goes stale (isOverdue/isTenderOverdue): an AMC's 'expiring_soon' and
-- 'expired' are derived from end_date, and a visit's 'missed' is derived from a
-- scheduled_date that has passed. Storing them too is how the dashboard's number
-- and the list's number drift apart. free-text lives only where the spec's value
-- list ends in "etc." (role_on_site, photo_stage, issue_type), the same reason
-- leads.source and survey_photos.photo_type were left open.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type installation_status as enum ('assigned', 'in_progress', 'completed', 'on_hold', 'cancelled');
create type inspection_result   as enum ('passed', 'passed_with_notes', 'failed');
create type service_ticket_status as enum ('open', 'assigned', 'in_progress', 'resolved', 'closed');
create type service_priority    as enum ('low', 'medium', 'high', 'urgent');
-- Stored lifecycle only. 'expiring_soon'/'expired' are derived from end_date at
-- read time (see the module note above), never written here.
create type amc_status          as enum ('active', 'cancelled');
-- Stored lifecycle only. 'missed' is derived from a passed scheduled_date.
create type amc_visit_status     as enum ('scheduled', 'completed', 'rescheduled');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table installations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  -- Technical's approved design. Nullable: an install can be logged standalone.
  design_id         uuid references designs(id),
  -- Sales' customer. An installation always belongs to a real customer.
  customer_id       uuid not null references customers(id),
  -- Denormalised pipeline pointer, so a report can trace lead → deal → install
  -- without re-joining. Nullable for the standalone case.
  deal_closure_id   uuid references deal_closures(id),
  -- Primary owner, accountable for the site. The team hangs off
  -- installation_team_members; this is the one person always answerable for it.
  team_lead_id      uuid not null references users(id),
  status            installation_status not null default 'assigned',
  scheduled_start_date date,
  actual_start_date date,
  completed_date    date,
  system_size_kw    numeric(10, 2),
  address           text,
  notes             text,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index installations_org_status_idx on installations (organization_id, status);
create index installations_team_lead_idx   on installations (team_lead_id);
create index installations_customer_idx    on installations (customer_id);
create index installations_design_idx      on installations (design_id);

create table installation_team_members (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  user_id         uuid not null references users(id),
  -- Free text: the spec's list ('electrician','helper','supervisor', ...) ends
  -- in "etc.", so an enum would be wrong. Site team composition varies.
  role_on_site    text,
  created_at      timestamptz not null default now(),
  -- A person is on a site's team once, not many times.
  unique (installation_id, user_id)
);

create index installation_team_members_install_idx on installation_team_members (installation_id);
create index installation_team_members_user_idx     on installation_team_members (user_id);

create table installation_progress_updates (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  updated_by      uuid not null references users(id),
  progress_percent int not null,
  note            text,
  created_at      timestamptz not null default now(),
  constraint installation_progress_percent_valid check (progress_percent between 0 and 100)
);

create index installation_progress_install_idx on installation_progress_updates (installation_id, created_at desc);

create table installation_photos (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  file_path       text not null,
  file_name       text not null,
  -- Free text: 'before','during','after','panel_mounting','wiring','final', ...
  photo_stage     text,
  uploaded_by     uuid not null references users(id),
  created_at      timestamptz not null default now()
);

create index installation_photos_install_idx on installation_photos (installation_id);

create table completion_reports (
  id                    uuid primary key default gen_random_uuid(),
  installation_id       uuid not null references installations(id) on delete cascade,
  submitted_by          uuid not null references users(id),
  summary               text not null,
  actual_system_size_kw numeric(10, 2),
  -- Optional uploaded PDF/doc if a formal report exists outside the app.
  report_file_path      text,
  created_at            timestamptz not null default now()
);

create index completion_reports_install_idx on completion_reports (installation_id);

create table installation_checklists (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  item            text not null,
  is_checked      boolean not null default false,
  checked_by      uuid references users(id),
  checked_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index installation_checklists_install_idx on installation_checklists (installation_id);

create table final_inspections (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  inspected_by    uuid not null references users(id),
  result          inspection_result not null,
  notes           text,
  inspected_at    timestamptz not null default now()
);

create index final_inspections_install_idx on final_inspections (installation_id);

create table service_tickets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  customer_id     uuid not null references customers(id),
  -- Nullable: a ticket can predate having the installation linked.
  installation_id uuid references installations(id),
  -- Staff member who logged the complaint (phone/WhatsApp relay), not the
  -- customer — there is no customer-facing portal in v1.
  raised_by       uuid not null references users(id),
  -- Free text: the spec's list ends in 'other', already open.
  issue_type      text,
  description     text not null,
  priority        service_priority not null default 'medium',
  status          service_ticket_status not null default 'open',
  assigned_to     uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index service_tickets_org_status_idx on service_tickets (organization_id, status);
create index service_tickets_assignee_idx    on service_tickets (assigned_to);
create index service_tickets_customer_idx     on service_tickets (customer_id);

create table service_reports (
  id                uuid primary key default gen_random_uuid(),
  service_ticket_id uuid not null references service_tickets(id) on delete cascade,
  reported_by       uuid not null references users(id),
  work_done         text not null,
  parts_used        text,
  resolved          boolean not null default false,
  created_at        timestamptz not null default now()
);

create index service_reports_ticket_idx on service_reports (service_ticket_id);

create table amc_contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  customer_id     uuid not null references customers(id),
  installation_id uuid references installations(id),
  start_date      date not null,
  end_date        date not null,
  -- Free text: 'quarterly','half_yearly','annual'.
  visit_frequency text,
  amount          numeric(14, 2),
  status          amc_status not null default 'active',
  -- Default engineer responsible for this AMC's visits.
  assigned_to     uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint amc_contracts_period_valid check (end_date >= start_date)
);

create index amc_contracts_org_status_idx on amc_contracts (organization_id, status);
create index amc_contracts_assignee_idx    on amc_contracts (assigned_to);
create index amc_contracts_end_date_idx     on amc_contracts (end_date);

create table amc_visits (
  id              uuid primary key default gen_random_uuid(),
  amc_contract_id uuid not null references amc_contracts(id) on delete cascade,
  scheduled_date  date not null,
  completed_date  date,
  performed_by    uuid references users(id),
  status          amc_visit_status not null default 'scheduled',
  notes           text,
  created_at      timestamptz not null default now()
);

create index amc_visits_contract_idx  on amc_visits (amc_contract_id);
create index amc_visits_scheduled_idx  on amc_visits (scheduled_date);
create index amc_visits_performer_idx  on amc_visits (performed_by);

create table performance_logs (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  logged_by       uuid not null references users(id),
  log_date        date not null,
  -- Manually recorded reading (customer-reported meter or app screenshot). This
  -- is explicitly NOT a telemetry pipeline — see the module scope notes.
  generation_kwh  numeric(12, 2),
  issue_flag      boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now()
);

create index performance_logs_install_idx on performance_logs (installation_id, log_date desc);
create index performance_logs_issue_idx    on performance_logs (installation_id) where issue_flag;

-- ---------------------------------------------------------------------------
-- updated_at triggers, reusing set_updated_at() from 0001
--
-- Only the three tables with a mutable lifecycle carry updated_at. The append-only
-- logs (progress, photos, reports, inspections, visits, performance) are historical
-- facts and have none, the same choice deal_closures made in 0005.
-- ---------------------------------------------------------------------------

create trigger installations_set_updated_at
  before update on installations
  for each row execute function set_updated_at();

create trigger service_tickets_set_updated_at
  before update on service_tickets
  for each row execute function set_updated_at();

create trigger amc_contracts_set_updated_at
  before update on amc_contracts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers
--
-- security definer + a pinned search_path, same as every prior module: these read
-- `users`, itself under RLS, and would otherwise recurse.
-- ---------------------------------------------------------------------------

create or replace function auth_is_om_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'operations-maintenance'
  );
$$;

-- The department-wide tier.
--
-- Accepts 'Operations & Maintenance Manager' or 'O&M Lead'. The build spec named
-- the role "O&M Lead", but auth_is_department_manager() (0006) matches name like
-- '%Manager' and isDepartmentManager() in guards.ts matches /\sManager$/ — an
-- "O&M Lead" role satisfies neither, so CEO-assigned unclaimed tasks would have
-- nobody to delegate them to. The seed at the bottom creates the '...Manager'
-- role to keep that convention intact; this also honours 'O&M Lead' so a
-- manually-created role still works inside this module. Exactly the reasoning in
-- auth_is_technical_lead() (0008).
create or replace function auth_is_om_lead()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'operations-maintenance'
      and r.name in ('Operations & Maintenance Manager', 'O&M Lead')
  );
$$;

-- Technician scoping for installations: THE TEAM CLAUSE. Unlike a lead (one owner)
-- or a survey (one engineer), an installation is worked by a team — so "own" is
-- team lead OR a listed team member. This is the one place this module's ownership
-- rule genuinely differs, and the acceptance checklist asks it be verified by RLS
-- rejection rather than UI filtering.
create or replace function auth_owns_installation(p_installation_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from installations i
    where i.id = p_installation_id
      and i.organization_id = auth_org_id()
      and (
        i.team_lead_id = auth.uid()
        or exists (
          select 1 from installation_team_members itm
          where itm.installation_id = i.id and itm.user_id = auth.uid()
        )
      )
  );
$$;

-- Lead/CEO scoping for tables hanging off an installation: it just has to be in
-- their org.
create or replace function auth_installation_in_org(p_installation_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from installations i
    where i.id = p_installation_id and i.organization_id = auth_org_id()
  );
$$;

-- service_reports reach the assignee through service_ticket_id.
create or replace function auth_owns_service_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from service_tickets t
    where t.id = p_ticket_id
      and t.organization_id = auth_org_id()
      and t.assigned_to = auth.uid()
  );
$$;

create or replace function auth_service_ticket_in_org(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from service_tickets t
    where t.id = p_ticket_id and t.organization_id = auth_org_id()
  );
$$;

-- amc_visits reach the assignee through amc_contract_id.
create or replace function auth_owns_amc(p_contract_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from amc_contracts c
    where c.id = p_contract_id
      and c.organization_id = auth_org_id()
      and c.assigned_to = auth.uid()
  );
$$;

create or replace function auth_amc_in_org(p_contract_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from amc_contracts c
    where c.id = p_contract_id and c.organization_id = auth_org_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: installations
-- ---------------------------------------------------------------------------

alter table installations enable row level security;

create policy "ceo_full_access_installations" on installations
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "om_lead_full_access_installations" on installations
  for all
  using (auth_is_om_lead() and organization_id = auth_org_id())
  with check (auth_is_om_lead() and organization_id = auth_org_id());

-- The individual tier: team lead or listed team member, and nothing else. Note
-- this reuses the using expression as the write check, so a technician may only
-- write rows they remain on the team of — they cannot hand an installation to
-- someone else and keep editing it.
create policy "technician_own_installations" on installations
  for all
  using (auth_is_om_member() and auth_owns_installation(id))
  with check (auth_is_om_member() and auth_owns_installation(id));

-- ---------------------------------------------------------------------------
-- RLS: installation child tables (team members, progress, photos, completion
-- reports, checklists, final inspections, performance logs)
--
-- All scoped through installation_id: CEO/lead see anything in-org, a technician
-- sees the rows for installations they are on. Identical shape to Technical's
-- survey_photos / generation_reports.
-- ---------------------------------------------------------------------------

alter table installation_team_members enable row level security;

create policy "ceo_full_access_team_members" on installation_team_members
  for all
  using (auth_is_ceo() and auth_installation_in_org(installation_id))
  with check (auth_is_ceo() and auth_installation_in_org(installation_id));

create policy "om_lead_full_access_team_members" on installation_team_members
  for all
  using (auth_is_om_lead() and auth_installation_in_org(installation_id))
  with check (auth_is_om_lead() and auth_installation_in_org(installation_id));

-- A full grant, not read-only: the team lead (an owner via team_lead_id) assembles
-- the crew from the installation detail page — Team Assignment in §3.2 — without
-- needing the department-lead role. auth_owns_installation gates it to the
-- installation's own team, so a technician can only touch the roster of a site they
-- are already on; they cannot add themselves to someone else's job (they are not an
-- owner of it, so the with-check fails).
create policy "technician_own_team_members" on installation_team_members
  for all
  using (auth_is_om_member() and auth_owns_installation(installation_id))
  with check (auth_is_om_member() and auth_owns_installation(installation_id));

alter table installation_progress_updates enable row level security;

create policy "ceo_full_access_progress" on installation_progress_updates
  for all
  using (auth_is_ceo() and auth_installation_in_org(installation_id))
  with check (auth_is_ceo() and auth_installation_in_org(installation_id));

create policy "om_lead_full_access_progress" on installation_progress_updates
  for all
  using (auth_is_om_lead() and auth_installation_in_org(installation_id))
  with check (auth_is_om_lead() and auth_installation_in_org(installation_id));

create policy "technician_own_progress" on installation_progress_updates
  for all
  using (auth_is_om_member() and auth_owns_installation(installation_id))
  with check (auth_is_om_member() and auth_owns_installation(installation_id));

alter table installation_photos enable row level security;

create policy "ceo_full_access_install_photos" on installation_photos
  for all
  using (auth_is_ceo() and auth_installation_in_org(installation_id))
  with check (auth_is_ceo() and auth_installation_in_org(installation_id));

create policy "om_lead_full_access_install_photos" on installation_photos
  for all
  using (auth_is_om_lead() and auth_installation_in_org(installation_id))
  with check (auth_is_om_lead() and auth_installation_in_org(installation_id));

create policy "technician_own_install_photos" on installation_photos
  for all
  using (auth_is_om_member() and auth_owns_installation(installation_id))
  with check (auth_is_om_member() and auth_owns_installation(installation_id));

alter table completion_reports enable row level security;

create policy "ceo_full_access_completion_reports" on completion_reports
  for all
  using (auth_is_ceo() and auth_installation_in_org(installation_id))
  with check (auth_is_ceo() and auth_installation_in_org(installation_id));

create policy "om_lead_full_access_completion_reports" on completion_reports
  for all
  using (auth_is_om_lead() and auth_installation_in_org(installation_id))
  with check (auth_is_om_lead() and auth_installation_in_org(installation_id));

create policy "technician_own_completion_reports" on completion_reports
  for all
  using (auth_is_om_member() and auth_owns_installation(installation_id))
  with check (auth_is_om_member() and auth_owns_installation(installation_id));

alter table installation_checklists enable row level security;

create policy "ceo_full_access_checklists" on installation_checklists
  for all
  using (auth_is_ceo() and auth_installation_in_org(installation_id))
  with check (auth_is_ceo() and auth_installation_in_org(installation_id));

create policy "om_lead_full_access_checklists" on installation_checklists
  for all
  using (auth_is_om_lead() and auth_installation_in_org(installation_id))
  with check (auth_is_om_lead() and auth_installation_in_org(installation_id));

create policy "technician_own_checklists" on installation_checklists
  for all
  using (auth_is_om_member() and auth_owns_installation(installation_id))
  with check (auth_is_om_member() and auth_owns_installation(installation_id));

-- Final inspection is a peer-check: typically done by the O&M Lead or a technician
-- other than the installer. A technician on the team may still read the result
-- (they need to see what failed), and may record one — the "different inspector"
-- convention is enforced in the UI/service layer, not as a hard DB gate, matching
-- the spec's "surface as outstanding, don't hard-block" stance.
alter table final_inspections enable row level security;

create policy "ceo_full_access_inspections" on final_inspections
  for all
  using (auth_is_ceo() and auth_installation_in_org(installation_id))
  with check (auth_is_ceo() and auth_installation_in_org(installation_id));

create policy "om_lead_full_access_inspections" on final_inspections
  for all
  using (auth_is_om_lead() and auth_installation_in_org(installation_id))
  with check (auth_is_om_lead() and auth_installation_in_org(installation_id));

create policy "technician_own_inspections" on final_inspections
  for all
  using (auth_is_om_member() and auth_owns_installation(installation_id))
  with check (auth_is_om_member() and auth_owns_installation(installation_id));

alter table performance_logs enable row level security;

create policy "ceo_full_access_performance_logs" on performance_logs
  for all
  using (auth_is_ceo() and auth_installation_in_org(installation_id))
  with check (auth_is_ceo() and auth_installation_in_org(installation_id));

create policy "om_lead_full_access_performance_logs" on performance_logs
  for all
  using (auth_is_om_lead() and auth_installation_in_org(installation_id))
  with check (auth_is_om_lead() and auth_installation_in_org(installation_id));

create policy "technician_own_performance_logs" on performance_logs
  for all
  using (auth_is_om_member() and auth_owns_installation(installation_id))
  with check (auth_is_om_member() and auth_owns_installation(installation_id));

-- ---------------------------------------------------------------------------
-- RLS: service_tickets
--
-- A shared queue, like Technical's it_support_tickets: the department triages and
-- assigns, so a technician sees the tickets assigned to them plus the open,
-- not-yet-assigned ones waiting to be picked up. CEO and lead see the whole queue.
-- ---------------------------------------------------------------------------

alter table service_tickets enable row level security;

create policy "ceo_full_access_service_tickets" on service_tickets
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "om_lead_full_access_service_tickets" on service_tickets
  for all
  using (auth_is_om_lead() and organization_id = auth_org_id())
  with check (auth_is_om_lead() and organization_id = auth_org_id());

-- A technician reads and works tickets assigned to them. They may also read (and
-- pick up) an unassigned ticket in their org — otherwise a triage queue nobody
-- can see is a queue nobody works. The with-check keeps a write landing on either
-- their own ticket or one they are claiming.
create policy "technician_own_service_tickets" on service_tickets
  for all
  using (
    auth_is_om_member()
    and organization_id = auth_org_id()
    and (assigned_to = auth.uid() or assigned_to is null)
  )
  with check (
    auth_is_om_member()
    and organization_id = auth_org_id()
    and (assigned_to = auth.uid() or assigned_to is null)
  );

-- ---------------------------------------------------------------------------
-- RLS: service_reports (scoped through service_ticket_id)
-- ---------------------------------------------------------------------------

alter table service_reports enable row level security;

create policy "ceo_full_access_service_reports" on service_reports
  for all
  using (auth_is_ceo() and auth_service_ticket_in_org(service_ticket_id))
  with check (auth_is_ceo() and auth_service_ticket_in_org(service_ticket_id));

create policy "om_lead_full_access_service_reports" on service_reports
  for all
  using (auth_is_om_lead() and auth_service_ticket_in_org(service_ticket_id))
  with check (auth_is_om_lead() and auth_service_ticket_in_org(service_ticket_id));

create policy "technician_own_service_reports" on service_reports
  for all
  using (auth_is_om_member() and auth_owns_service_ticket(service_ticket_id))
  with check (auth_is_om_member() and auth_owns_service_ticket(service_ticket_id));

-- ---------------------------------------------------------------------------
-- RLS: amc_contracts (own = assigned_to)
-- ---------------------------------------------------------------------------

alter table amc_contracts enable row level security;

create policy "ceo_full_access_amc_contracts" on amc_contracts
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "om_lead_full_access_amc_contracts" on amc_contracts
  for all
  using (auth_is_om_lead() and organization_id = auth_org_id())
  with check (auth_is_om_lead() and organization_id = auth_org_id());

create policy "technician_own_amc_contracts" on amc_contracts
  for all
  using (
    auth_is_om_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  )
  with check (
    auth_is_om_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- RLS: amc_visits (scoped through amc_contract_id)
-- ---------------------------------------------------------------------------

alter table amc_visits enable row level security;

create policy "ceo_full_access_amc_visits" on amc_visits
  for all
  using (auth_is_ceo() and auth_amc_in_org(amc_contract_id))
  with check (auth_is_ceo() and auth_amc_in_org(amc_contract_id));

create policy "om_lead_full_access_amc_visits" on amc_visits
  for all
  using (auth_is_om_lead() and auth_amc_in_org(amc_contract_id))
  with check (auth_is_om_lead() and auth_amc_in_org(amc_contract_id));

create policy "technician_own_amc_visits" on amc_visits
  for all
  using (auth_is_om_member() and auth_owns_amc(amc_contract_id))
  with check (auth_is_om_member() and auth_owns_amc(amc_contract_id));

-- ---------------------------------------------------------------------------
-- Cross-department reads this module cannot work without
--
-- Not in the build spec, but the conversion flow in §3.2 is impossible without
-- them, the same gap Technical hit with `leads` in 0008 and Distribution hit in
-- 0007. An installation is created from a won deal: the flow reads the customer
-- (Sales, 0005) and the design (Technical, 0008) to stamp their ids and the
-- org onto the new row, and it runs as the caller so those reads are subject to
-- RLS. Without these, close-to-install conversion raises "not found or not
-- visible" every time and the module's central handoff never completes.
--
-- Both are select-only and org-scoped — this module reads Sales' and Technical's
-- rows to originate its own work, it never writes them.
-- ---------------------------------------------------------------------------

create policy "om_read_customers" on customers
  for select
  using (
    (auth_is_om_member() or auth_is_om_lead())
    and organization_id = auth_org_id()
  );

-- Designs carry no organization_id; they reach the org through survey → lead,
-- the same path auth_design_in_org() walks. O&M only needs to read a design to
-- copy system_size_kw and link design_id, so a plain org-scoped read is enough.
create policy "om_read_designs" on designs
  for select
  using (
    (auth_is_om_member() or auth_is_om_lead())
    and auth_design_in_org(id)
  );

-- deal_closures are scoped through the lead's org (0005 has no org column on
-- them). Needed so the conversion can confirm the closure exists and read its
-- customer_id / final_amount context.
create policy "om_read_deal_closures" on deal_closures
  for select
  using (
    (auth_is_om_member() or auth_is_om_lead())
    and auth_lead_in_org(lead_id)
  );

-- ---------------------------------------------------------------------------
-- Storage
--
-- installation-media holds before/during/after photos and completion-report
-- files. Objects live at '{installation_id}/{filename}', the convention 0003
-- established and 0008 reused. The guarded uuid cast (install_object_folder)
-- matters: an object uploaded outside the convention has a non-uuid first segment
-- and must match nothing rather than error the whole policy.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('installation-media', 'installation-media', false)
on conflict (id) do nothing;

create or replace function install_object_folder(object_name text)
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

create policy "install_media_ceo_objects" on storage.objects
  for all
  using (
    bucket_id = 'installation-media'
    and auth_is_ceo()
    and auth_installation_in_org(install_object_folder(name))
  )
  with check (
    bucket_id = 'installation-media'
    and auth_is_ceo()
    and auth_installation_in_org(install_object_folder(name))
  );

create policy "install_media_lead_objects" on storage.objects
  for all
  using (
    bucket_id = 'installation-media'
    and auth_is_om_lead()
    and auth_installation_in_org(install_object_folder(name))
  )
  with check (
    bucket_id = 'installation-media'
    and auth_is_om_lead()
    and auth_installation_in_org(install_object_folder(name))
  );

create policy "install_media_technician_objects" on storage.objects
  for all
  using (
    bucket_id = 'installation-media'
    and auth_is_om_member()
    and auth_owns_installation(install_object_folder(name))
  )
  with check (
    bucket_id = 'installation-media'
    and auth_is_om_member()
    and auth_owns_installation(install_object_folder(name))
  );

-- ---------------------------------------------------------------------------
-- Atomic conversion: Sales' closed deal -> an O&M installation
--
-- One transaction, per §3.2: read the closure, its customer and (optionally) the
-- design, and create the installation with all three linked. Split across client
-- calls, a failure between them leaves a half-linked install.
--
-- NOT security definer, deliberately — the close_deal()/create_survey_from_visit_
-- request() pattern. It runs as the caller so RLS applies to every read and the
-- insert inside it, including the cross-department reads granted above. A definer
-- function here would be a hole straight through those policies.
--
-- Also seeds the standard quality checklist, so a fresh installation opens with
-- the common items (earthing, torque, cable routing, labelling) already listed
-- to tick off, per §3.3 — a seeded default, not a template builder.
-- ---------------------------------------------------------------------------

create or replace function create_installation_from_deal(
  p_deal_closure_id     uuid,
  p_team_lead_id        uuid,
  p_scheduled_start_date date default null,
  p_notes               text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_org_id      uuid;
  v_customer_id uuid;
  v_lead_id     uuid;
  v_design_id   uuid;
  v_size_kw     numeric(10, 2);
  v_install_id  uuid;
  v_item        text;
begin
  select dc.customer_id, dc.lead_id
    into v_customer_id, v_lead_id
    from deal_closures dc
   where dc.id = p_deal_closure_id
   for update of dc;

  -- Also the RLS answer: a closure this caller cannot see returns no row.
  if v_lead_id is null then
    raise exception 'Deal closure not found or not visible'
      using errcode = 'no_data_found';
  end if;

  if v_customer_id is null then
    raise exception 'This deal closure has no customer to install for'
      using errcode = 'check_violation';
  end if;

  select l.organization_id into v_org_id from leads l where l.id = v_lead_id;

  -- The most recent approved/sent design for this customer's lead, if any. The
  -- installation links back to it so the site team can pull the layout/SLD; a
  -- standalone install (no design) is still allowed, hence the left-ish lookup.
  select dg.id, dg.system_size_kw
    into v_design_id, v_size_kw
    from designs dg
    join site_surveys s on s.id = dg.survey_id
   where s.lead_id = v_lead_id
     and dg.status in ('approved', 'sent_to_sales')
   order by dg.created_at desc
   limit 1;

  insert into installations (
    organization_id, design_id, customer_id, deal_closure_id,
    team_lead_id, scheduled_start_date, system_size_kw, notes, created_by
  )
  values (
    v_org_id, v_design_id, v_customer_id, p_deal_closure_id,
    p_team_lead_id, p_scheduled_start_date, v_size_kw, p_notes, auth.uid()
  )
  returning id into v_install_id;

  -- Standard v1 checklist. Ad-hoc items can be added per install on top of these.
  foreach v_item in array array[
    'Earthing verified',
    'DC cable routing checked',
    'AC cable routing checked',
    'Structure torque-checked',
    'Panel mounting secure',
    'Inverter mounting and clearance',
    'DCDB/ACDB wiring and labelling',
    'Lightning arrestor / surge protection',
    'System powered on and generating',
    'Site cleaned and handed over'
  ] loop
    insert into installation_checklists (installation_id, item)
    values (v_install_id, v_item);
  end loop;

  return v_install_id;
end;
$$;

revoke execute on function create_installation_from_deal(uuid, uuid, date, text) from anon;

-- ---------------------------------------------------------------------------
-- Seed: Operations & Maintenance Manager role + module permissions
--
-- 0002 seeds only CEO and '<Department> Executive'. The department-wide tier here
-- needs a role, named 'Operations & Maintenance Manager' rather than the spec's
-- 'O&M Lead' so that auth_is_department_manager() (0006) and isDepartmentManager()
-- (guards.ts) keep working — see auth_is_om_lead() above for the full reasoning.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id       uuid;
  om_dept_id   uuid;
  mgr_role_id  uuid;
  exec_role_id uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into om_dept_id
    from departments
   where organization_id = org_id and slug = 'operations-maintenance';
  if om_dept_id is null then return; end if;

  select id into mgr_role_id
    from roles
   where organization_id = org_id and name = 'Operations & Maintenance Manager';

  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, om_dept_id, 'Operations & Maintenance Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array['tasks','approvals','departments','installations','service','amc','performance']) as m
  on conflict (role_id, module) do nothing;

  select id into exec_role_id
    from roles
   where organization_id = org_id and name = 'Operations & Maintenance Executive';

  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array['installations','service','amc','performance']) as m
    on conflict (role_id, module) do nothing;
  end if;
end;
$$;
