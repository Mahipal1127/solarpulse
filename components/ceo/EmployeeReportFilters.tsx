'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

/**
 * The CEO's two-axis filter over employee report submissions: by department, and by the
 * individual person. Either works alone — pick a department to read a team's week, pick a
 * person to read only theirs, or combine them.
 *
 * Both live in the URL rather than in component state, which is what makes a filtered view
 * shareable and survivable across a refresh, and lets the page do the filtering in the
 * query instead of shipping every report to the browser to hide most of them.
 */

type Author = { id: string; name: string; departmentId: string | null }
type DepartmentOption = { id: string; name: string }

const selectClass =
  'rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-gold'

export function EmployeeReportFilters({
  departments,
  authors,
}: {
  departments: DepartmentOption[]
  authors: Author[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const department = searchParams.get('department') ?? ''
  const employee = searchParams.get('employee') ?? ''

  /**
   * Changing the department clears the person: the two would otherwise contradict each
   * other — someone who filed under Sales cannot also be inside a Store filter — and the
   * result is an empty list with two controls both looking correct.
   */
  function apply(next: { department?: string; employee?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'employees')

    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    if (next.department !== undefined) params.delete('employee')

    router.push(`${pathname}?${params.toString()}`)
  }

  /*
   * Only people who filed under the selected department. Their reports carry the
   * department recorded at submission time, so a person who has since transferred stays
   * with the reports they actually wrote rather than jumping to their new team's list.
   */
  const visibleAuthors = department
    ? authors.filter((a) => a.departmentId === department)
    : authors

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <select
        aria-label="Filter reports by department"
        className={selectClass}
        value={department}
        onChange={(e) => apply({ department: e.target.value })}
      >
        <option value="">All departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter reports by employee"
        className={selectClass}
        value={employee}
        onChange={(e) => apply({ employee: e.target.value })}
      >
        <option value="">
          {department ? 'Everyone in this department' : 'All employees'}
        </option>
        {visibleAuthors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      {(department || employee) && (
        <button
          type="button"
          onClick={() => router.push(`${pathname}?tab=employees`)}
          className="text-xs font-medium text-text-muted hover:text-brand-slate hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
