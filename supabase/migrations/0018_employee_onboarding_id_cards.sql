-- Solar Pulse OS
-- 0018 — Employee onboarding, digital ID cards & QR attendance tokens
--
-- Extends HR (0015). Three things:
--   1. New employees columns for the onboarding + ID-card flow.
--   2. A qr_tokens table — the revocable identity token an ID card encodes.
--   3. RLS on qr_tokens, reusing the HR helpers from 0015.
--
-- THE LOAD-BEARING DECISION — the QR payload is an opaque, revocable token, never an
-- identifier used for anything else. An ID card is a physical/shareable artifact; anyone who
-- photographs one holds whatever the QR encodes forever. If that were the employee's user_id or
-- email, a copied card would let someone mark that employee's attendance indefinitely with no
-- way to stop it short of resetting their account. So the QR encodes qr_tokens.token — a long
-- random string with a single purpose (attendance identity resolution) that HR can revoke and
-- reissue when a card is lost, WITHOUT touching the employee's login or any other record.
--
-- WHY A TABLE, NOT A COLUMN — the build prompt sketched both a qr_tokens table and an
-- employees.qr_token column. Two stores of the same fact drift. The table is the single source
-- of truth: it carries is_active + revoked_at so a lost card is handled by revoking the old row
-- and inserting a fresh one, and it keeps token history auditable (which card was live when).
-- employees therefore gets NO qr_token column. The employee's CURRENT token is "the qr_tokens
-- row where employee_id = ? and is_active" — one active token per employee in practice, enforced
-- by a partial unique index rather than a column.
--
-- STORAGE — profile photos and generated ID-card images reuse the existing 'hr-documents'
-- bucket (0015) under the same '{employee_id}/...' path convention. The object policies already
-- there (hr_documents_ceo_objects / _lead_objects / _employee_read_own, keyed off
-- hr_object_employee(name)) already grant exactly the access this feature needs: CEO + HR lead
-- manage any object in their org, and an employee may read their own folder. No new bucket, no
-- new storage policy.
--
-- ACCESS TIERS mirror 0015 exactly. qr_tokens is SENSITIVE like salary/KPI data: only CEO and
-- the HR lead may touch it, and — deliberately — there is NO employee-facing policy at all. An
-- employee never needs to read their own token value through the app; they present the card, and
-- the attendance panel (built later) resolves the scanned token through a server-side endpoint
-- on the service-role client, not a client table read. See the note on the ABSENT policy below.
--
-- Helpers reused (all from 0001/0015, none redefined here):
--   auth_is_ceo(), auth_org_id()            — 0001
--   auth_is_hr_lead(), auth_owns_employee(), auth_employee_org()  — 0015
-- auth_is_hr_lead() already honours both 'HR Manager' (the role 0015 actually seeds) and a
-- hypothetical 'HR Lead', so nothing here hardcodes a role name.

-- ---------------------------------------------------------------------------
-- 1. employees columns
-- ---------------------------------------------------------------------------

alter table employees add column if not exists profile_photo_path text;      -- hr-documents bucket, '{employee_id}/...'
alter table employees add column if not exists id_card_generated_at timestamptz;
alter table employees add column if not exists id_card_file_path text;       -- generated card PNG, hr-documents bucket
alter table employees add column if not exists whatsapp_number text;         -- card-sharing number; may differ from phone

-- must_change_password defaults TRUE so a FUTURE HR-created account is forced through a password
-- change on first login (HR sets a temporary password it does not keep). The default governs new
-- rows only.
--
-- BACKFILL, DELIBERATELY. `not null default true` stamps every EXISTING employee true as well —
-- and those people already set and know their own password, so leaving it there would lock the
-- whole company out behind a spurious reset on their next login. So immediately reset every row
-- that exists at migration time to false. Only rows inserted AFTER this migration (i.e. via the
-- onboarding flow) inherit the true default. The login gate also treats a missing employees row
-- (e.g. the CEO, who has no employees row) as "no change required".
alter table employees add column if not exists must_change_password boolean not null default true;
update employees set must_change_password = false where must_change_password is true;

comment on column employees.must_change_password is
  'Forces a password change before dashboard access on next login. Set true by HR onboarding (temp password), cleared when the employee sets their own.';

-- ---------------------------------------------------------------------------
-- 2. qr_tokens
-- ---------------------------------------------------------------------------

create table if not exists qr_tokens (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  -- A long random opaque string generated app-side (crypto.randomUUID x2 / random bytes).
  -- NOT the employee's user id or email — see the header. Globally unique so a scanned value
  -- resolves to exactly one token row.
  token       text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create index if not exists qr_tokens_employee_id_idx on qr_tokens (employee_id);

-- At most ONE active token per employee. Revoking (is_active = false) frees the slot so a fresh
-- token can be issued for a reissued card. A partial unique index expresses "one active token"
-- without forbidding the historical revoked rows that make token history auditable.
create unique index if not exists qr_tokens_one_active_per_employee
  on qr_tokens (employee_id)
  where is_active;

-- ---------------------------------------------------------------------------
-- 3. RLS on qr_tokens — CEO + HR lead only; NO employee policy (by design)
-- ---------------------------------------------------------------------------

alter table qr_tokens enable row level security;

-- qr_tokens has no organization_id of its own; it scopes through the employee, exactly like
-- salary_records/appraisals in 0015 (auth_employee_org(employee_id) = auth_org_id()).

create policy "ceo_full_access_qr_tokens" on qr_tokens
  for all
  using (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id());

create policy "hr_lead_full_access_qr_tokens" on qr_tokens
  for all
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());

-- DELIBERATELY ABSENT: any employee-facing SELECT policy, and any auth_is_hr_member() policy.
-- An employee must never be able to read their own token value through the app (they present
-- the card, they don't need the string), and a regular HR Executive gets none of it either —
-- the same sensitivity-not-ownership restriction 0015 applies to salary. The future attendance
-- panel validates a scanned token via a server-side endpoint (POST /api/qr/resolve) on the
-- service-role client, which bypasses RLS after its own checks — not via a client table read.
-- Do not add a member or self policy here to "make a query work"; that would reopen exactly the
-- exposure this table exists to prevent.
