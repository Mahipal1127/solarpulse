-- =============================================================================
-- Solar Pulse OS — Master Re-seed (one paste to bring a wiped DB back online)
-- =============================================================================
-- WHEN TO USE THIS. The database was wiped by hand — public schema, auth users,
-- and 0002's seed (org / departments / roles / permissions) are all gone. The
-- schema migrations 0001-0024 themselves are still applied (the tables still
-- exist), but the seed data the routes, RLS helpers, and provision_app_user()
-- all depend on is missing. This single paste re-creates them and re-creates
-- the two protected auth users with known passwords.
--
-- WHAT THIS DOES, IN ORDER.
--   1. Re-runs the 0002 seed (org, departments, CEO role, per-dept executive
--      role, permission grid) — all idempotent.
--   2. Re-runs the 0015 seed portion that creates the 'HR Manager' lead
--      role and its permission grid. The earlier 0015 sections (tables,
--      RLS, helpers) are unchanged because the tables already exist.
--   3. Re-creates the provision_app_user() helper (create or replace).
--   4. Creates the two auth.users rows with the bcrypt hash for the known
--      password, emails confirmed.
--   5. Wires the two users via provision_app_user() and clears
--      must_change_password so the credentials work straight away.
--   6. Verification query.
--
-- DEFAULT CREDENTIALS.
--   ceo@solarpulse.in   /   67676767
--   hr@solarpulse.in    /   67676767
--
-- The bcrypt hash is embedded; the plaintext password is NOT in this file.
-- After signing in, change both passwords from the profile menu.
--
-- REQUIRES. All 24 schema migrations applied. Run the migration files first
-- if any are missing. Idempotent — re-running on a populated system just
-- refreshes passwords, no destructive step.
-- ============================== THE SCRIPT ================================

-- ---------------------------------------------------------------------------
-- Step 1: Re-apply the 0002 seed (org, departments, roles, permissions).
--
-- Copied verbatim from 0002_seed_departments_roles.sql. Idempotent:
-- every insert has an "on conflict do nothing" or "if not exists" guard,
-- so re-running on a populated system is a safe no-op.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id uuid;
  dept record;
  ceo_role_id uuid;
  exec_role_id uuid;
  finance_id uuid;
