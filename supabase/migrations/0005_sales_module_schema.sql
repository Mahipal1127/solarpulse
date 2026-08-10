-- Solar Pulse OS — Sales Department Module
-- Migration 0005: leads, customers, follow-ups, site visits, quotations,
--                 proposals, deal closures, sales targets + three-tier RLS
--
-- Builds on 0001/0002. Reuses organizations / departments / roles / users /
-- audit_logs / tasks and the set_updated_at() trigger function — none of those
-- are redefined here.
--
-- The security model that matters in this module is THREE tiers, not two:
--
--   CEO            → full org-wide read/write
--   Sales Manager  → the whole Sales department's pipeline
--   Sales Executive→ only rows assigned to them
--
-- Getting that wrong in either direction is the failure mode called out in the
-- build spec: an executive seeing a colleague's pipeline (commission disputes),
-- or a manager unable to see their team (defeats the role). Child tables
-- (follow_ups, quotations, ...) have no assigned_to of their own, so executive
-- scoping is resolved through the parent lead via auth_owns_lead().

-- ---------------------------------------------------------------------------
-- Enums
--
-- Status fields become real enums, consistent with task_status / tender_status
-- in earlier migrations. `source` stays free text: the spec's list ends in
-- "etc.", so it is deliberately open.
-- ---------------------------------------------------------------------------

create type lead_status as enum (
  'new', 'contacted', 'site_visit_scheduled', 'quotation_sent',
  'proposal_sent', 'negotiation', 'won', 'lost'
);

