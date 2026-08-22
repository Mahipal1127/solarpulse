/**
 * Password generation for the HR onboarding forms.
 *
 * Shared by the inline onboard form and the onboarding wizard, both of which are client components —
 * so this module must stay free of 'server-only' imports. It runs in the browser and uses the Web
 * Crypto API, never Math.random.
 */

/**
 * A readable temporary password HR can dictate over a phone call or write on a slip.
 *
 * The alphabet deliberately omits the character pairs people confuse when reading a password aloud
 * or copying it by hand: O/0, I/l/1. That matters more than raw entropy here — a password nobody can
 * transcribe gets replaced with "password123". 14 characters from a 56-character alphabet is ~81
 * bits, comfortably above the 8-character floor the schema enforces, and the employee is prompted to
 * change it on first sign-in anyway.
 */
export function generateTempPassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  // The modulo bias across 2^32 values over a 56-character alphabet is far below anything that
  // matters for a credential that is handed over once and then changed.
  return Array.from(values, (v) => alphabet[v % alphabet.length]).join('')
}
