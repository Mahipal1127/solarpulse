-- ---------------------------------------------------------------------------
-- 0013 — DISCOM department module
--
-- The electricity-board liaison desk: the receiving end of O&M's completed
-- installations. Once a site is `completed` (installation_status, 0012), the net
-- metering paperwork and the PM Surya Ghar subsidy claim begin here. This module
-- tracks each case through the DISCOM/subsidy pipeline and — its whole reason to
-- exist — shows WHERE a case is stuck and FOR HOW LONG.
--
-- Three tiers, the shape Sales established in 0005 and every module since reused:
--   CEO              → every row in the org, read-only in practice (the service
--                      layer refuses writes from outside the department)
--   DISCOM Manager   → the whole department's applications, cases and documents
--   Liaison Executive→ only the cases assigned to them (own = assigned_to)
--
-- THE SLUG IS 'discom', seeded in 0002. Every RLS check and every
-- requireDepartment() guard keys off it.
--
-- STATUS IS APPEND-ONLY HISTORY, NOT A BARE COLUMN. Each application/case carries
-- a `status` for the current state AND a *_status_history table that records every
-- transition with a timestamp. "Days in current status" — the number the whole
-- staleness dashboard is built on — is derived at read time from the most recent
-- history row (or created_at when there is none yet). It is never stored, the same
-- derived-not-stored discipline 0012 used for AMC 'expired' and visit 'missed':
-- a stored day-count goes stale the moment the clock ticks. The 15-day staleness
-- threshold is likewise a read-time comparison, hardcoded for v1 but labelled in
-- the UI as tunable — there is no settings table for it here.
--
-- The status-history WRITE RULE (a status change must go through the dedicated
-- /status endpoint that appends a history row; the plain update path must reject a
-- direct status edit) is enforced in the service layer, the same place 0012 gates
-- the service-report requirement. This migration provides the two history tables
-- that rule writes into.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enums
--
-- Net metering and subsidy share the early states (not_started, documents_pending,
-- under_review, query_raised, rejected) but diverge at the end: a net-metering
-- application is submitted then approved; a subsidy claim is applied, sanctioned,
-- then disbursed. Two enums rather than one shared vocabulary, so an impossible
-- transition (a net-metering row going 'disbursed') cannot even be represented.
--
-- document_type is an enum, not free text: the spec's list ends in an explicit
-- 'other' catch-all rather than "etc.", so the set is closed — the same test 0012
-- used to keep role_on_site free but issue_type... also free (that one ended in
-- 'other' too, but was left text by an earlier call; here we take the closed set).
-- scheme stays text: government programmes come and go, so a new scheme should be
-- a data change, not a migration.
-- ---------------------------------------------------------------------------

create type net_metering_status as enum (
  'not_started', 'documents_pending', 'submitted', 'under_review',
  'query_raised', 'approved', 'rejected'
);

create type subsidy_status as enum (
  'not_started', 'documents_pending', 'applied', 'under_review',
  'query_raised', 'sanctioned', 'disbursed', 'rejected'
);

create type government_document_type as enum (
  'consumer_id_proof', 'electricity_bill', 'address_proof', 'bank_passbook',
  'sanction_letter', 'completion_certificate', 'other'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table net_metering_applications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  -- The completed installation this paperwork is for. NOT NULL: net metering only
  -- exists because an installation exists. One application per installation is the
  -- expectation, enforced below.
  installation_id   uuid not null references installations(id),
  -- Denormalised from the installation, so the case list and staleness board never
  -- have to join back to Sales just to show a customer name.
  customer_id       uuid not null references customers(id),
  -- The liaison executive answerable for this case. NOT NULL — a case with no owner
  -- is a case nobody is chasing, which is exactly what this module exists to prevent.
  assigned_to       uuid not null references users(id),
  -- The electricity board handling it (free text: hundreds of DISCOMs nationwide).
  discom_name       text,
  consumer_number   text,
  application_number text,
  status            net_metering_status not null default 'not_started',
  submitted_date    date,
  approved_date     date,
  rejection_reason  text,
  notes             text,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One net-metering track per installation. A second is a data-entry mistake, not
  -- a real second application.
  unique (installation_id)
);

