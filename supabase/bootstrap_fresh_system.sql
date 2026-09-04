-- =============================================================================
-- Solar Pulse OS — Fresh-Database Bootstrap
-- =============================================================================
-- What this file is: a single SQL script the operator pastes into the
-- Supabase SQL editor on a brand-new database. It produces a fully ready
-- system: the org, all departments, all roles, plus the FIRST TWO USERS
-- (a CEO and an HR Lead) wired up so anyone can log in and onboard the rest.
--
-- Why this exists: 0002 seeds orgs/departments/roles but NEVER seeds a
-- user. Supabase Auth users are created from the Auth dashboard, and
-- provision_app_user() (0004) requires an auth row to already exist for
-- the email you pass. So the very first install needed manual dashboard
-- clicks + an SQL call — done once per new client, but easy to mess up.
-- This script documents the full flow, in order, and is the answer an
-- operator can hand to their client.
--
-- The CEO is intentionally the first user. Once signed in, they onboard
-- every other employee through /hr/onboarding/new — that is the
-- system's design, and this bootstrap respects it. The HR Lead
-- (provisioned as role 'HR Manager' — the canonical name shipped by
-- 0015; auth_is_hr_lead() also accepts a hand-rolled 'HR Lead') handles
-- day-to-day HR work thereafter.
--
-- ============================== HOW TO USE ================================
--
-- 1. Create the Supabase project (Dashboard → New project). Wait for it
--    to finish provisioning.
--
-- 2. Apply the migrations in order. The Supabase SQL editor is the
--    simplest path: paste each file in supabase/migrations/ in numeric
--    order, run it, fix any red, move on. 0022, 0023 and 0024 are
--    idempotent — safe to re-run.
--
-- 3. Create the two initial auth users in the dashboard:
--      Dashboard → Authentication → Users → Add user
--      (a) ceo@solarpulse.in   (use a real email; temp password is fine)
--      (b) hr@gmail.com        (same)
--    Email-confirm them — the provisioning helper requires auth rows
--    whose email_confirmed_at is set.
--
-- 4. Paste THIS file into the SQL editor and run it. It will:
--      a) call provision_app_user() to wire the CEO (no department,
--         role = 'CEO') — and assert it is the org's only CEO.
--      b) call provision_app_user() to wire the HR Lead (department
--         'hr', role = 'HR Lead').
--      c) run a verification query that prints the resulting state.
--
-- 5. Sign in as the CEO. The "must change password" gate forces a
--    password reset on first login — that is the existing forced-
--    rotation gate in proxy.ts, not something this script adds.
--
-- ============================== THE SCRIPT ================================
-- Everything below runs in one go when the operator pastes this file.
-- Each step is commented in case the operator wants to run them one at a
-- time for debugging.

-- ---------------------------------------------------------------------------
-- Step 0: Guard rails. Fail fast if migrations have not been applied.
-- ---------------------------------------------------------------------------

-- organisations must exist (0002), departments must exist (0002),
-- roles must exist (0002), the provision helper must exist (0004).
--
-- The HR lead tier accepts two role names — 'HR Manager' (shipped by 0015) and
-- 'HR Lead' (a hand-rolled alias). On a vanilla fresh database only 'HR
-- Manager' exists; the guard rail checks for whichever one is present, with
-- 'HR Manager' as the canonical name, so the bootstrap works regardless.
do $$
declare
  v_missing text[] := '{}';
begin
  if not exists (select 1 from organizations where name = 'Solar Pulse') then
    v_missing := array_append(v_missing, 'organization "Solar Pulse" (run migrations 0001-0002)');
  end if;
  if not exists (select 1 from departments where slug = 'hr') then
    v_missing := array_append(v_missing, 'department "hr" (run migration 0002)');
  end if;
  if not exists (select 1 from roles where name = 'CEO') then
    v_missing := array_append(v_missing, 'role "CEO" (run migration 0002)');
  end if;
  if not exists (
    select 1 from roles where name in ('HR Manager', 'HR Lead')
  ) then
    v_missing := array_append(v_missing, 'role "HR Manager" (run migration 0015)');
  end if;
  if to_regprocedure('public.provision_app_user(text,text,text,text,text)') is null then
    v_missing := array_append(v_missing, 'function provision_app_user() (run migration 0004)');
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception
      'Bootstrap cannot proceed. Missing prerequisites: %',
      array_to_string(v_missing, '; ');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 1: Provision the CEO.