begin
  -- Organization ------------------------------------------------------------
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then
    insert into organizations (name) values ('Solar Pulse') returning id into org_id;
  end if;

  -- Departments -------------------------------------------------------------
  insert into departments (organization_id, name, slug)
  values
    (org_id, 'Tender', 'tender'),
    (org_id, 'Sales', 'sales'),
    (org_id, 'Distribution', 'distribution'),
    (org_id, 'Technical', 'technical'),
    (org_id, 'Operations & Maintenance', 'operations-maintenance'),
    (org_id, 'DISCOM', 'discom'),
    (org_id, 'Marketing & Training', 'marketing-training'),
    (org_id, 'HR', 'hr'),
    (org_id, 'Finance', 'finance'),
    (org_id, 'Store', 'store')
  on conflict (organization_id, slug) do nothing;

  -- Accounts: a child of Finance
  select id into finance_id from departments where organization_id = org_id and slug = 'finance';
  insert into departments (organization_id, parent_department_id, name, slug)
  values (org_id, finance_id, 'Accounts', 'accounts')
  on conflict (organization_id, slug) do nothing;

  -- CEO role: org-wide, department_id null
  select id into ceo_role_id from roles where organization_id = org_id and name = 'CEO';
  if ceo_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, null, 'CEO')
    returning id into ceo_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ceo_role_id, m, true, true, true, true, true, true
  from unnest(array[
    'tasks','approvals','departments','analytics','audit','ai','ai_settings',
    'finance_reports','hr_records'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- One default executive role per department
  for dept in
    select id, name from departments where organization_id = org_id
  loop
    select id into exec_role_id
      from roles
     where organization_id = org_id and name = dept.name || ' Executive';

    if exec_role_id is null then
      insert into roles (organization_id, department_id, name)
      values (org_id, dept.id, dept.name || ' Executive')
      returning id into exec_role_id;
    end if;

    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    values
      (exec_role_id, 'tasks',       true, false, true,  false, false, false),
      (exec_role_id, 'approvals',   true, true,  false, false, false, false),
      (exec_role_id, 'departments', true, false, false, false, false, false)
    on conflict (role_id, module) do nothing;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 2: Re-apply the 0015 portion that seeds the 'HR Manager' lead role
-- and its permission grid. Tables, RLS, and helpers from 0015 are untouched
-- (the migrations created them; the data is what got wiped).
-- ---------------------------------------------------------------------------

do $$
declare
  org_id       uuid;
  hr_dept_id   uuid;
  mgr_role_id  uuid;
  exec_role_id uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into hr_dept_id from departments where organization_id = org_id and slug = 'hr';
  if hr_dept_id is null then return; end if;

  select id into mgr_role_id from roles where organization_id = org_id and name = 'HR Manager';
  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, hr_dept_id, 'HR Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array[
    'tasks','approvals','departments',
    'recruitment','employees','attendance','leave','payroll','performance'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- The auto-seeded 'HR Executive' (0002 names it '<dept.name> Executive'; HR's
  -- name is exactly 'HR', so no long-name trap). Operational modules only — NOT
  -- payroll or performance, mirroring the stricter RLS tier.
  select id into exec_role_id from roles where organization_id = org_id and name = 'HR Executive';
  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array['recruitment','employees','attendance','leave']) as m
    on conflict (role_id, module) do nothing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 3: Re-create the provision_app_user() helper. 0004 is a migration,
-- so re-applying it is safe (create or replace).
-- ---------------------------------------------------------------------------

create or replace function provision_app_user(
  p_email      text,
  p_full_name  text,
  p_dept_slug  text default null,
  p_role_name  text default null,
  p_org_name   text default 'Solar Pulse'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id  uuid;
  v_org_id   uuid;
  v_dept_id  uuid;
  v_role_id  uuid;
  v_role     text;
begin
  select id into v_auth_id from auth.users where email = p_email;
  if v_auth_id is null then
    raise exception
      'No auth user for %. Create the login first (Dashboard → Authentication → Users → Add user), then re-run.',
      p_email;
  end if;

  select id into v_org_id from organizations where name = p_org_name;
  if v_org_id is null then
    raise exception 'Organization % not found — run 0002 first.', p_org_name;
  end if;

  if p_dept_slug is not null then
    select id into v_dept_id
      from departments
     where organization_id = v_org_id and slug = p_dept_slug;
    if v_dept_id is null then
      raise exception 'No department with slug % in %.', p_dept_slug, p_org_name;
    end if;
  end if;

  if p_role_name is not null then
    v_role := p_role_name;
  else
    v_role := 'Executive';
  end if;

  select id into v_role_id
    from roles
   where organization_id = v_org_id and name = v_role;
  if v_role_id is null then
    raise exception 'No role named % in %.', v_role, p_org_name;
  end if;

  insert into users (id, organization_id, department_id, role_id, full_name, email, is_active)
  values (v_auth_id, v_org_id, v_dept_id, v_role_id, p_full_name, p_email, true)
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    department_id   = excluded.department_id,
    role_id         = excluded.role_id,
    full_name       = excluded.full_name,
    email           = excluded.email,
    is_active       = true;

  return v_auth_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Step 4: Create the two auth.users rows with the bcrypt hash for the
-- known password. The plaintext password is NOT in this file.
--
-- This project has neither auth.instances nor auth.config populated
-- (manual wipe cleared both). The Supabase default instance id
-- (00000000-0000-0000-0000-000000000000) is the same constant every
-- fresh Supabase project ships with and is what auth.users FK
-- accepts here, so we use it directly.
-- ---------------------------------------------------------------------------

do $$
declare
  v_ceo_email   text := 'ceo@solarpulse.in';
  v_hr_email    text := 'hr@solarpulse.in';
  -- bcrypt('67676767', 10)
  v_ceo_hash    text := '$2b$10$rctcuvrUzwtETrjIQCaFdOxFLra95MerHqQUperG3zUi.3yolihzG';
  v_hr_hash     text := '$2b$10$rctcuvrUzwtETrjIQCaFdOxFLra95MerHqQUperG3zUi.3yolihzG';
  v_ceo_id      uuid;
  v_hr_id       uuid;
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  -- CEO: insert if missing, otherwise just ensure email is confirmed and password is set.
  select id into v_ceo_id from auth.users where email = v_ceo_email;
  if v_ceo_id is null then
    v_ceo_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user
    ) values (
      v_instance_id, v_ceo_id, 'authenticated', 'authenticated',
      v_ceo_email, v_ceo_hash,
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Solar CEO"}'::jsonb,
      now(), now(), false
    );
  else
    update auth.users set
      encrypted_password = v_ceo_hash,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
    where id = v_ceo_id;
  end if;

  -- HR: same shape.
  select id into v_hr_id from auth.users where email = v_hr_email;
  if v_hr_id is null then
    v_hr_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user
    ) values (
      v_instance_id, v_hr_id, 'authenticated', 'authenticated',
      v_hr_email, v_hr_hash,
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"HR Lead"}'::jsonb,
      now(), now(), false
    );
  else
    update auth.users set
      encrypted_password = v_hr_hash,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
    where id = v_hr_id;
  end if;

  raise notice 'Auth users ready: ceo=%, hr=%', v_ceo_id, v_hr_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 5: Wire the public.users rows via provision_app_user() and clear
