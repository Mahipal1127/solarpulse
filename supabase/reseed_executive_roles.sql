-- =============================================================================
-- Solar Pulse OS — Re-seed missing department Executive roles
-- =============================================================================
-- WHEN TO USE THIS. The role picker (used during onboarding, the role
-- dropdown in the profile menu, etc.) only shows roles that exist for the
-- organisation. After a manual data wipe or a partial 0002 reseed, some
-- '<dept.name> Executive' roles may be missing even though the department
-- itself exists. The symptom is a role dropdown that shows the CEO, HR
-- Manager, and only a few of the per-department executive rows.
--
-- WHAT THIS DOES. For every department that already exists in the
-- organisation, it ensures the matching '<dept.name> Executive' role
-- exists and has the standard executive permission set (tasks read/edit,
-- approvals read/create, departments read). It is idempotent — re-running
-- is a no-op, and the unique-violation paths are silently absorbed by the
-- `on conflict do nothing` guards.
--
-- RUN IN. Supabase SQL editor, after the master reseed has confirmed
-- 11 departments are present.
-- ============================== THE SCRIPT ================================

do $$
declare
  org_id uuid;
  dept record;
  exec_role_id uuid;
  inserted_count int := 0;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then
    raise exception 'Solar Pulse organisation not found — run migration 0002 first.';
  end if;

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
      inserted_count := inserted_count + 1;
    end if;

    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    values
      (exec_role_id, 'tasks',       true, false, true,  false, false, false),
      (exec_role_id, 'approvals',   true, true,  false, false, false, false),
      (exec_role_id, 'departments', true, false, false, false, false, false)
    on conflict (role_id, module) do nothing;
  end loop;

  raise notice 'Inserted % new executive role(s).', inserted_count;
end
$$;

-- Verification: should show 1 CEO + 1 HR Manager + 11 Executives (one per dept).
select
  r.name as role,
  case when r.department_id is null then 'org-wide' else d.name end as department
from roles r
left join departments d on d.id = r.department_id
where r.organization_id = (select id from organizations where name = 'Solar Pulse')
order by r.name;
