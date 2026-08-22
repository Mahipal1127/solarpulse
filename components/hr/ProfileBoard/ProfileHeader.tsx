import { Badge } from '@/components/ui/primitives'
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_STYLES } from '@/lib/format'
import type { EmployeeProfile } from '@/lib/hr/profile'
import type { EmploymentStatus } from '@/lib/types'

/**
 * Identity header for the Profile Board — photo (or initials), name, designation, department, and
 * status. Shared by the HR and CEO routes. photoUrl is a signed URL prepared server-side (null
 * renders the initials tile), so no client fetch and no raw storage path reaches the browser.
 */
export function ProfileHeader({
  profile,
  photoUrl,
}: {
  profile: EmployeeProfile
  photoUrl: string | null
}) {
  const status = profile.employmentStatus as EmploymentStatus
  const initials = profile.fullName
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="flex flex-wrap items-start gap-4 px-5 py-5">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={profile.fullName}
          className="h-20 w-20 shrink-0 rounded-2xl object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-brand-slate text-2xl font-bold text-white">
          {initials}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-brand-slate">{profile.fullName}</h1>
          <Badge className={EMPLOYMENT_STATUS_STYLES[status]}>
            {EMPLOYMENT_STATUS_LABELS[status] ?? profile.employmentStatus}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {profile.designation ?? 'No designation'}
          {profile.departmentName ? ` · ${profile.departmentName}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          {profile.employeeCode && <span>ID: {profile.employeeCode}</span>}
          {profile.email && <span>{profile.email}</span>}
          {profile.phone && <span>{profile.phone}</span>}
          {profile.dateJoined && (
            <span>Joined {new Date(profile.dateJoined).toLocaleDateString()}</span>
          )}
        </div>
      </div>
    </div>
  )
}