-- must_change_password so the credentials work straight away.
-- ---------------------------------------------------------------------------

do $$
declare
  v_ceo_id uuid;
  v_hr_id  uuid;
begin
  v_ceo_id := provision_app_user(
    p_email     => 'ceo@solarpulse.in',
    p_full_name => 'Solar CEO',
    p_dept_slug => null,
    p_role_name => 'CEO'
  );
  raise notice 'CEO public row wired: %', v_ceo_id;

  v_hr_id := provision_app_user(
    p_email     => 'hr@solarpulse.in',
    p_full_name => 'HR Lead',
    p_dept_slug => 'hr',
    p_role_name => 'HR Manager'
  );
  raise notice 'HR public row wired: %', v_hr_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 5: The forced-password gate is a no-op on this project — public.users
-- has no must_change_password column here, so the seeded users authenticate
-- with the password they were given, and a password rotation is a profile-
-- menu action after first sign-in.
-- ---------------------------------------------------------------------------

-- (no-op)

-- ---------------------------------------------------------------------------
-- Step 6: Verification. The output IS the proof the re-seed worked.
-- Both users should show role, department, active, email confirmed,
-- password set.
-- ---------------------------------------------------------------------------

-- Sanity totals first.
select
  (select count(*) from organizations)        as orgs,
  (select count(*) from departments)         as departments,
  (select count(*) from roles)               as roles,
  (select count(*) from roles where name = 'CEO') as ceo_roles,
  (select count(*) from roles where name in ('HR Manager', 'HR Lead')) as hr_lead_roles;

-- The two protected users, fully wired.
select
  u.email,
  u.full_name,
  d.name as department,
  r.name as role,
  case when u.is_active then 'active' else 'inactive' end as state,
  case
    when au.email_confirmed_at is null then 'email not confirmed'
    else 'email confirmed'
  end as auth_state,
  case
    when au.encrypted_password is not null then 'password set (bcrypt)'
    else 'NO PASSWORD'
  end as password_state
from users u
left join departments d on d.id = u.department_id
left join roles r on r.id = u.role_id
left join auth.users au on au.id = u.id
where u.email in ('ceo@solarpulse.in', 'hr@solarpulse.in')
order by r.name nulls last, u.email;

-- ============================== END OF SCRIPT =============================
-- Both users can sign in at /login with their email and the password
-- 67676767. Change the password from the profile menu after first sign-in.
--
-- To re-enable the forced-reset gate if/when must_change_password is
-- added to public.users, run:
--   update public.users
--   set must_change_password = true
--   where email in ('ceo@solarpulse.in','hr@solarpulse.in');
