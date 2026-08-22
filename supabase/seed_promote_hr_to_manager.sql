-- Solar Pulse OS — promote all HR staff to the full HR Manager role.
--
-- WHY. The HR module shipped with two roles (0015): 'HR Manager' (full — onboarding, ID cards,
-- payroll, performance) and the auto-seeded 'HR Executive' (operational only — recruitment,
-- attendance, leave). The product decision is that HR should have ONE full-featured role, so this
-- moves every user currently on 'HR Executive' onto 'HR Manager'. It does NOT delete the Executive
-- role (other data may reference it, and the two-tier RLS still relies on the *name* 'HR Manager'
-- for the lead tier) — it just stops anyone from being stuck on the lesser role.
--
-- Safe to run more than once: it only touches users who are still on 'HR Executive'.
-- Run against the same database the app points at (Supabase SQL editor, or psql).

do $$
declare
  org_id       uuid;
  hr_dept_id   uuid;
  mgr_role_id  uuid;
  exec_role_id uuid;
  moved        int;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then
    raise notice 'No Solar Pulse org found — nothing to do.';
    return;
  end if;

  select id into hr_dept_id from departments where organization_id = org_id and slug = 'hr';
  if hr_dept_id is null then
    raise notice 'No HR department found — nothing to do.';
    return;
  end if;

  -- The full role. 0015 seeds it; create it here too so this seed is self-sufficient if run first.
  select id into mgr_role_id from roles where organization_id = org_id and name = 'HR Manager';
  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, hr_dept_id, 'HR Manager')
    returning id into mgr_role_id;

    -- Grant the manager permission set (mirrors 0015).
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select mgr_role_id, m, true, true, true, false, true, true
    from unnest(array[
      'tasks','approvals','departments',
      'recruitment','employees','attendance','leave','payroll','performance'
    ]) as m
    on conflict (role_id, module) do nothing;
  end if;

  -- Move every HR Executive user onto HR Manager.
  select id into exec_role_id from roles where organization_id = org_id and name = 'HR Executive';
  if exec_role_id is not null then
    update users
    set role_id = mgr_role_id
    where organization_id = org_id
      and role_id = exec_role_id;
    get diagnostics moved = row_count;
    raise notice 'Promoted % HR Executive user(s) to HR Manager.', moved;
  else
    raise notice 'No HR Executive role present; nothing to move.';
  end if;
end;
$$;
