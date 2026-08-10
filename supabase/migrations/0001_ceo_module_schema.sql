-- Solar Pulse OS — CEO Module
-- Migration 0001: core schema, enums, triggers, RLS
--
-- Security model: RLS is the source of truth. Every table below has RLS enabled
-- and denies by default; the app-level role check in lib/auth/guards.ts is a
-- fast-fail UX layer only.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type task_priority as enum ('low', 'medium', 'high', 'urgent');
create type task_status   as enum ('pending', 'in_progress', 'delayed', 'completed', 'archived');
create type approval_type   as enum ('budget', 'purchase', 'leave', 'expense');
create type approval_status as enum ('pending', 'approved', 'rejected');
create type ai_provider   as enum ('openai', 'anthropic', 'google');
create type ai_command_status as enum ('proposed', 'confirmed', 'rejected', 'executed');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table departments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  parent_department_id uuid references departments(id) on delete set null,
  name                 text not null,
  slug                 text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, slug)
);

create table roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- null department_id = org-wide role (CEO)
  department_id   uuid references departments(id) on delete cascade,
  name            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table permissions (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references roles(id) on delete cascade,
  module      text not null,
  can_view    boolean not null default false,
  can_create  boolean not null default false,
  can_edit    boolean not null default false,
  can_delete  boolean not null default false,
  can_approve boolean not null default false,
  can_export  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (role_id, module)
);