create type property_type      as enum ('residential', 'commercial', 'industrial');
create type follow_up_type     as enum ('call', 'meeting', 'email', 'site_visit_reminder');
create type follow_up_status   as enum ('pending', 'completed', 'missed');
create type site_visit_status  as enum ('requested', 'scheduled', 'completed', 'cancelled');
create type quotation_status   as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');
create type proposal_status    as enum ('draft', 'sent', 'accepted', 'rejected');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table leads (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  name              text not null,
  phone             text,
  email             text,
  -- 'referral' | 'website' | 'walk_in' | 'marketing_campaign' | 'cold_call' | ...
  source            text,
  property_type     property_type,
  -- rough system size interest, if known this early
  estimated_load_kw numeric(10, 2),
  status            lead_status not null default 'new',
  -- the Sales employee who owns this lead; RLS keys executive access off this
  assigned_to       uuid references users(id) on delete set null,
  assigned_by       uuid references users(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index leads_org_status_idx  on leads (organization_id, status);
create index leads_assigned_to_idx on leads (assigned_to);
create index leads_created_at_idx  on leads (created_at desc);

create table customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- nullable: a customer usually originates from a won lead, but direct entry
  -- is allowed
  lead_id         uuid references leads(id) on delete set null,
  name            text not null,
  phone           text,
  email           text,
  address         text,
  assigned_to     uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index customers_org_idx         on customers (organization_id);
create index customers_lead_idx        on customers (lead_id);
create index customers_assigned_to_idx on customers (assigned_to);

create table follow_ups (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  scheduled_for timestamptz not null,
  type          follow_up_type not null default 'call',
  notes         text,
  -- 'missed' is set explicitly by a user; being *overdue* is derived from
  -- scheduled_for at read time and is deliberately NOT a status value here,
  -- matching isOverdue() for tasks and isTenderOverdue() for tenders.
  status        follow_up_status not null default 'pending',
  created_by    uuid not null references users(id),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index follow_ups_lead_idx      on follow_ups (lead_id);
create index follow_ups_scheduled_idx on follow_ups (scheduled_for);
create index follow_ups_status_idx    on follow_ups (status);

create table site_visit_requests (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references leads(id) on delete cascade,
  -- the Sales employee asking Technical to survey
  requested_by   uuid not null references users(id),
  preferred_date timestamptz,
  status         site_visit_status not null default 'requested',
  -- Actual survey execution belongs to the Technical department module, which
  -- does not exist yet. This row is only Sales' side of the handoff: "we asked
  -- Technical to survey this lead." When that module lands it can reference
  -- this id — that link is deliberately not built here.
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index site_visit_requests_lead_idx on site_visit_requests (lead_id);

create table quotations (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references leads(id) on delete cascade,
  quoted_by      uuid not null references users(id),
  system_size_kw numeric(10, 2),
  amount         numeric(14, 2) not null,
  valid_until    date,
  status         quotation_status not null default 'draft',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index quotations_lead_idx   on quotations (lead_id);
create index quotations_status_idx on quotations (status);

create table proposals (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  -- a proposal usually follows an accepted / near-final quotation
  quotation_id uuid references quotations(id) on delete set null,
  proposed_by  uuid not null references users(id),
  amount       numeric(14, 2) not null,
  terms        text,
  status       proposal_status not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index proposals_lead_idx   on proposals (lead_id);
create index proposals_status_idx on proposals (status);

create table deal_closures (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  proposal_id  uuid references proposals(id) on delete set null,
  closed_by    uuid not null references users(id),
  final_amount numeric(14, 2) not null,
  closed_at    timestamptz not null default now(),
  -- the customer record created as part of closing; written by close_deal()
  customer_id  uuid references customers(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index deal_closures_lead_idx      on deal_closures (lead_id);
create index deal_closures_closed_by_idx on deal_closures (closed_by, closed_at);

create table sales_targets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  target_amount   numeric(14, 2) not null,
  target_deals    int,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  constraint sales_targets_period_valid check (period_end >= period_start),
  -- one target per person per period
  unique (user_id, period_start, period_end)
);

create index sales_targets_user_period_idx on sales_targets (user_id, period_start, period_end);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuses set_updated_at() from 0001)
--
-- deal_closures and sales_targets have no updated_at column: a closure is a
-- historical fact and a target is set once per period.
-- ---------------------------------------------------------------------------

create trigger set_updated_at_leads               before update on leads               for each row execute function set_updated_at();
create trigger set_updated_at_customers           before update on customers           for each row execute function set_updated_at();
create trigger set_updated_at_follow_ups          before update on follow_ups          for each row execute function set_updated_at();
create trigger set_updated_at_site_visit_requests before update on site_visit_requests for each row execute function set_updated_at();
create trigger set_updated_at_quotations          before update on quotations          for each row execute function set_updated_at();
create trigger set_updated_at_proposals           before update on proposals           for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Role helpers
--
-- security definer + fixed search_path, matching auth_is_ceo() / auth_org_id()
-- from 0001, so policies can read users/roles/departments without recursing
-- through those tables' own RLS.
-- ---------------------------------------------------------------------------

create or replace function auth_is_sales_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'sales'
  );
$$;

create or replace function auth_is_sales_manager()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    join roles r on r.id = u.role_id
    where u.id = auth.uid() and u.is_active
      and d.slug = 'sales' and r.name = 'Sales Manager'
  );
$$;

-- Executive scoping for child tables, which carry no assigned_to of their own.
create or replace function auth_owns_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from leads l
    where l.id = p_lead_id
      and l.organization_id = auth_org_id()
      and l.assigned_to = auth.uid()
  );
$$;

-- Manager/CEO scoping for child tables: the lead just has to be in their org.
create or replace function auth_lead_in_org(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from leads l
    where l.id = p_lead_id and l.organization_id = auth_org_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Enabling RLS with no matching policy = deny. Multiple permissive policies on
-- one table are OR'd, which is how the three tiers compose.
--
-- Note on `for all` policies with only a using clause: Postgres reuses the
-- using expression as the insert/update check. For the executive policies that
-- is exactly what we want — an executive may only write rows that remain
-- assigned to them, so they cannot reassign a lead away from themselves.
-- ---------------------------------------------------------------------------

alter table leads               enable row level security;
alter table customers           enable row level security;
alter table follow_ups          enable row level security;
alter table site_visit_requests enable row level security;
alter table quotations          enable row level security;
alter table proposals           enable row level security;
alter table deal_closures       enable row level security;
alter table sales_targets       enable row level security;

-- leads ---------------------------------------------------------------------

create policy "ceo_full_access_leads" on leads
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "sales_manager_full_access_leads" on leads
  for all
  using (auth_is_sales_manager() and organization_id = auth_org_id())
  with check (auth_is_sales_manager() and organization_id = auth_org_id());

create policy "sales_exec_own_leads" on leads
  for all
  using (
    auth_is_sales_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  );

-- customers (own assigned_to column) ----------------------------------------

create policy "ceo_full_access_customers" on customers
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "sales_manager_full_access_customers" on customers
  for all
  using (auth_is_sales_manager() and organization_id = auth_org_id())
  with check (auth_is_sales_manager() and organization_id = auth_org_id());

create policy "sales_exec_own_customers" on customers
  for all
  using (
    auth_is_sales_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  );

-- follow_ups (scoped through parent lead) -----------------------------------

create policy "ceo_full_access_follow_ups" on follow_ups
  for all
  using (auth_is_ceo() and auth_lead_in_org(lead_id))
  with check (auth_is_ceo() and auth_lead_in_org(lead_id));

create policy "sales_manager_full_access_follow_ups" on follow_ups
  for all
  using (auth_is_sales_manager() and auth_lead_in_org(lead_id))
  with check (auth_is_sales_manager() and auth_lead_in_org(lead_id));

create policy "sales_exec_own_follow_ups" on follow_ups
  for all
  using (auth_is_sales_member() and auth_owns_lead(lead_id));

-- site_visit_requests -------------------------------------------------------

create policy "ceo_full_access_site_visits" on site_visit_requests
  for all
  using (auth_is_ceo() and auth_lead_in_org(lead_id))
  with check (auth_is_ceo() and auth_lead_in_org(lead_id));

create policy "sales_manager_full_access_site_visits" on site_visit_requests
  for all
  using (auth_is_sales_manager() and auth_lead_in_org(lead_id))
  with check (auth_is_sales_manager() and auth_lead_in_org(lead_id));

create policy "sales_exec_own_site_visits" on site_visit_requests
  for all
  using (auth_is_sales_member() and auth_owns_lead(lead_id));

-- quotations ----------------------------------------------------------------

create policy "ceo_full_access_quotations" on quotations
  for all
  using (auth_is_ceo() and auth_lead_in_org(lead_id))
  with check (auth_is_ceo() and auth_lead_in_org(lead_id));

create policy "sales_manager_full_access_quotations" on quotations
  for all
  using (auth_is_sales_manager() and auth_lead_in_org(lead_id))
  with check (auth_is_sales_manager() and auth_lead_in_org(lead_id));

create policy "sales_exec_own_quotations" on quotations
  for all
  using (auth_is_sales_member() and auth_owns_lead(lead_id));

-- proposals -----------------------------------------------------------------

create policy "ceo_full_access_proposals" on proposals
  for all
  using (auth_is_ceo() and auth_lead_in_org(lead_id))
  with check (auth_is_ceo() and auth_lead_in_org(lead_id));

create policy "sales_manager_full_access_proposals" on proposals
  for all
  using (auth_is_sales_manager() and auth_lead_in_org(lead_id))
  with check (auth_is_sales_manager() and auth_lead_in_org(lead_id));

create policy "sales_exec_own_proposals" on proposals
  for all
  using (auth_is_sales_member() and auth_owns_lead(lead_id));

-- deal_closures -------------------------------------------------------------
-- A closure is a financial record. CEO and manager get full access; an
-- executive may create one for their own lead and read it back, but not edit
-- or delete it afterwards (append-only for them, like task_updates).

create policy "ceo_full_access_deal_closures" on deal_closures
  for all
  using (auth_is_ceo() and auth_lead_in_org(lead_id))
  with check (auth_is_ceo() and auth_lead_in_org(lead_id));

create policy "sales_manager_full_access_deal_closures" on deal_closures
  for all
  using (auth_is_sales_manager() and auth_lead_in_org(lead_id))
  with check (auth_is_sales_manager() and auth_lead_in_org(lead_id));

create policy "sales_exec_view_own_deal_closures" on deal_closures
  for select
  using (auth_is_sales_member() and auth_owns_lead(lead_id));

create policy "sales_exec_insert_own_deal_closures" on deal_closures
  for insert
  with check (
    auth_is_sales_member()
    and auth_owns_lead(lead_id)
    and closed_by = auth.uid()
  );

-- sales_targets -------------------------------------------------------------
-- CEO and Sales Manager create and view all. An executive may read their own
-- target row and nothing else — no insert/update/delete policy for them, so
-- those are denied.

create policy "ceo_full_access_sales_targets" on sales_targets
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "sales_manager_full_access_sales_targets" on sales_targets
  for all
  using (auth_is_sales_manager() and organization_id = auth_org_id())
  with check (auth_is_sales_manager() and organization_id = auth_org_id());

create policy "sales_exec_view_own_target" on sales_targets
  for select
  using (
    auth_is_sales_member()
    and organization_id = auth_org_id()
    and user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- close_deal(): atomic deal closure
--
-- Creates the customer, the deal_closures row, and flips the lead to 'won' in
-- one statement so a partial failure cannot leave a closure without a customer
-- or a lead stuck mid-close. Deliberately NOT security definer: it runs as the
-- caller so every write inside still passes RLS.
-- ---------------------------------------------------------------------------

create or replace function close_deal(
  p_lead_id      uuid,
  p_final_amount numeric,
  p_proposal_id  uuid default null,
  p_address      text default null
)
returns uuid
language plpgsql
as $$
declare
  v_lead        leads;
  v_customer_id uuid;
  v_closure_id  uuid;
begin
  -- RLS decides visibility: an executive cannot load someone else's lead here.
  select * into v_lead from leads where id = p_lead_id;
  if not found then
    raise exception 'Lead not found or not visible' using errcode = 'no_data_found';
  end if;

  if v_lead.status = 'won' then
    raise exception 'Lead is already closed as won';
  end if;
  if v_lead.status = 'lost' then
    raise exception 'Cannot close a lead marked lost';
  end if;

  if p_final_amount is null or p_final_amount < 0 then
    raise exception 'Final amount must be zero or greater';
  end if;

  if p_proposal_id is not null
     and not exists (select 1 from proposals p where p.id = p_proposal_id and p.lead_id = p_lead_id) then
    raise exception 'Proposal does not belong to this lead';
  end if;

  insert into customers (organization_id, lead_id, name, phone, email, address, assigned_to)
  values (v_lead.organization_id, v_lead.id, v_lead.name, v_lead.phone, v_lead.email,
          p_address, coalesce(v_lead.assigned_to, auth.uid()))
  returning id into v_customer_id;

  insert into deal_closures (lead_id, proposal_id, closed_by, final_amount, customer_id)
  values (p_lead_id, p_proposal_id, auth.uid(), p_final_amount, v_customer_id)
  returning id into v_closure_id;

  update leads set status = 'won' where id = p_lead_id;

  return v_closure_id;
end;
$$;

revoke execute on function close_deal(uuid, numeric, uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- Seed: Sales Manager role + module permissions
--
-- 0002 seeds only CEO and "<Department> Executive" per department. The whole
-- three-tier model above keys off a 'Sales Manager' role, so it has to exist.
-- Idempotent, same shape as 0002.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id       uuid;
  sales_id     uuid;
  ceo_role_id  uuid;
  mgr_role_id  uuid;
  exec_role_id uuid;
  sales_modules text[] := array[
    'leads', 'customers', 'follow_ups', 'site_visits',
    'quotations', 'proposals', 'deal_closures', 'sales_targets'
  ];
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into sales_id from departments where organization_id = org_id and slug = 'sales';
  if sales_id is null then return; end if;

  -- CEO: full access to every Sales module
  select id into ceo_role_id from roles where organization_id = org_id and name = 'CEO';
  if ceo_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select ceo_role_id, m, true, true, true, true, true, true from unnest(sales_modules) as m
    on conflict (role_id, module) do nothing;
  end if;

  -- Sales Manager: department-wide, including target setting
  select id into mgr_role_id from roles where organization_id = org_id and name = 'Sales Manager';
  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, sales_id, 'Sales Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true from unnest(sales_modules) as m
  on conflict (role_id, module) do nothing;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  values (mgr_role_id, 'tasks', true, false, true, false, false, false)
  on conflict (role_id, module) do nothing;

  -- Sales Executive: own records only; targets are read-only for them
  select id into exec_role_id from roles where organization_id = org_id and name = 'Sales Executive';
  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array[
      'leads', 'customers', 'follow_ups', 'site_visits',
      'quotations', 'proposals', 'deal_closures'
    ]) as m
    on conflict (role_id, module) do nothing;

    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    values (exec_role_id, 'sales_targets', true, false, false, false, false, false)
    on conflict (role_id, module) do nothing;
  end if;
end;
$$;