create index net_metering_org_status_idx on net_metering_applications (organization_id, status);
create index net_metering_assignee_idx    on net_metering_applications (assigned_to);
create index net_metering_customer_idx     on net_metering_applications (customer_id);
create index net_metering_install_idx      on net_metering_applications (installation_id);

-- Append-only. Every status transition lands one row; the newest row's created_at
-- is what "days in current status" counts from. No updated_at, no deletes in the
-- service layer — history you can edit is not history.
create table net_metering_status_history (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references net_metering_applications(id) on delete cascade,
  updated_by     uuid not null references users(id),
  status         net_metering_status not null,
  note           text,
  created_at     timestamptz not null default now()
);

create index net_metering_history_app_idx on net_metering_status_history (application_id, created_at desc);

create table subsidy_cases (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id),
  installation_id        uuid not null references installations(id),
  customer_id            uuid not null references customers(id),
  assigned_to            uuid not null references users(id),
  -- Which subsidy programme. Text, defaulting to the current national scheme; a new
  -- programme is a new value, not a schema change.
  scheme                 text not null default 'pm_surya_ghar',
  application_reference  text,
  eligible_subsidy_amount numeric(14, 2),
  status                 subsidy_status not null default 'not_started',
  applied_date           date,
  disbursed_date         date,
  disbursed_amount       numeric(14, 2),
  notes                  text,
  created_by             uuid not null references users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (installation_id, scheme)
);

create index subsidy_org_status_idx on subsidy_cases (organization_id, status);
create index subsidy_assignee_idx    on subsidy_cases (assigned_to);
create index subsidy_customer_idx     on subsidy_cases (customer_id);
create index subsidy_install_idx      on subsidy_cases (installation_id);

create table subsidy_status_history (
  id              uuid primary key default gen_random_uuid(),
  subsidy_case_id uuid not null references subsidy_cases(id) on delete cascade,
  updated_by      uuid not null references users(id),
  status          subsidy_status not null,
  note            text,
  created_at      timestamptz not null default now()
);

create index subsidy_history_case_idx on subsidy_status_history (subsidy_case_id, created_at desc);

-- Government paperwork store. A document belongs to the org and attaches to one or
-- more of: an installation, a net-metering application, a subsidy case. All three
-- links are nullable, but at least one must be set (a document tied to nothing is
-- unreachable) — the check below enforces that. The file itself lives in the
-- private `discom-documents` bucket; this row is the audited metadata and the only
-- way to discover the file_path a signed URL is minted from.
create table government_documents (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references organizations(id),
  installation_id             uuid references installations(id),
  net_metering_application_id uuid references net_metering_applications(id) on delete cascade,
  subsidy_case_id             uuid references subsidy_cases(id) on delete cascade,
  document_type               government_document_type not null default 'other',
  file_path                   text not null,
  file_name                   text not null,
  uploaded_by                 uuid not null references users(id),
  created_at                  timestamptz not null default now(),
  constraint government_document_has_parent check (
    installation_id is not null
    or net_metering_application_id is not null
    or subsidy_case_id is not null
  )
);

create index government_documents_org_idx     on government_documents (organization_id);
create index government_documents_nm_idx      on government_documents (net_metering_application_id);
create index government_documents_subsidy_idx  on government_documents (subsidy_case_id);
create index government_documents_install_idx  on government_documents (installation_id);

-- Consumer verification: the liaison confirming the customer's DISCOM identity
-- matches the paperwork before submission. Reaches the org through installation_id
-- (no org column, like 0012's installation child tables). own = verified_by.
create table consumer_verifications (
  id                       uuid primary key default gen_random_uuid(),
  installation_id          uuid not null references installations(id),
  customer_id              uuid not null references customers(id),
  verified_by              uuid not null references users(id),
  consumer_number_verified boolean not null default false,
  identity_verified        boolean not null default false,
  address_verified         boolean not null default false,
  notes                    text,
  verified_at              timestamptz not null default now(),
  created_at               timestamptz not null default now()
);

create index consumer_verifications_install_idx  on consumer_verifications (installation_id);
create index consumer_verifications_verifier_idx on consumer_verifications (verified_by);

-- ---------------------------------------------------------------------------
-- updated_at triggers, reusing set_updated_at() from 0001
--
-- Only the two tables with a mutable lifecycle carry updated_at. The history tables,
-- documents and verifications are append-only historical facts and have none, the
-- same choice 0012 made for its logs.
-- ---------------------------------------------------------------------------

create trigger net_metering_applications_set_updated_at
  before update on net_metering_applications
  for each row execute function set_updated_at();

create trigger subsidy_cases_set_updated_at
  before update on subsidy_cases
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers
--
-- security definer + a pinned search_path, same as every prior module: these read
-- `users`, itself under RLS, and would otherwise recurse.
-- ---------------------------------------------------------------------------

create or replace function auth_is_discom_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'discom'
  );
