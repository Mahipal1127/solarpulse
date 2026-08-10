-- Solar Pulse OS
-- Migration 0006: fix per-employee task isolation on `tasks`
--
-- The Sales module spec requires that a task the CEO assigns to one employee
-- appear in that employee's dashboard and NOWHERE ELSE — explicitly not in a
-- colleague's dashboard, even though both are in the same department. It states
-- this is already enforced by the CEO module and should be verified rather than
-- rebuilt. Verified: it is not enforced. The 0001 policies were
--
--   using (
--     organization_id = auth_org_id()
--     and (assigned_department_id = auth_department_id() or assigned_user_id = auth.uid())
--   )
--
-- where the first branch of that OR lets ANY department member read EVERY task
-- assigned to their department, including one addressed to a specific
-- colleague. That is the leak this migration closes.
--
-- The replacement has to distinguish two cases that the old policy conflated:
--
--   assigned_user_id = <a colleague>  → hidden from me         (the fix)
--   assigned_user_id is null          → visible to my department (NOT a leak:
--                                        nobody owns it yet, and the manager
--                                        needs to see it to delegate)
--
-- Collapsing both into "only my own tasks" would have regressed Tender, whose
-- department-general tasks would have become invisible to every Tender member.

-- ---------------------------------------------------------------------------
-- Helper: does the caller manage their own department?
--
-- Generic over departments rather than Sales-specific: role names follow the
-- '<Department> Manager' convention seeded in 0005, so this also covers manager
-- roles added for future department modules without another migration.
-- ---------------------------------------------------------------------------

create or replace function auth_is_department_manager()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    where u.id = auth.uid()
      and u.is_active
      and u.department_id is not null
      and r.name like '%Manager'
  );
$$;

-- ---------------------------------------------------------------------------
-- Replace the leaking policies
-- ---------------------------------------------------------------------------

drop policy if exists "department_view_own_tasks"   on tasks;
drop policy if exists "department_update_own_tasks" on tasks;

-- Read: my own tasks, my department's unclaimed tasks, and — if I manage the
-- department — everything assigned into it.
create policy "member_view_relevant_tasks" on tasks
  for select
  using (
    organization_id = auth_org_id()
    and (
      assigned_user_id = auth.uid()
      or (
        assigned_department_id = auth_department_id()
        and (assigned_user_id is null or auth_is_department_manager())
      )
    )
  );

-- Write: employees may progress their own task. Managers may also write any
-- task in their department, which is what makes delegation possible —
-- reassigning an unclaimed department task by setting assigned_user_id.
--
-- with check mirrors using, so a manager cannot push a task out of their own
-- department and an employee cannot reassign their task to someone else.
create policy "member_update_relevant_tasks" on tasks
  for update
  using (
    organization_id = auth_org_id()
    and (
      assigned_user_id = auth.uid()
      or (auth_is_department_manager() and assigned_department_id = auth_department_id())
    )
  )
  with check (
    organization_id = auth_org_id()
    and (
      assigned_user_id = auth.uid()
      or (auth_is_department_manager() and assigned_department_id = auth_department_id())
    )
  );

-- ---------------------------------------------------------------------------
-- task_updates follows tasks
--
-- Same leak: the 0001 policies scoped through `t.assigned_department_id =
-- auth_department_id() or t.assigned_user_id = auth.uid()`, so progress notes
-- on a colleague's task were readable department-wide.
-- ---------------------------------------------------------------------------

drop policy if exists "department_view_task_updates"   on task_updates;
drop policy if exists "department_insert_task_updates" on task_updates;

create policy "member_view_task_updates" on task_updates
  for select
  using (exists (
    select 1 from tasks t
    where t.id = task_updates.task_id
      and t.organization_id = auth_org_id()
      and (
        t.assigned_user_id = auth.uid()
        or (
          t.assigned_department_id = auth_department_id()
          and (t.assigned_user_id is null or auth_is_department_manager())
        )
      )
  ));

create policy "member_insert_task_updates" on task_updates
  for insert
  with check (
    updated_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_updates.task_id
        and t.organization_id = auth_org_id()
        and (
          t.assigned_user_id = auth.uid()
          or (auth_is_department_manager() and t.assigned_department_id = auth_department_id())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- task_attachments follows tasks, for the same reason
-- ---------------------------------------------------------------------------

drop policy if exists "department_view_task_attachments" on task_attachments;
drop policy if exists "department_add_task_attachments"  on task_attachments;

create policy "member_view_task_attachments" on task_attachments
  for select
  using (exists (
    select 1 from tasks t
    where t.id = task_attachments.task_id
      and t.organization_id = auth_org_id()
      and (
        t.assigned_user_id = auth.uid()
        or (
          t.assigned_department_id = auth_department_id()
          and (t.assigned_user_id is null or auth_is_department_manager())
        )
      )
  ));

create policy "member_add_task_attachments" on task_attachments
  for insert
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_attachments.task_id
        and t.organization_id = auth_org_id()
        and (
          t.assigned_user_id = auth.uid()
          or (auth_is_department_manager() and t.assigned_department_id = auth_department_id())
        )
    )
  );
