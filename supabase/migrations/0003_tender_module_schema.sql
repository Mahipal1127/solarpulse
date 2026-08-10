-- Solar Pulse OS — Tender Module
-- Migration 0003: tenders, bids, documents, RLS, storage bucket
--
-- Builds on 0001. Reuses organizations / departments / users / audit_logs and
-- the set_updated_at() trigger function — nothing from 0001 is redefined here.
--
-- Security model is unchanged: RLS is the source of truth. requireDepartment()
-- in lib/auth/guards.ts is a fast-fail UX layer only. Only the CEO and members
-- of the 'tender' department can see any row in these tables — Sales, Finance
-- and Technical are not granted read access, per the frozen blueprint.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type tender_status as enum (
  'open', 'preparing_bid', 'submitted', 'won', 'lost', 'cancelled'
);

create type tender_bid_status as enum (
  'draft', 'submitted', 'under_review', 'won', 'lost'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table tenders (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  title                text not null,
  -- government body / client floating the tender
  issuing_authority    text,
  tender_number        text,
  description          text,
  submission_deadline  timestamptz not null,
  status               tender_status not null default 'open',
  estimated_value      numeric(14, 2),
  created_by           uuid not null references users(id),
  -- primary owner; must be a member of the tender department (enforced in the
  -- service layer, since RLS cannot cheaply express "same department as slug")
  assigned_employee_id uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index tenders_org_status_idx on tenders (organization_id, status);
create index tenders_deadline_idx   on tenders (submission_deadline);
create index tenders_assignee_idx   on tenders (assigned_employee_id);

create table tender_bids (
  id                   uuid primary key default gen_random_uuid(),
  tender_id            uuid not null references tenders(id) on delete cascade,
  bid_amount           numeric(14, 2),
  bid_status           tender_bid_status not null default 'draft',
  assigned_employee_id uuid references users(id) on delete set null,
  notes                text,
  submitted_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index tender_bids_tender_idx   on tender_bids (tender_id);
create index tender_bids_status_idx   on tender_bids (bid_status);
create index tender_bids_assignee_idx on tender_bids (assigned_employee_id);

create table tender_documents (
  id            uuid primary key default gen_random_uuid(),
  tender_id     uuid not null references tenders(id) on delete cascade,
  -- Supabase Storage path inside the private 'tender-documents' bucket,
  -- always '{tender_id}/{uuid}-{filename}'. The storage policy below relies on
  -- that first path segment, so do not change the convention without changing
  -- the policy too.
  file_path     text not null,
  file_name     text not null,
  document_type text,
  uploaded_by   uuid not null references users(id),
  created_at    timestamptz not null default now()
);

create index tender_documents_tender_idx on tender_documents (tender_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuses set_updated_at() from 0001)
-- ---------------------------------------------------------------------------

create trigger set_updated_at_tenders
  before update on tenders
  for each row execute function set_updated_at();

create trigger set_updated_at_tender_bids
  before update on tender_bids
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper: is the caller an active member of the tender department?
--
-- security definer + fixed search_path, matching auth_is_ceo() in 0001, so the
-- policies below can read users/departments without recursing through their
-- own RLS.
-- ---------------------------------------------------------------------------

create or replace function auth_is_tender_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid()
      and u.is_active
      and d.slug = 'tender'
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table tenders          enable row level security;
alter table tender_bids      enable row level security;
alter table tender_documents enable row level security;

-- tenders ------------------------------------------------------------------

create policy "ceo_full_access_tenders" on tenders
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "tender_dept_access_tenders" on tenders
  for all
  using (auth_is_tender_member() and organization_id = auth_org_id())
  with check (auth_is_tender_member() and organization_id = auth_org_id());

-- tender_bids --------------------------------------------------------------
-- Scoped through the parent tender's organization_id; there is no direct
-- organization_id column to filter on.

create policy "ceo_full_access_tender_bids" on tender_bids
  for all
  using (auth_is_ceo() and exists (
    select 1 from tenders t
    where t.id = tender_bids.tender_id and t.organization_id = auth_org_id()))
  with check (auth_is_ceo() and exists (
    select 1 from tenders t
    where t.id = tender_bids.tender_id and t.organization_id = auth_org_id()));

create policy "tender_dept_access_tender_bids" on tender_bids
  for all
  using (auth_is_tender_member() and exists (
    select 1 from tenders t
    where t.id = tender_bids.tender_id and t.organization_id = auth_org_id()))
  with check (auth_is_tender_member() and exists (
    select 1 from tenders t
    where t.id = tender_bids.tender_id and t.organization_id = auth_org_id()));

-- tender_documents ---------------------------------------------------------

create policy "ceo_full_access_tender_documents" on tender_documents
  for all
  using (auth_is_ceo() and exists (
    select 1 from tenders t
    where t.id = tender_documents.tender_id and t.organization_id = auth_org_id()))
  with check (auth_is_ceo() and exists (
    select 1 from tenders t
    where t.id = tender_documents.tender_id and t.organization_id = auth_org_id()));

create policy "tender_dept_access_tender_documents" on tender_documents
  for all
  using (auth_is_tender_member() and exists (
    select 1 from tenders t
    where t.id = tender_documents.tender_id and t.organization_id = auth_org_id()))
  with check (auth_is_tender_member() and exists (
    select 1 from tenders t
    where t.id = tender_documents.tender_id and t.organization_id = auth_org_id()));

-- ---------------------------------------------------------------------------
-- Storage: private 'tender-documents' bucket
--
-- Objects live at '{tender_id}/{filename}'. The policies re-check the parent
-- tender's organization through that first folder segment, so a signed URL
-- request for another org's file is rejected by the database, not just by the
-- route handler.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('tender-documents', 'tender-documents', false)
on conflict (id) do nothing;

-- Guarded cast: an object uploaded outside the convention has a non-uuid first
-- segment, and must not error the policy — it simply matches nothing.
create or replace function tender_object_org_ok(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  folder text;
begin
  folder := (storage.foldername(object_name))[1];
  if folder is null then
    return false;
  end if;
  if folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from tenders t
    where t.id = folder::uuid
      and t.organization_id = auth_org_id()
  );
end;
$$;

create policy "tender_docs_ceo_all_objects" on storage.objects
  for all
  using (
    bucket_id = 'tender-documents'
    and auth_is_ceo()
    and tender_object_org_ok(name)
  )
  with check (
    bucket_id = 'tender-documents'
    and auth_is_ceo()
    and tender_object_org_ok(name)
  );

create policy "tender_docs_dept_all_objects" on storage.objects
  for all
  using (
    bucket_id = 'tender-documents'
    and auth_is_tender_member()
    and tender_object_org_ok(name)
  )
  with check (
    bucket_id = 'tender-documents'
    and auth_is_tender_member()
    and tender_object_org_ok(name)
  );

-- ---------------------------------------------------------------------------
-- Permissions for the existing "Tender Executive" role seeded in 0002
-- ---------------------------------------------------------------------------

do $$
declare
  tender_role_id uuid;
begin
  select r.id into tender_role_id
    from roles r
    join departments d on d.id = r.department_id
   where d.slug = 'tender' and r.name = 'Tender Executive'
   limit 1;

  if tender_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    values
      (tender_role_id, 'tenders',          true, true, true, true,  false, false),
      (tender_role_id, 'tender_bids',      true, true, true, true,  false, false),
      (tender_role_id, 'tender_documents', true, true, true, true,  false, false)
    on conflict (role_id, module) do nothing;
  end if;

  -- CEO is org-wide read/write on everything; keep the module list in sync.
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select r.id, m, true, true, true, true, true, true
    from roles r
   cross join unnest(array['tenders','tender_bids','tender_documents']) as m
   where r.name = 'CEO'
  on conflict (role_id, module) do nothing;
end;
$$;
