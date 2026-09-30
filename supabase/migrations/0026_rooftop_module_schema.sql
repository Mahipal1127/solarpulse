-- ---------------------------------------------------------------------------
-- 0026 — Rooftop department module
--
-- The Rooftop department monitors normal customer site projects: which sites
-- have work live right now, which are done, and who the customer behind each
-- site is. It is a monitoring desk, not an execution pipeline — so unlike O&M
-- there is no team, no checklist and no inspection tier here. One project row
-- per customer site, and a running log of what happened on that site.
--
-- There is no separate "sites" table in this database: a site is an address,
-- represented plainly on installations.address (0012) and customers.address
-- (0005). This module keeps that convention — the site's location lives as
-- plain columns on the project row, next to the customer it belongs to.
--
-- Access tiers, matching 0005/0008/0012's shape:
--   CEO               → every row in the org, read-only in practice (the
--                       service layer refuses writes from outside the dept)
--   Rooftop Manager   → the whole department's sites and updates
--   Rooftop Executive → the whole department's sites and updates too:
--                       monitoring is the department's collective job, not a
--                       per-person queue, so there is no ownership clause.
--                       The tier difference lives in permissions (the manager
--                       can approve and export), not in row visibility.
--
-- THE SLUG IS 'rooftop' (single word, lowercase), seeded below. Every RLS
-- check and every requireDepartment() guard keys off it.
--
-- Statuses are enums, matching 0005/0007/0008/0012. 'live' vs 'done' from the
-- blueprint map to stored states: work happening now is 'active', finished
-- work is 'completed'. No derived-at-read-time states exist in this module —
-- nothing here is a function of the clock.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type rooftop_project_status as enum ('active', 'on_hold', 'completed', 'cancelled');

-- The kind of entry in a site's work log. 'issue' flags a problem seen on
-- site; 'resolved' closes one; 'handover' records the site being handed to
-- the customer. A handover is recorded explicitly rather than implying a
-- status change — marking the site 'completed' stays a separate, deliberate
-- act on the project itself.
create type rooftop_update_kind as enum ('progress', 'issue', 'resolved', 'handover');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table rooftop_projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  -- Sales' customer. A rooftop project always belongs to a real customer —
  -- the module exists to answer "what is happening at customer X's site".
  customer_id     uuid not null references customers(id),
  -- The site. Plain columns, matching the installations.address convention:
  -- a site is where the work physically is, not a row in another table.
  site_address    text not null,
  site_city       text,
  site_state      text,
  site_pincode    text,
  -- Installed / planned DC capacity, for the dashboard's total-capacity tile.
  capacity_kw     numeric(10, 2),
  status          rooftop_project_status not null default 'active',
  -- When the system went (or is expected to go) live at this site.
  go_live_date    date,
  notes           text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index rooftop_projects_org_status_idx      on rooftop_projects (organization_id, status);
create index rooftop_projects_customer_idx        on rooftop_projects (customer_id);
create index rooftop_projects_created_at_idx      on rooftop_projects (created_at desc);

create table rooftop_site_updates (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references rooftop_projects(id) on delete cascade,
  updated_by      uuid not null references users(id),
  kind            rooftop_update_kind not null default 'progress',
  note            text not null,
  created_at      timestamptz not null default now()
);

create index rooftop_site_updates_project_idx on rooftop_site_updates (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers (set_updated_at() comes from 0001)
-- ---------------------------------------------------------------------------

create trigger rooftop_projects_set_updated_at
  before update on rooftop_projects
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS helpers
--
-- security definer + a pinned search_path, same as every prior module: these
-- read `users`, itself under RLS, and would otherwise recurse.
-- ---------------------------------------------------------------------------

create or replace function auth_is_rooftop_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'rooftop'
  );
$$;

-- The department-wide tier. Accepts 'Rooftop Manager' or 'Rooftop Lead': the
-- seeded, working role is 'Rooftop Manager' because auth_is_department_manager()
-- (0006) matches name like '%Manager' and isDepartmentManager() in guards.ts
-- matches /\sManager$/ — the same reasoning as auth_is_om_lead() (0012). The
-- 'Rooftop Lead' spelling is honoured so a manually-created role still works.
create or replace function auth_is_rooftop_lead()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'rooftop'
      and r.name in ('Rooftop Manager', 'Rooftop Lead')
  );
$$;