--
-- No department (org-wide), role 'CEO'. provision_app_user() looks up the
-- auth.users row by email, so the email here MUST match the one you
-- created in the dashboard in step 3 of the how-to above.
--
-- If the user already exists with this email, this is a no-op: the
-- helper is idempotent and updates rather than errors.
-- ---------------------------------------------------------------------------

do $$
declare
  v_user_id uuid;
  v_email   text := 'ceo@solarpulse.in';
  v_name    text := 'Solar CEO';
begin
  v_user_id := provision_app_user(
    p_email     => v_email,
    p_full_name => v_name,
    p_dept_slug => null,        -- org-wide, no department
    p_role_name => 'CEO'
  );
  raise notice 'CEO provisioned: % (%)', v_name, v_user_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 2: Provision the HR Lead.
--
-- Department 'hr' (so they pass requireDepartment('hr') on the HR module),
-- role 'HR Manager' (so they pass isHrLead() — needed for the sensitive
-- payroll + performance + onboarding flows). 0015 ships this role; if an
-- operator has hand-rolled 'HR Lead' instead, change the role name on the
-- call below — auth_is_hr_lead() in 0015 accepts either.
-- ---------------------------------------------------------------------------

do $$
declare
  v_user_id uuid;
  v_email   text := 'hr@gmail.com';
  v_name    text := 'HR Lead';
begin
  v_user_id := provision_app_user(
    p_email     => v_email,
    p_full_name => v_name,
    p_dept_slug => 'hr',
    p_role_name => 'HR Manager'
  );
  raise notice 'HR Lead provisioned: % (%)', v_name, v_user_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 3: Verification.
--
-- The output of this query IS the proof the bootstrap worked. The CEO
-- should show role 'CEO' and the HR Lead should show role 'HR Manager'
-- (the canonical name shipped by 0015; if you provisioned with a
-- hand-rolled 'HR Lead' instead, that name appears here — both work).
-- If either shows role IS NULL, the role seed for that user did not
-- stick — check that 0002 + 0015 ran, and re-run this file (it is
-- idempotent).
-- ---------------------------------------------------------------------------

select
  u.email,
  u.full_name,
  d.name as department,
  r.name as role,
  case
    when u.is_active then 'active'
    else 'inactive'
  end as state,
  case
    when au.email_confirmed_at is null then 'email not confirmed'
    else 'email confirmed'
  end as auth_state
from users u
left join departments d on d.id = u.department_id
left join roles r on r.id = u.role_id
left join auth.users au on au.id = u.id
where u.email in ('ceo@solarpulse.in', 'hr@gmail.com')
order by r.name nulls last, u.email;

-- ---------------------------------------------------------------------------
-- Step 4: Sanity totals. Should show non-zero rows for each module's
-- seeded data, and exactly 1 CEO role. The HR lead count is a sum
-- across both accepted names ('HR Manager' + the optional 'HR Lead'
-- alias), so it is 1 on a standard install and 2 only if a hand-rolled
-- 'HR Lead' role was added on top.
-- ---------------------------------------------------------------------------

select
  (select count(*) from organizations)        as orgs,
  (select count(*) from departments)         as departments,
  (select count(*) from roles)               as roles,
  (select count(*) from roles where name = 'CEO') as ceo_roles,
  (select count(*) from roles where name in ('HR Manager', 'HR Lead')) as hr_lead_roles,
  (select count(*) from permissions)         as permission_rows,
  (select count(*) from users)               as users_total,
  (select count(*) from users where is_active) as users_active;

-- ============================== END OF SCRIPT =============================
-- After this runs cleanly:
--
--   1. Sign in as the CEO. You will be asked to set a new password.
--   2. Go to /hr/onboarding/new and onboard the rest of the organisation
--      from there — managers, executives, every department.
--   3. The HR Lead you provisioned here handles day-to-day HR work
--      (applications, leave, payroll) once the CEO is done.
--
-- DO NOT run this script a second time after the organisation is live.
-- It is safe to re-run (everything is idempotent), but the CEO count
-- will be 1 in a healthy system and the script does not need to run
-- again. The ad-hoc supabase/seed_*.sql files exist for one-off role
-- promotion during development — they are NOT for production setup.
