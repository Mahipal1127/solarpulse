/**
 * Validation for the operator-supplied AI base URL.
 *
 * Pure data and pure functions — no server-only guard, because the settings form
 * imports this to show the same error before saving that the route would return.
 * One implementation, two call sites; a second copy in the client would drift and
 * the client's copy is not the one that matters.
 *
 * WHY THIS FILE EXISTS AT ALL
 * Once a CEO can type the endpoint, the server makes an outbound request to a host
 * chosen by a user. That is the definition of SSRF, and the dangerous targets are
 * not obviously dangerous strings:
 *
 *   http://169.254.169.254/…   cloud instance metadata. On a default EC2 or GCE
 *                              instance this hands out IAM credentials to anything
 *                              that can make an HTTP request from the box. This is
 *                              the single most valuable target and it is a plain
 *                              unauthenticated GET.
 *   http://127.0.0.1:54321/…   Supabase's own local API, Postgres, Redis, any
 *                              admin panel bound to loopback on the assumption
 *                              that loopback is private.
 *   http://10.0.0.5/…          anything else inside the VPC.
 *
 * The prompt body is sent to whatever this names, so a hostile value is both an
 * internal port scanner and an exfiltration channel for org data.
 *
 * WHY IT IS NOT ENOUGH, AND WHAT IS ACTUALLY GUARANTEED
 * This blocks literal internal addresses and known-internal hostnames. It does NOT
 * resolve DNS, so `evil.example.com` with an A record pointing at 169.254.169.254
 * passes. Closing that hole properly means resolving the name and pinning the
 * socket to the resolved address at fetch time, which fetch() does not expose —
 * it needs a custom agent, and the check has to be re-done per redirect or the
 * attacker just returns a 302. That is real work and it is not done here, so:
 *
 *   The honest guarantee is "a careless value is rejected", not "a hostile CEO
 *   cannot reach the metadata service".
 *
 * That is an acceptable place to land only because of who holds this control. It
 * is CEO-only by RLS, every change is written to audit_logs, and the CEO can
 * already read every row in the organisation through the UI. This guard exists to
 * stop a copy-pasted or mistyped endpoint from quietly turning the app into a
 * proxy — not as a boundary against the person configuring it. If this ever
 * becomes settable by a lesser role, resolve-and-pin is required before that ships.
 */

/** Hosts that must never be fetched, matched exactly or as a suffix. */
const BLOCKED_HOSTS = [
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]

/** Suffixes that are internal by convention. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain']

export class BaseUrlError extends Error {}

/**
 * True when the hostname is an IP literal inside a range that never belongs to a
 * public AI endpoint.
 *
 * Deliberately parses the octets rather than pattern-matching the string: `10.1.2.3`
 * and `010.1.2.3` and `0xA.1.2.3` are the same address to a resolver, and a regex
 * against the leading digits catches only the first spelling.
 */
function isPrivateAddress(hostname: string): boolean {
  // IPv6 arrives from URL.hostname wrapped in brackets.
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname

  if (host.includes(':')) {
    const v6 = host.toLowerCase()
    // ::1 loopback, fc00::/7 unique-local, fe80::/10 link-local.
    if (v6 === '::1' || v6 === '::') return true
    if (/^f[cd]/.test(v6)) return true
    if (/^fe[89ab]/.test(v6)) return true
    // ::ffff:169.254.169.254 — an IPv4 address wearing an IPv6 costume.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return false
  }

  const parts = host.split('.')
  if (parts.length !== 4) return false

  const octets = parts.map((part) => {
    // parseInt with an explicit radix per spelling: 0x… is hex, a leading 0 is
    // octal to inet_aton, everything else decimal.
    if (/^0x[0-9a-f]+$/i.test(part)) return parseInt(part, 16)
    if (/^0[0-7]+$/.test(part)) return parseInt(part, 8)
    if (/^\d+$/.test(part)) return parseInt(part, 10)
    return NaN
  })
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false

  const [a, b] = octets
  if (a === 127) return true // loopback
  if (a === 10) return true // private
  if (a === 0) return true // "this host"
  if (a === 169 && b === 254) return true // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a >= 224) return true // multicast and reserved
  return false
}

/**
 * Normalises and rejects an operator-supplied base URL.
 *
 * Returns the URL with any trailing slash removed, because every adapter appends a
 * path beginning with `/` and `…/v1//chat/completions` is a 404 on some gateways
 * and a redirect on others.
 *
 * @param allowLoopback set only from a trusted server-side flag, never from request
 *   input. A self-hosted vLLM or Ollama on localhost is a real deployment, but it is
 *   also exactly the SSRF target, so it is opt-in per environment rather than a
 *   value the form can choose.
 */
export function normalizeBaseUrl(raw: string, allowLoopback = false): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new BaseUrlError('Enter the API base URL.')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new BaseUrlError('That is not a valid URL. Include the scheme, e.g. https://example.com/v1')
  }

  /*
   * https only. http would put the API key and the whole prompt — which carries
   * task titles, names and department data — on the wire in clear text. The
   * loopback exception is the one place that argument does not apply, since the
   * packet never leaves the machine.
   */
  if (url.protocol !== 'https:') {
    if (!(allowLoopback && url.protocol === 'http:')) {
      throw new BaseUrlError('The base URL must start with https://')
    }
  }

  /*
   * Credentials in the URL would be sent to the provider and, worse, written to
   * ai_settings.base_url — a column the CEO's own settings page reads back and
   * renders, unlike the key column which is deliberately unreadable. A password
   * pasted here would be visible in the form.
   */
  if (url.username || url.password) {
    throw new BaseUrlError('Remove the username and password from the URL. Use the API key field instead.')
  }

  const hostname = url.hostname.toLowerCase()
  const internal =
    BLOCKED_HOSTS.includes(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    isPrivateAddress(hostname)

  if (internal && !allowLoopback) {
    throw new BaseUrlError(
      'That address is inside the server’s own network. Point this at the provider’s public API host.'
    )
  }

  // Query strings and fragments are silently dropped rather than rejected: the
  // adapters append a path, so anything after the host would land in the middle of
  // the final URL and produce a confusing 404 rather than an error worth reading.
  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/+$/, '')
}

/** True when the value passes. For disabling a submit button without try/catch. */
export function isValidBaseUrl(raw: string, allowLoopback = false): boolean {
  try {
    normalizeBaseUrl(raw, allowLoopback)
    return true
  } catch {
    return false
  }
}
