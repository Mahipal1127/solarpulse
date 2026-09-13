/**
 * A time-of-day greeting on IST, with the person's first name.
 *
 * Asia/Kolkata rather than the server's zone. Every other date in this app is
 * formatted 'en-IN' and money is INR, so the business runs on IST — a greeting
 * derived from a UTC host clock would tell someone "good morning" at half past five
 * in the evening.
 *
 * Shared by the CEO's Pulse AI page and the Pulse AI panel on every department
 * dashboard, so both surfaces greet identically: one clock, one rule, no drift.
 * Computed server-side and passed down as a plain string prop, which also keeps the
 * clock out of hydration.
 */
export function greetingFor(fullName: string | null): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  )

  const timeOfDay =
    hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // First name only. "Good morning, Mahipal Singh Rathore" is a form letter.
  const firstName = fullName?.trim().split(/\s+/)[0]
  return firstName ? `${timeOfDay}, ${firstName}` : timeOfDay
}