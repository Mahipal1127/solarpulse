-- Solar Pulse OS
-- Migration 0004: provision_app_user() helper
--
-- 0002 seeds the org, departments and roles but no users, and there is no
-- trigger on auth.users — so creating a login in Supabase Auth leaves you with
-- an auth identity and no matching public.users row, which getSessionUser()
-- reads as "not signed in".
--
-- This links the two. Create the login first (Dashboard → Authentication →
-- Users → Add user, or auth.admin.createUser), then call this with the same
-- email. No password ever touches this file.
--
--   select provision_app_user('tender.exec@solarpulse.test', 'Priya Nair', 'tender');
--   select provision_app_user('ceo@solarpulse.test', 'A. Rao', null, 'CEO');
--
-- Idempotent: calling it again for an existing user updates their department,
-- role and name rather than erroring.

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

  -- Default to the department's seeded "<Name> Executive" role.
  v_role := coalesce(
    p_role_name,
    (select name || ' Executive' from departments where id = v_dept_id)
  );
  if v_role is null then
    raise exception 'Pass either a department slug or an explicit role name.';
  end if;

  select id into v_role_id
    from roles
   where organization_id = v_org_id and name = v_role;
  if v_role_id is null then
    raise exception 'No role named % in %.', v_role, p_org_name;
  end if;

  insert into users (id, organization_id, department_id, role_id, full_name, email, is_active)
  values (v_auth_id, v_org_id, v_dept_id, v_role_id, p_full_name, p_email, true)
  on conflict (id) do update
    set department_id = excluded.department_id,
        role_id       = excluded.role_id,
        full_name     = excluded.full_name,
        is_active     = true,
        updated_at    = now();

  return v_auth_id;
end;
$$;

-- Callable from the SQL editor / service role only. Not granted to authenticated
-- or anon: it is security definer and writes users rows, so exposing it to the
-- app would be a privilege-escalation path straight past RLS.
revoke execute on function provision_app_user(text, text, text, text, text) from public;
revoke execute on function provision_app_user(text, text, text, text, text) from anon;
revoke execute on function provision_app_user(text, text, text, text, text) from authenticated;