$$;

-- The department-wide tier.
--
-- Accepts 'DISCOM Manager' or 'DISCOM Lead'. The build spec named the role "DISCOM
-- Lead", but auth_is_department_manager() (0006) matches name like '%Manager' and
-- isDepartmentManager() in guards.ts matches /\sManager$/ — a "DISCOM Lead" role
-- satisfies neither, so CEO-assigned unclaimed tasks would have nobody to delegate
-- them to. The seed at the bottom creates the '...Manager' role to keep that
-- convention intact; this also honours 'DISCOM Lead' so a manually-created role
-- still works inside this module. Exactly the reasoning in auth_is_om_lead() (0012).
create or replace function auth_is_discom_lead()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'discom'
      and r.name in ('DISCOM Manager', 'DISCOM Lead')
  );
$$;

-- net_metering_status_history reaches the assignee through application_id.
create or replace function auth_owns_net_metering(p_application_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from net_metering_applications a
    where a.id = p_application_id
      and a.organization_id = auth_org_id()
      and a.assigned_to = auth.uid()
  );
$$;

create or replace function auth_net_metering_in_org(p_application_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from net_metering_applications a
    where a.id = p_application_id and a.organization_id = auth_org_id()
  );
$$;

-- subsidy_status_history reaches the assignee through subsidy_case_id.
create or replace function auth_owns_subsidy(p_case_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from subsidy_cases c
    where c.id = p_case_id
      and c.organization_id = auth_org_id()
      and c.assigned_to = auth.uid()
  );
$$;