-- users.id mirrors auth.users.id
create table users (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  department_id   uuid references departments(id) on delete set null,
  role_id         uuid not null references roles(id),
  full_name       text not null,
  email           text not null,
  phone           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table employees (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references users(id) on delete cascade,
  designation  text,
  date_joined  date,
  reporting_to uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CEO module tables
-- ---------------------------------------------------------------------------

create table tasks (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  title                  text not null,
  description            text,
  created_by             uuid not null references users(id),
  assigned_department_id uuid not null references departments(id),
  assigned_user_id       uuid references users(id) on delete set null,
  priority               task_priority not null default 'medium',
  status                 task_status not null default 'pending',
  due_date               timestamptz,
  progress_percent       int not null default 0 check (progress_percent between 0 and 100),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index tasks_org_status_idx on tasks (organization_id, status);
create index tasks_department_idx on tasks (assigned_department_id);
create index tasks_due_date_idx on tasks (due_date);

create table task_attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  file_path   text not null,
  file_name   text,
  uploaded_by uuid not null references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- append-only progress log; powers Live Progress Tracking
create table task_updates (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references tasks(id) on delete cascade,
  updated_by       uuid not null references users(id),
  note             text,
  progress_percent int check (progress_percent between 0 and 100),
  status           task_status,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index task_updates_task_idx on task_updates (task_id, created_at desc);

create table approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type            approval_type not null,
  requested_by    uuid not null references users(id),
  department_id   uuid not null references departments(id),
  amount          numeric(14, 2),
  description     text,
  status          approval_status not null default 'pending',
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index approvals_org_status_idx on approvals (organization_id, status);

-- daily rollup written by each department module; CEO dashboard reads only
create table department_reports (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references departments(id) on delete cascade,
  report_date    date not null,
  summary        text,
  tasks_completed int not null default 0,
  tasks_pending   int not null default 0,
  tasks_delayed   int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (department_id, report_date)
);

create table audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- null for system/AI-initiated actions
  user_id         uuid references users(id) on delete set null,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  metadata        jsonb not null default '{}'::jsonb,
  ip_address      text,
  created_at      timestamptz not null default now()
);

create index audit_logs_org_created_idx on audit_logs (organization_id, created_at desc);

create table ai_settings (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null unique references organizations(id) on delete cascade,
  provider          ai_provider not null default 'anthropic',
  model             text not null default 'claude-sonnet-5',
  is_enabled        boolean not null default false,
  -- encrypted at rest; never selected by any client-side query
  encrypted_api_key text,
  daily_token_limit int,
  updated_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table ai_usage_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  tokens_used     int not null default 0,
  estimated_cost  numeric(12, 6) not null default 0,
  prompt_summary  text,
  created_at      timestamptz not null default now()
);

create index ai_usage_org_created_idx on ai_usage_logs (organization_id, created_at desc);

create table ai_command_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  raw_prompt      text not null,
  proposed_action jsonb not null,
  status          ai_command_status not null default 'proposed',
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz
);

create table sessions_meta (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  device_info text,
  ip_address  text,
  login_at    timestamptz not null default now(),
  logout_at   timestamptz
);

create index sessions_meta_user_idx on sessions_meta (user_id, login_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','departments','roles','permissions','users','employees',
    'tasks','task_attachments','task_updates','approvals','department_reports',
    'ai_settings'
  ] loop
    execute format(
      'create trigger set_updated_at_%1$s before update on %1$I
         for each row execute function set_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper functions used by RLS policies
--
-- security definer + a fixed search_path so policies can read `users`/`roles`
-- without recursing through those tables' own RLS.
-- ---------------------------------------------------------------------------

create or replace function auth_is_ceo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from users u
    join roles r on r.id = u.role_id
    where u.id = auth.uid()
      and u.is_active
      and r.name = 'CEO'
  );
$$;

create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.organization_id from users u where u.id = auth.uid();
$$;

create or replace function auth_department_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.department_id from users u where u.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Enabling RLS with no matching policy = deny. Anything not granted below is
-- rejected, including for the CEO.
-- ---------------------------------------------------------------------------

alter table organizations      enable row level security;
alter table departments        enable row level security;
alter table roles              enable row level security;
alter table permissions        enable row level security;
alter table users              enable row level security;
alter table employees          enable row level security;
alter table tasks              enable row level security;
alter table task_attachments   enable row level security;
alter table task_updates       enable row level security;
alter table approvals          enable row level security;
alter table department_reports enable row level security;
alter table audit_logs         enable row level security;
alter table ai_settings        enable row level security;
alter table ai_usage_logs      enable row level security;
alter table ai_command_log     enable row level security;
alter table sessions_meta      enable row level security;

-- organizations ------------------------------------------------------------

create policy "ceo_full_access_organizations" on organizations
  for all
  using (auth_is_ceo() and id = auth_org_id())
  with check (auth_is_ceo() and id = auth_org_id());

create policy "members_view_own_organization" on organizations
  for select using (id = auth_org_id());

-- departments --------------------------------------------------------------

create policy "ceo_full_access_departments" on departments
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "members_view_departments" on departments
  for select using (organization_id = auth_org_id());

-- roles / permissions ------------------------------------------------------

create policy "ceo_full_access_roles" on roles
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "members_view_roles" on roles
  for select using (organization_id = auth_org_id());

create policy "ceo_full_access_permissions" on permissions
  for all
  using (auth_is_ceo() and exists (
    select 1 from roles r where r.id = permissions.role_id and r.organization_id = auth_org_id()))
  with check (auth_is_ceo() and exists (
    select 1 from roles r where r.id = permissions.role_id and r.organization_id = auth_org_id()));

create policy "members_view_own_permissions" on permissions
  for select using (exists (
    select 1 from users u where u.id = auth.uid() and u.role_id = permissions.role_id));

-- users --------------------------------------------------------------------

create policy "ceo_full_access_users" on users
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "members_view_org_users" on users
  for select using (organization_id = auth_org_id());

create policy "members_update_own_user" on users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- employees ----------------------------------------------------------------
-- HR-owned; CEO reads, employees read their own row. No department-wide read:
-- designation/reporting lines are personal fields.

create policy "ceo_full_access_employees" on employees
  for all
  using (auth_is_ceo() and exists (
    select 1 from users u where u.id = employees.user_id and u.organization_id = auth_org_id()))
  with check (auth_is_ceo() and exists (
    select 1 from users u where u.id = employees.user_id and u.organization_id = auth_org_id()));

create policy "members_view_own_employee_row" on employees
  for select using (user_id = auth.uid());

-- tasks --------------------------------------------------------------------

create policy "ceo_full_access_tasks" on tasks
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "department_view_own_tasks" on tasks
  for select
  using (
    organization_id = auth_org_id()
    and (assigned_department_id = auth_department_id() or assigned_user_id = auth.uid())
  );

create policy "department_update_own_tasks" on tasks
  for update
  using (
    organization_id = auth_org_id()
    and (assigned_department_id = auth_department_id() or assigned_user_id = auth.uid())
  )
  with check (
    organization_id = auth_org_id()
    and (assigned_department_id = auth_department_id() or assigned_user_id = auth.uid())
  );

-- task_attachments ---------------------------------------------------------

create policy "ceo_full_access_task_attachments" on task_attachments
  for all
  using (auth_is_ceo() and exists (
    select 1 from tasks t where t.id = task_attachments.task_id and t.organization_id = auth_org_id()))
  with check (auth_is_ceo() and exists (
    select 1 from tasks t where t.id = task_attachments.task_id and t.organization_id = auth_org_id()));

create policy "department_view_task_attachments" on task_attachments
  for select using (exists (
    select 1 from tasks t
    where t.id = task_attachments.task_id
      and t.organization_id = auth_org_id()
      and (t.assigned_department_id = auth_department_id() or t.assigned_user_id = auth.uid())));

create policy "department_add_task_attachments" on task_attachments
  for insert with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_attachments.task_id
        and t.organization_id = auth_org_id()
        and (t.assigned_department_id = auth_department_id() or t.assigned_user_id = auth.uid())));

-- task_updates (append-only: no update/delete policy for anyone) ------------

