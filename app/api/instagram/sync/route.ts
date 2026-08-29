import { NextResponse, type NextRequest } from 'next/server'
import { instagramSyncSchema } from '@/lib/validation/schemas'
import { applySyncPayload, consumeSyncToken, ServiceError } from '@/lib/services/instagram'
import { badRequest } from '@/lib/api/responses'

/**
 * Intake for the local collection tool.
 *
 * THE ONE ROUTE IN THIS FEATURE WITH NO SESSION GUARD, and the reason is structural: the
 * caller is a script on a Marketing member's laptop, not a browser. It authenticates with a
 * bearer token from /api/instagram/sync-token instead — short-lived, single-use, and
 * authorising only this one action.
 *
 * WHY A LAPTOP AND NOT NETLIFY. The tool drives a real browser that the operator has logged
 * into Instagram themselves. A serverless function cannot hold that session — it has no
 * display, no persistent profile, and a lifetime measured in seconds. So collection runs
 * where the human is, and this endpoint is the seam between the two.
 *
 * WHAT THIS ENDPOINT CANNOT BE TALKED INTO. A valid token still cannot create an account
 * record: applySyncPayload looks the handle up among the org's connected accounts and
 * refuses an unknown one. So the blast radius of a leaked token is "refreshed the numbers on
 * a channel the team deliberately connected", which is what the tool does anyway.
 *
 * NOTE WHAT IS ABSENT FROM THE PAYLOAD SCHEMA: no password, no Instagram session cookie, no
 * OAuth token. The operator logs in interactively in their own browser, so there is nothing
 * of that kind to send and no field here that could carry it.
 */
export async function POST(request: NextRequest) {
  // Errors here are deliberately vague. An unknown, expired and already-spent token all
  // return the same 401, so probing cannot distinguish them.
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''

  const actor = await consumeSyncToken(token)
  if (!actor) {
    return NextResponse.json(
      { error: 'Invalid or expired sync token. Generate a new one in the ERP and try again.' },
      { status: 401 }
    )
  }

  try {
    const parsed = instagramSyncSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid sync payload', parsed.error.flatten())

    const result = await applySyncPayload(parsed.data, actor)

    return NextResponse.json({
      ok: true,
      username: result.username,
      postsWritten: result.postsWritten,
      postsRejected: result.postsRejected,
    })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    // Deliberately terse and logged rather than returned: the caller is a script on someone
    // else's machine, and an internal message is of no use to it.
    console.error('[instagram] sync failed', err)
    return NextResponse.json({ error: 'Could not store the collected data.' }, { status: 500 })
  }
}
