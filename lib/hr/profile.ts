import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { EmployeeDocument } from '@/lib/types'

/**
 * Read helpers for the shared Profile Board (HR + CEO). Every query runs on the session client, so
 * RLS decides what comes back: the CEO and HR lead see any employee in their org, an HR member sees
 * the roster (personnel fields), and an employee sees their own row + documents. No permission
 * logic lives here beyond what the database already grants — the SENSITIVE performance summary is
 * fetched separately through lib/services/performance.ts, which gates and is never joined in here.
 */

import { HR_DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from '@/lib/hr/constants'

/**
 * Signs an hr-documents path for inline display (profile photo, card image), or null when there is
 * no path or the sign fails. RLS on storage.objects governs the sign under the session client, so
 * a caller who cannot see the object gets null rather than a broken image. Not a download — no
 * `download` option, so the browser renders it in place.
 */
export async function signHrObject(path: string | null): Promise<string | null> {
  if (!path) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.storage
    .from(HR_DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

export interface EmployeeProfile {
  employeeId: string
  userId: string
  fullName: string
  email: string | null
  phone: string | null
  whatsappNumber: string | null
  designation: string | null
  employeeCode: string | null
  departmentName: string | null
  organizationName: string
  dateJoined: string | null
  employmentStatus: string
  profilePhotoPath: string | null
  idCardFilePath: string | null
  idCardGeneratedAt: string | null
}

/**
 * The identity header for one employee, or null if the caller cannot see them (RLS returns no row,
 * which we surface as a clean 404 upstream rather than an error). Joins users for name/email/dept.
 */
export async function getEmployeeProfile(employeeId: string): Promise<EmployeeProfile | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('employees')
    .select(
      'id, user_id, designation, employee_code, date_joined, employment_status, phone, whatsapp_number, profile_photo_path, id_card_file_path, id_card_generated_at, users!employees_user_id_fkey!inner(full_name, email, departments(name), organizations(name))'
    )
    .eq('id', employeeId)
    .maybeSingle()

  if (!data) return null

  const u = data.users as unknown as {
    full_name: string
    email: string | null
    departments: { name: string } | null
    organizations: { name: string } | null
  } | null

  return {
    employeeId: data.id as string,
    userId: data.user_id as string,
    fullName: u?.full_name ?? '—',
    email: u?.email ?? null,
    phone: (data.phone as string | null) ?? null,
    whatsappNumber: (data.whatsapp_number as string | null) ?? null,
    designation: (data.designation as string | null) ?? null,
    employeeCode: (data.employee_code as string | null) ?? null,
    departmentName: u?.departments?.name ?? null,
    organizationName: u?.organizations?.name ?? 'Solar Pulse',
    dateJoined: (data.date_joined as string | null) ?? null,
    employmentStatus: data.employment_status as string,
    profilePhotoPath: (data.profile_photo_path as string | null) ?? null,
    idCardFilePath: (data.id_card_file_path as string | null) ?? null,
    idCardGeneratedAt: (data.id_card_generated_at as string | null) ?? null,
  }
}

/**
 * An employee's documents for the Documents tab. RLS scopes visibility (CEO/HR-lead any, employee
 * own); a plain HR member sees rows per hr_member RLS. File contents are never returned — the tab
 * mints a signed URL on demand through /api/employee-documents/[id].
 */
export async function getEmployeeDocuments(employeeId: string): Promise<EmployeeDocument[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('employee_documents')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
  return (data ?? []) as EmployeeDocument[]
}

export interface DirectoryEntry {
  employeeId: string
  userId: string
  fullName: string
  designation: string | null
  departmentName: string | null
  employmentStatus: string
  /** Task completion % over the window, or null when the person has no assigned tasks. */
  completionRate: number | null
  taskCount: number
}

/**
 * The org-wide directory for the CEO, each row carrying a lightweight performance indicator.
 *
 * WHY THIS IS BATCHED, not a per-row getPerformanceSummary. A summary-per-employee would fire two
 * queries for every person — dozens of round-trips for a modest company. Instead this is exactly
 * TWO queries: the roster, and every task assigned in the window, which we fold into per-user
 * completion counts in memory. The indicator is deliberately just task completion (the cheapest,
 * most comparable signal) — the full attendance/hours breakdown stays on each person's board.
 *
 * VISIBILITY. This is a CEO surface; the CEO reads tasks and employees org-wide under RLS. It is
 * NOT wired for a lesser role — the route gates on requireRole('CEO'). Task completion is
 * operational, not compensation data, so showing it in a directory the CEO already governs does
 * not cross the strict-tier line the salary/appraisal rule draws.
 */
export async function getEmployeeDirectory(windowDays = 30): Promise<DirectoryEntry[]> {
  const supabase = await createSupabaseServerClient()
  const days = Math.min(Math.max(windowDays, 1), 365)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: roster }, { data: tasks }] = await Promise.all([
    supabase
      .from('employees')
      .select(
        'id, user_id, designation, employment_status, users!employees_user_id_fkey!inner(full_name, departments(name))'
      )
      .order('employment_status', { ascending: true }),
    supabase.from('tasks').select('assigned_user_id, status').gte('created_at', since),
  ])

  // Fold tasks into per-user {total, completed}.
  const byUser = new Map<string, { total: number; completed: number }>()
  for (const t of tasks ?? []) {
    const uid = t.assigned_user_id as string | null
    if (!uid) continue
    const agg = byUser.get(uid) ?? { total: 0, completed: 0 }
    agg.total++
    if (t.status === 'completed') agg.completed++
    byUser.set(uid, agg)
  }

  return (roster ?? []).map((row) => {
    const u = row.users as unknown as {
      full_name: string
      departments: { name: string } | null
    } | null
    const agg = byUser.get(row.user_id as string)
    return {
      employeeId: row.id as string,
      userId: row.user_id as string,
      fullName: u?.full_name ?? '—',
      designation: (row.designation as string | null) ?? null,
      departmentName: u?.departments?.name ?? null,
      employmentStatus: row.employment_status as string,
      completionRate: agg && agg.total > 0 ? Math.round((agg.completed / agg.total) * 100) : null,
      taskCount: agg?.total ?? 0,
    }
  })
}
