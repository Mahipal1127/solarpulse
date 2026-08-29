-- ---------------------------------------------------------------------------
-- 0019 — Employee report submissions
--
-- WHAT THIS IS FOR
-- Every employee, in every department, submits a periodic report of their own work —
-- daily, weekly or monthly — as free text, an attached file, or both. The CEO reads
-- what came in, filtered by department or by person.
--
-- WHY A NEW TABLE RATHER THAN department_reports
-- department_reports (0001) is a per-DEPARTMENT daily rollup, keyed
-- unique (department_id, report_date). It cannot hold two people's submissions for the
-- same day, has no period concept, no attachment, no draft/submitted state and no
-- author column. Widening it would break the CEO reports page that reads it today.
-- The comment at app/(ceo)/reports/page.tsx said exactly this: "There is no separate
-- per-employee report table yet. When one is wanted, it needs a migration and its own
-- RLS policy" — this is that migration.
--
-- NOT task_updates EITHER. That is the append-only per-task progress log; a row there
-- answers "what happened on THIS task". A report answers "what did I do this week",
-- spans tasks, and is deliberately authored and submitted as one document. The CEO's
-- "By person" tab keeps reading task_updates and is untouched.
--
-- THE AI RULE, INHERITED FROM lib/ai/summary.ts
-- The generated draft is phrasing, never a source of figures. The route computes the
-- employee's real numbers from the database and hands them to the model, which may only
-- word them. Nothing the model returns is stored as a metric — ai_generated below marks
-- provenance so the CEO can see a draft was machine-written, and the employee edits and
-- submits it under their own name either way.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table employee_reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- The author. Reports are personal: this is the one column every policy below keys on.
  -- on delete cascade, not set null — an unattributed report is not a report, and unlike
  -- audit_logs there is no compliance reason to keep the row after the person is gone.
  user_id         uuid not null references users(id) on delete cascade,

  -- Denormalised from users.department_id ON PURPOSE. The CEO filters by department, and
  -- a person can move departments; this records where they were when they filed, so last
  -- quarter's reports do not silently migrate to their new team. Set by the service layer
  -- from the session, never supplied by the client.
  -- Nullable because users.department_id is (the CEO has none) — a CEO-authored report
  -- simply files under no department.
  department_id   uuid references departments(id) on delete set null,

  -- 'daily' | 'weekly' | 'monthly'. Plain text with a documented value list, matching the
  -- 0015/0016/0017 convention: no new enum types, no check constraint, so adding
  -- 'quarterly' later is an app change and not a migration that rewrites the column.
  period          text not null default 'daily',

  -- The window the report covers. Both DATE, both required, and both computed app-side
  -- from the period so a "weekly" report cannot silently cover one day. period_end is
  -- INCLUSIVE — a daily report has period_start = period_end.
  period_start    date not null,
  period_end      date not null,

  -- The report itself. Nullable because an attachment-only submission is valid; the
  -- CHECK below is what guarantees a report is never completely empty.
  content         text,

  -- Storage object path in the employee-reports bucket, or null. One file per report:
  -- a second upload replaces the first, which is why this is a column and not a child
  -- table. Shape: '{organization_id}/{user_id}/{uuid}-{filename}'. The uuid rather than
  -- the report id, because the browser uploads before the row exists — the policies
  -- below only parse the first two segments, so the tail is free-form.
  attachment_path text,
  attachment_name text,

  -- Provenance, not a quality judgement: true when the text started as an AI draft. The
  -- employee still reviews, edits and submits it. Shown to the CEO so a machine-written
  -- passage is never mistaken for a hand-written one.
  ai_generated    boolean not null default false,

  -- 'draft' | 'submitted'. A draft is the employee's private working copy — the SELECT
  -- policies below deliberately hide it from the CEO until it is submitted, so half-written
  -- thoughts are not read as a report.
  status          text not null default 'draft',
  submitted_at    timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A report must say something. Text, a file, or both — never neither. This is the
  -- database half of the "at least one is required" rule the form also enforces.
  constraint employee_reports_not_empty
    check (coalesce(nullif(trim(content), ''), attachment_path) is not null),

  -- period_end is inclusive, so equality is valid (a daily report).
  constraint employee_reports_period_order check (period_end >= period_start),

  -- Submitted means submitted AT something. Keeps the CEO's ordering honest — a
  -- submitted row with a null timestamp would sort as if it had never arrived.
  constraint employee_reports_submitted_at
    check (status <> 'submitted' or submitted_at is not null)
);

-- The CEO's list: newest submissions first, org-scoped. Covers the unfiltered view and
-- the by-department filter both, since department_id is the second column.
create index employee_reports_org_submitted_idx
  on employee_reports (organization_id, submitted_at desc nulls last);

create index employee_reports_dept_idx
  on employee_reports (department_id, submitted_at desc nulls last);

