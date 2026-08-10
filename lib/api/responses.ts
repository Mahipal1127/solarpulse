import 'server-only'

import { NextResponse } from 'next/server'
import { ForbiddenError } from '@/lib/auth/guards'

/** Maps thrown guard/validation errors onto responses without leaking internals. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error('[api] unhandled error', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export function badRequest(message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, details }, { status: 400 })
}

export function notFound(message = 'Not found'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 })
}