create policy "ceo_view_task_updates" on task_updates
  for select using (auth_is_ceo() and exists (
    select 1 from tasks t where t.id = task_updates.task_id and t.organization_id = auth_org_id()));

create policy "ceo_insert_task_updates" on task_updates
  for insert with check (
    auth_is_ceo()
    and updated_by = auth.uid()
    and exists (select 1 from tasks t where t.id = task_updates.task_id and t.organization_id = auth_org_id()));

create policy "department_view_task_updates" on task_updates
  for select using (exists (
    select 1 from tasks t
    where t.id = task_updates.task_id
      and t.organization_id = auth_org_id()
      and (t.assigned_department_id = auth_department_id() or t.assigned_user_id = auth.uid())));

create policy "department_insert_task_updates" on task_updates
  for insert with check (
    updated_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_updates.task_id
        and t.organization_id = auth_org_id()
        and (t.assigned_department_id = auth_department_id() or t.assigned_user_id = auth.uid())));

-- approvals ----------------------------------------------------------------
-- Only the CEO may decide. Requesters may create and read their own department's.

create policy "ceo_full_access_approvals" on approvals
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "department_view_own_approvals" on approvals
  for select
  using (organization_id = auth_org_id()
     and (department_id = auth_department_id() or requested_by = auth.uid()));

create policy "department_create_approvals" on approvals
  for insert
  with check (organization_id = auth_org_id()
          and requested_by = auth.uid()
          and status = 'pending'
          and decided_by is null
          and decided_at is null);

-- department_reports -------------------------------------------------------
-- CEO reads all; departments write their own. CEO never writes (3.3).

create policy "ceo_view_department_reports" on department_reports
  for select using (auth_is_ceo() and exists (
    select 1 from departments d where d.id = department_reports.department_id and d.organization_id = auth_org_id()));

create policy "department_manage_own_reports" on department_reports
  for all
  using (department_id = auth_department_id())
  with check (department_id = auth_department_id());

-- audit_logs ---------------------------------------------------------------
-- CEO read-only. Nobody writes via the anon client: inserts go through the
-- service-role client in route handlers, which bypasses RLS.

create policy "ceo_read_audit_logs" on audit_logs
  for select using (auth_is_ceo() and organization_id = auth_org_id());

-- ai_settings / ai_command_log / ai_usage_logs — CEO only, no exceptions ----

create policy "ceo_only_select_ai_settings" on ai_settings
  for select using (auth_is_ceo() and organization_id = auth_org_id());
create policy "ceo_only_insert_ai_settings" on ai_settings
  for insert with check (auth_is_ceo() and organization_id = auth_org_id());
create policy "ceo_only_update_ai_settings" on ai_settings
  for update using (auth_is_ceo() and organization_id = auth_org_id())
             with check (auth_is_ceo() and organization_id = auth_org_id());
create policy "ceo_only_delete_ai_settings" on ai_settings
  for delete using (auth_is_ceo() and organization_id = auth_org_id());

-- Defence in depth: even a CEO-role select must not return the key column.
-- Anything client-facing reads this view instead; the base table's key column
-- is only ever read by the service-role client inside route handlers.
create view ai_settings_public
with (security_invoker = true)
as select id, organization_id, provider, model, is_enabled, daily_token_limit,
          (encrypted_api_key is not null) as has_api_key, updated_by, updated_at
   from ai_settings;

create policy "ceo_only_select_ai_command_log" on ai_command_log
  for select using (auth_is_ceo() and organization_id = auth_org_id());
create policy "ceo_only_insert_ai_command_log" on ai_command_log
  for insert with check (auth_is_ceo() and organization_id = auth_org_id() and user_id = auth.uid());
create policy "ceo_only_update_ai_command_log" on ai_command_log
  for update using (auth_is_ceo() and organization_id = auth_org_id())
             with check (auth_is_ceo() and organization_id = auth_org_id());
create policy "ceo_only_delete_ai_command_log" on ai_command_log
  for delete using (auth_is_ceo() and organization_id = auth_org_id());

create policy "ceo_only_select_ai_usage_logs" on ai_usage_logs
  for select using (auth_is_ceo() and organization_id = auth_org_id());

-- sessions_meta ------------------------------------------------------------

create policy "ceo_view_sessions_meta" on sessions_meta
  for select using (auth_is_ceo() and exists (
    select 1 from users u where u.id = sessions_meta.user_id and u.organization_id = auth_org_id()));

create policy "members_view_own_sessions" on sessions_meta
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage bucket for task attachments (private; RLS-governed)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

create policy "ceo_all_task_attachment_objects" on storage.objects
  for all
  using (bucket_id = 'task-attachments' and auth_is_ceo())
  with check (bucket_id = 'task-attachments' and auth_is_ceo());

create policy "members_read_task_attachment_objects" on storage.objects
  for select
  using (bucket_id = 'task-attachments' and auth.uid() is not null);