-- The employee's own list, and the "do I already have a draft for this period" lookup.
create index employee_reports_user_idx
  on employee_reports (user_id, period_start desc);

create trigger employee_reports_set_updated_at
  before update on employee_reports
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Three rules, and nothing else:
--   1. An employee reads and writes their OWN reports, in any status.
--   2. The CEO reads every SUBMITTED report in the org, and cannot write any.
--   3. A department manager reads their own department's SUBMITTED reports.
--
-- Rule 3 is the one worth pausing on. It is deliberately NOT "any colleague can read
-- your report": a report is a personal account of your work, closer to an appraisal than
-- to a shared task. Leads get it because they are accountable for the department's
-- output; peers do not.
--
-- Nobody can UPDATE or DELETE someone else's report — not the CEO, not the lead. The
-- CEO reports page is explicit that it shows "their words, not edits made here", and
-- these policies are what make that true rather than merely stated.
-- ---------------------------------------------------------------------------

alter table employee_reports enable row level security;

-- 1. Own reports — full control, drafts included.
create policy "employee_manage_own_reports" on employee_reports
  for all
  using (user_id = auth.uid() and organization_id = auth_org_id())
  with check (user_id = auth.uid() and organization_id = auth_org_id());

-- 2. CEO — read-only, submitted only. No write policy exists for the CEO at all.
create policy "ceo_view_submitted_reports" on employee_reports
  for select
  using (auth_is_ceo() and organization_id = auth_org_id() and status = 'submitted');

-- 3. Department managers — read-only, own department, submitted only.
-- Matches on the role NAME suffix, exactly like auth_is_department_manager() (0006) and
-- isDepartmentManager() in guards.ts. A role named "<Dept> Lead" satisfies none of the
-- three and would silently see nothing — the same trap 0013 documents at length.
create policy "manager_view_department_reports" on employee_reports
  for select
  using (
    status = 'submitted'
    and organization_id = auth_org_id()
    and department_id is not null
    and exists (
      select 1 from users u
      join roles r on r.id = u.role_id
      where u.id = auth.uid()
        and u.is_active
        and u.department_id = employee_reports.department_id
        and r.name like '%Manager'
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: private employee-reports bucket for report attachments.
--
-- Objects live under '{organization_id}/{user_id}/{uuid}-{filename}'. Mirrors
-- store-media (0017) and finance-documents (0016): a helper parses the leading
-- org-folder to a uuid and every policy scopes on it, so a path that does not begin
-- with a valid uuid matches nothing rather than matching everything.
--
-- The second folder is the AUTHOR's id, and the write policies check it. That is what
-- stops an employee uploading into another employee's report folder — the table policies
-- above cannot see storage paths, so the guarantee has to be restated here.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('employee-reports', 'employee-reports', false)
on conflict (id) do nothing;

create or replace function employee_report_object_org(object_name text)
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

-- The author's id — the second path segment. Same uuid guard: a malformed path resolves
-- to null, and null never equals auth.uid(), so it is refused.
create or replace function employee_report_object_owner(object_name text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare folder text;
begin
  folder := (storage.foldername(object_name))[2];
  if folder is null then return null; end if;
  if folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return folder::uuid;
end;
$$;

-- The author: full control over files under their own folder only.
create policy "employee_reports_own_objects" on storage.objects
  for all
  using (
    bucket_id = 'employee-reports'
    and employee_report_object_org(name) = auth_org_id()
    and employee_report_object_owner(name) = auth.uid()
  )
  with check (
    bucket_id = 'employee-reports'
    and employee_report_object_org(name) = auth_org_id()
    and employee_report_object_owner(name) = auth.uid()
  );

-- The CEO: read only, and only files belonging to a report that has been SUBMITTED.
-- Without that join the CEO could fetch the attachment of a draft the table policy
-- deliberately hides — the file is the report, so the two must agree.
create policy "employee_reports_ceo_objects" on storage.objects
  for select
  using (
    bucket_id = 'employee-reports'
    and auth_is_ceo()
    and employee_report_object_org(name) = auth_org_id()
    and exists (
      select 1 from employee_reports er
      where er.attachment_path = storage.objects.name
        and er.status = 'submitted'
    )
  );

-- Department managers: same read-only rule, bounded to their own department. Mirrors
-- policy 3 on the table, including the '%Manager' name match.
create policy "employee_reports_manager_objects" on storage.objects
  for select
  using (
    bucket_id = 'employee-reports'
    and employee_report_object_org(name) = auth_org_id()
    and exists (
      select 1
      from employee_reports er
      join users u on u.id = auth.uid()
      join roles r on r.id = u.role_id
      where er.attachment_path = storage.objects.name
        and er.status = 'submitted'
        and er.department_id is not null
        and u.is_active
        and u.department_id = er.department_id
        and r.name like '%Manager'
    )
  );