-- Scoping for the site-updates log, which carries no organization_id of its
-- own: it reaches the org through its project, the way amc_visits reach it
-- through their contract (0012).
create or replace function auth_rooftop_project_in_org(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from rooftop_projects rp
    where rp.id = p_project_id and rp.organization_id = auth_org_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: rooftop_projects
--
-- Department-wide for members, deliberately: monitoring who is working where
-- is the whole point of the department, so no ownership clause exists. A
-- member who can see a site can log an update on it — same trust shape as a
-- Distribution employee seeing the whole PO queue.
-- ---------------------------------------------------------------------------

alter table rooftop_projects enable row level security;

create policy "ceo_full_access_rooftop_projects" on rooftop_projects
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "rooftop_lead_full_access_rooftop_projects" on rooftop_projects
  for all
  using (auth_is_rooftop_lead() and organization_id = auth_org_id())
  with check (auth_is_rooftop_lead() and organization_id = auth_org_id());

create policy "rooftop_member_access_rooftop_projects" on rooftop_projects
  for all
  using (auth_is_rooftop_member() and organization_id = auth_org_id())
  with check (auth_is_rooftop_member() and organization_id = auth_org_id());

-- ---------------------------------------------------------------------------
-- RLS: rooftop_site_updates (scoped through project_id)
-- ---------------------------------------------------------------------------

alter table rooftop_site_updates enable row level security;

create policy "ceo_full_access_rooftop_site_updates" on rooftop_site_updates
  for all
  using (auth_is_ceo() and auth_rooftop_project_in_org(project_id))
  with check (auth_is_ceo() and auth_rooftop_project_in_org(project_id));

create policy "rooftop_lead_full_access_rooftop_site_updates" on rooftop_site_updates
  for all
  using (auth_is_rooftop_lead() and auth_rooftop_project_in_org(project_id))
  with check (auth_is_rooftop_lead() and auth_rooftop_project_in_org(project_id));

create policy "rooftop_member_access_rooftop_site_updates" on rooftop_site_updates
  for all
  using (auth_is_rooftop_member() and auth_rooftop_project_in_org(project_id))
  with check (auth_is_rooftop_member() and auth_rooftop_project_in_org(project_id));

-- ---------------------------------------------------------------------------
-- Cross-department reads this module cannot work without
--
-- A rooftop project is created against a customer (Sales, 0005): the create
-- flow reads the customer to confirm it exists in this org before stamping
-- its id, and every project view reads the customer's name/phone/email to
-- show "the detail of Customer and Site both". Both run as the caller, so
-- RLS applies — without this select-only, org-scoped policy the module's
-- central flow dies, exactly the gap 0007/0008/0012 each hit and closed.
-- This module reads customers; it never writes them.
-- ---------------------------------------------------------------------------

create policy "rooftop_read_customers" on customers
  for select
  using (
    (auth_is_rooftop_member() or auth_is_rooftop_lead())
    and organization_id = auth_org_id()
  );

-- ---------------------------------------------------------------------------
-- Seed: the Rooftop department, its two roles, and their module permissions
--
-- 0002 seeds only CEO and '<Department> Executive' per department; the
-- department-wide tier here needs a manager role, named 'Rooftop Manager'
-- rather than 'Rooftop Lead' so auth_is_department_manager() (0006) and
-- isDepartmentManager() (guards.ts) keep working — the same reasoning the
-- O&M seed at the bottom of 0012 documents.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id        uuid;
  dept_id       uuid;
  mgr_role_id   uuid;
  exec_role_id  uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into dept_id
    from departments
   where organization_id = org_id and slug = 'rooftop';

  if dept_id is null then
    insert into departments (organization_id, name, slug)
    values (org_id, 'Rooftop', 'rooftop')
    returning id into dept_id;
  end if;

  select id into mgr_role_id
    from roles
   where organization_id = org_id and department_id = dept_id
     and name = 'Rooftop Manager';

  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, dept_id, 'Rooftop Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array['tasks','approvals','departments','rooftop']) as m
  on conflict (role_id, module) do nothing;

  select id into exec_role_id
    from roles
   where organization_id = org_id and department_id = dept_id
     and name = 'Rooftop Executive';

  if exec_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, dept_id, 'Rooftop Executive')
    returning id into exec_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select exec_role_id, m, true, true, true, false, false, false
  from unnest(array['rooftop']) as m
  on conflict (role_id, module) do nothing;
end;
$$;

