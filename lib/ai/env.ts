import 'server-only'

/**
 * Deployment-level switches for the AI configuration.
 *
 * server-only, and that guard is doing real work here rather than being decorative:
 * this decides whether the SSRF guard in lib/ai/baseUrl.ts is relaxed, so the answer
 * must come from the environment the server was started in and must never be
 * something a request can influence. Importing this from a client component is a
 * build error, which is the point.
 */

/**
 * Whether an AI base URL may point at localhost or a private address.
 *
 * Off unless AI_ALLOW_LOCAL_BASE_URL is exactly 'true'. Anything else — unset,
 * '1', 'yes', 'TRUE' — reads as off. A permissive parse here would be the wrong
 * kind of forgiving: this flag disables the check that stops the server being used
 * to reach cloud instance metadata (169.254.169.254) and services bound to
 * loopback on the assumption that loopback is private.
 *
 * The legitimate use is a self-hosted model on the same machine — Ollama on :11434,
 * vLLM on :8000. That is a real deployment, so the escape hatch exists; it is just
 * opt-in per environment rather than something the settings form can choose.
 * Whoever sets it is stating that everything reachable from the app server is
 * trusted, which is only true when they run both.
 */
export function allowLocalBaseUrl(): boolean {
  return process.env.AI_ALLOW_LOCAL_BASE_URL === 'true'
}
