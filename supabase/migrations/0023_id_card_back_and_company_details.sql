-- Solar Pulse OS
-- Migration 0023: two-sided ID card + editable company footer
--
-- The ID card was redesigned to match the printed template: a PORTRAIT card with
-- two sides — a front (logo, photo, name, designation, ID No / Join Date / Phone /
-- E-mail, contact footer) and a back (logo, Terms & Conditions, the big attendance
-- QR, contact footer). Two changes support that:
--
--   1. employees.id_card_back_file_path — the back is a second stored PNG, sibling
--      to the existing id_card_file_path (which now holds the FRONT). The downloadable
--      PDF is stitched on demand from the two, so no PDF is stored.
--
--   2. company_details — the footer (address, phone, email) is identical on every
--      card and was previously going to be hardcoded. HR wanted it editable, so it
--      lives in one row per organization, read by anyone in the org (the card render
--      and the settings form both read it) and written only by the CEO / HR lead.

-- ---------------------------------------------------------------------------
-- Back-of-card image path
-- ---------------------------------------------------------------------------

alter table employees add column if not exists id_card_back_file_path text;

-- ---------------------------------------------------------------------------
-- Company details — the card footer, one row per organization
-- ---------------------------------------------------------------------------

create table if not exists company_details (
  organization_id uuid primary key references organizations(id) on delete cascade,
  address         text,
  phone           text,
  email           text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id) on delete set null
);

-- Keep updated_at fresh on write (set_updated_at() ships in 0001).
drop trigger if exists company_details_set_updated_at on company_details;
create trigger company_details_set_updated_at
  before update on company_details
  for each row execute function set_updated_at();

alter table company_details enable row level security;

-- Read: anyone in the organization. The card render (service client) does not need
-- this, but the settings form and any in-app footer preview read it as the caller,
-- and the footer is not sensitive.
drop policy if exists "org_members_read_company_details" on company_details;
create policy "org_members_read_company_details" on company_details
  for select
  using (organization_id = auth_org_id());

-- Write: CEO or the HR lead ONLY. Deliberately auth_is_hr_lead() (HR Manager/Lead
-- in the 'hr' department) rather than the generic auth_is_department_manager() —
-- the company footer is a company-wide setting, not something a Sales or Store
-- manager should be able to rewrite. auth_is_ceo() (0001) and auth_is_hr_lead()
-- (0015) both ship earlier. Split into insert/update so the first-time insert of
-- the org's single row is allowed too.
drop policy if exists "leads_insert_company_details" on company_details;
create policy "leads_insert_company_details" on company_details
  for insert
  with check (
    organization_id = auth_org_id()
    and (auth_is_ceo() or auth_is_hr_lead())
  );

drop policy if exists "leads_update_company_details" on company_details;
create policy "leads_update_company_details" on company_details
  for update
  using (
    organization_id = auth_org_id()
    and (auth_is_ceo() or auth_is_hr_lead())
  )
  with check (
    organization_id = auth_org_id()
    and (auth_is_ceo() or auth_is_hr_lead())
  );