create or replace function auth_subsidy_in_org(p_case_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from subsidy_cases c
    where c.id = p_case_id and c.organization_id = auth_org_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: net_metering_applications (own = assigned_to)
-- ---------------------------------------------------------------------------

alter table net_metering_applications enable row level security;

create policy "ceo_full_access_net_metering" on net_metering_applications
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "discom_lead_full_access_net_metering" on net_metering_applications
  for all
  using (auth_is_discom_lead() and organization_id = auth_org_id())
  with check (auth_is_discom_lead() and organization_id = auth_org_id());

-- The individual tier: a liaison sees and works only the cases assigned to them.
-- The with-check reuses the using expression, so a liaison cannot reassign a case
-- to someone else and keep editing it — the write would land on a row they no
-- longer own. The acceptance checklist asks this be verified by RLS rejection, not
-- UI filtering.
create policy "liaison_own_net_metering" on net_metering_applications
  for all
  using (
    auth_is_discom_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  )
  with check (
    auth_is_discom_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- RLS: net_metering_status_history (scoped through application_id)
-- ---------------------------------------------------------------------------

alter table net_metering_status_history enable row level security;

create policy "ceo_full_access_nm_history" on net_metering_status_history
  for all
  using (auth_is_ceo() and auth_net_metering_in_org(application_id))
  with check (auth_is_ceo() and auth_net_metering_in_org(application_id));

create policy "discom_lead_full_access_nm_history" on net_metering_status_history
  for all
  using (auth_is_discom_lead() and auth_net_metering_in_org(application_id))
  with check (auth_is_discom_lead() and auth_net_metering_in_org(application_id));

create policy "liaison_own_nm_history" on net_metering_status_history
  for all
  using (auth_is_discom_member() and auth_owns_net_metering(application_id))
  with check (auth_is_discom_member() and auth_owns_net_metering(application_id));

-- ---------------------------------------------------------------------------
-- RLS: subsidy_cases (own = assigned_to)
-- ---------------------------------------------------------------------------

alter table subsidy_cases enable row level security;

create policy "ceo_full_access_subsidy" on subsidy_cases
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "discom_lead_full_access_subsidy" on subsidy_cases
  for all
  using (auth_is_discom_lead() and organization_id = auth_org_id())
  with check (auth_is_discom_lead() and organization_id = auth_org_id());

create policy "liaison_own_subsidy" on subsidy_cases
  for all
  using (
    auth_is_discom_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  )
  with check (
    auth_is_discom_member()
    and organization_id = auth_org_id()
    and assigned_to = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- RLS: subsidy_status_history (scoped through subsidy_case_id)
-- ---------------------------------------------------------------------------

alter table subsidy_status_history enable row level security;

create policy "ceo_full_access_subsidy_history" on subsidy_status_history
  for all
  using (auth_is_ceo() and auth_subsidy_in_org(subsidy_case_id))
  with check (auth_is_ceo() and auth_subsidy_in_org(subsidy_case_id));

create policy "discom_lead_full_access_subsidy_history" on subsidy_status_history
  for all
  using (auth_is_discom_lead() and auth_subsidy_in_org(subsidy_case_id))
  with check (auth_is_discom_lead() and auth_subsidy_in_org(subsidy_case_id));

create policy "liaison_own_subsidy_history" on subsidy_status_history
  for all
  using (auth_is_discom_member() and auth_owns_subsidy(subsidy_case_id))
  with check (auth_is_discom_member() and auth_owns_subsidy(subsidy_case_id));

-- ---------------------------------------------------------------------------
-- RLS: government_documents
--
-- The row carries organization_id directly, so CEO and lead gate on org. A liaison
-- reaches a document through the case it hangs off: they may touch a document
-- linked to a net-metering application or subsidy case assigned to them. A document
-- linked ONLY to an installation (no nm/subsidy) is departmental paperwork the
-- liaison does not own — visible to CEO/lead only, the safe default for a personal
-- document (consumer ID proof, bank passbook) that would otherwise leak across the
-- department. These are personal-document fields, so the service layer also audits
-- every download, not just writes.
-- ---------------------------------------------------------------------------

alter table government_documents enable row level security;

create policy "ceo_full_access_gov_documents" on government_documents
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "discom_lead_full_access_gov_documents" on government_documents
  for all
  using (auth_is_discom_lead() and organization_id = auth_org_id())
  with check (auth_is_discom_lead() and organization_id = auth_org_id());

create policy "liaison_own_gov_documents" on government_documents
  for all
  using (
    auth_is_discom_member()
    and organization_id = auth_org_id()
    and (
      (net_metering_application_id is not null and auth_owns_net_metering(net_metering_application_id))
      or (subsidy_case_id is not null and auth_owns_subsidy(subsidy_case_id))
    )
  )
  with check (
    auth_is_discom_member()
    and organization_id = auth_org_id()
    and (
      (net_metering_application_id is not null and auth_owns_net_metering(net_metering_application_id))
      or (subsidy_case_id is not null and auth_owns_subsidy(subsidy_case_id))
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: consumer_verifications (own = verified_by, org via installation_id)
--
-- auth_installation_in_org() is the 0012 helper — a plain org-scoped installation
-- lookup, reused here so this module does not redefine it.
-- ---------------------------------------------------------------------------

alter table consumer_verifications enable row level security;

create policy "ceo_full_access_consumer_verifications" on consumer_verifications
  for all
  using (auth_is_ceo() and auth_installation_in_org(installation_id))
  with check (auth_is_ceo() and auth_installation_in_org(installation_id));

create policy "discom_lead_full_access_consumer_verifications" on consumer_verifications
  for all
  using (auth_is_discom_lead() and auth_installation_in_org(installation_id))
  with check (auth_is_discom_lead() and auth_installation_in_org(installation_id));

create policy "liaison_own_consumer_verifications" on consumer_verifications
  for all
  using (
    auth_is_discom_member()
    and verified_by = auth.uid()
    and auth_installation_in_org(installation_id)
  )
  with check (
    auth_is_discom_member()
    and verified_by = auth.uid()
    and auth_installation_in_org(installation_id)
  );

-- ---------------------------------------------------------------------------
-- Cross-department reads this module cannot work without
--
-- Not in the build spec, but the module's central handoff is impossible without
-- them, the same gap 0012 hit with customers/designs/deal_closures. A net-metering
-- application and a subsidy case are both created FROM a completed installation:
-- the flow reads the installation to copy its customer_id and stamp installation_id,
-- and the Pending Handoffs queue reads completed installations that have no
-- net-metering row yet. Both run as the caller, so those reads are subject to RLS.
-- Without these, the conversion raises "not found or not visible" and the staleness
-- board can never surface a handoff.
--
-- Both are select-only and org-scoped — DISCOM reads O&M's and Sales' rows to
-- originate its own work, it never writes them.
-- ---------------------------------------------------------------------------

create policy "discom_read_installations" on installations
  for select
  using (
    (auth_is_discom_member() or auth_is_discom_lead())
    and organization_id = auth_org_id()
  );

create policy "discom_read_customers" on customers
  for select
  using (
    (auth_is_discom_member() or auth_is_discom_lead())
    and organization_id = auth_org_id()
  );

-- ---------------------------------------------------------------------------
-- Storage
--
-- discom-documents holds consumer ID proofs, electricity bills, sanction letters
-- and the rest. Objects live at '{organization_id}/{customer_id}/{filename}' per the
-- build spec — so the FIRST path segment is the org, not (as in 0012) the owning
-- record. The storage policy can therefore only gate at org level; per-case
-- ownership is enforced on government_documents and by the service layer, which
-- looks up the row (subject to RLS) before minting a signed URL. A liaison cannot
-- discover the file_path of a document row they cannot see, so the org-wide storage
-- grant is not a leak.
--
-- discom_object_org guards the uuid cast the same way install_object_folder did: an
-- object uploaded outside the convention has a non-uuid first segment and must match
-- nothing rather than error the whole policy.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('discom-documents', 'discom-documents', false)
on conflict (id) do nothing;

create or replace function discom_object_org(object_name text)
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

create policy "discom_docs_ceo_objects" on storage.objects
  for all
  using (
    bucket_id = 'discom-documents'
    and auth_is_ceo()
    and discom_object_org(name) = auth_org_id()
  )
  with check (
    bucket_id = 'discom-documents'
    and auth_is_ceo()
    and discom_object_org(name) = auth_org_id()
  );

create policy "discom_docs_lead_objects" on storage.objects
  for all
  using (
    bucket_id = 'discom-documents'
    and auth_is_discom_lead()
    and discom_object_org(name) = auth_org_id()
  )
  with check (
    bucket_id = 'discom-documents'
    and auth_is_discom_lead()
    and discom_object_org(name) = auth_org_id()
  );

create policy "discom_docs_member_objects" on storage.objects
  for all
  using (
    bucket_id = 'discom-documents'
    and auth_is_discom_member()
    and discom_object_org(name) = auth_org_id()
  )
  with check (
    bucket_id = 'discom-documents'
    and auth_is_discom_member()
    and discom_object_org(name) = auth_org_id()
  );

-- ---------------------------------------------------------------------------
-- Seed: DISCOM Manager role + module permissions
--
-- 0002 seeds only CEO and '<Department> Executive'. The department-wide tier here
-- needs a role, named 'DISCOM Manager' rather than the spec's 'DISCOM Lead' so that
-- auth_is_department_manager() (0006) and isDepartmentManager() (guards.ts) keep
-- working — see auth_is_discom_lead() above for the full reasoning.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id         uuid;
  discom_dept_id uuid;
  mgr_role_id    uuid;
  exec_role_id   uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into discom_dept_id
    from departments
   where organization_id = org_id and slug = 'discom';
  if discom_dept_id is null then return; end if;

  select id into mgr_role_id
    from roles
   where organization_id = org_id and name = 'DISCOM Manager';

  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, discom_dept_id, 'DISCOM Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array['tasks','approvals','departments','net_metering','subsidy','documents','consumer_verification']) as m
  on conflict (role_id, module) do nothing;

  select id into exec_role_id
    from roles
   where organization_id = org_id and name = 'DISCOM Executive';

  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array['net_metering','subsidy','documents','consumer_verification']) as m
    on conflict (role_id, module) do nothing;
  end if;
end;
$$;
