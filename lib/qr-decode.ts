/**
 * Shared QR decoding for the client surfaces that read ID-card codes — the
 * attendance kiosk and the password-reset wizard. One decoder, so the two
 * surfaces cannot drift apart on how hard they try to read a card.
 * A single full-frame decode is the weakest reader: a small code in a large
 * frame loses its pixels to the downscale, and glare or a dark doorway can
 * invert the contrast. So each attempt walks a ladder:
 *
 *   1. Full frame, downscaled to maxEdge — the fast attempt that catches a
 *      card held close.
 *   2. Center crops at 80% and 60% of the frame, decoded at NEAR-FULL
 *      resolution — a small or distant code keeps the pixels the full-frame
 *      attempt threw away. The 60% crop also matches the on-screen frame
 *      guide, so "fill the frame" is literally what gets decoded.
 *
 * Every attempt runs with jsQR's inverted-code search enabled, which reads
 * glare-blown cards where the QR's dark modules reflect brighter than the
 * light ones. First success in the ladder wins; a ladder that reads nothing
 * is genuinely "no code in this frame", not "code too small to see".
 */

import jsQR from 'jsqr'

/** jsQR reads inverted codes — the glare case — when asked to attempt both. */
const INVERSION = { inversionAttempts: 'attemptBoth' } as const

/** Longest edge of the full-frame (fast) attempt. */
const FULL_FRAME_EDGE = 960

/** Longest edge of a crop attempt. A crop is small, so it can afford more
 *  pixels than the full frame — that is the whole point of the ladder. */
const CROP_EDGE = 1280

/**
 * One canvas reused across every rung. At scanning pace the ladder runs many
 * times a second; allocating a canvas and a 2D context per attempt churns
 * exactly the objects the browser then has to warm again. Assigning
 * width/height clears the reused backing store, which is all a fresh
 * drawImage needs anyway.
 */
let sharedCanvas: HTMLCanvasElement | null = null
let sharedContext: CanvasRenderingContext2D | null = null

function attemptDecode(
  source: CanvasImageSource,
  region: { x: number; y: number; w: number; h: number },
  maxEdge: number
): string | null {
  const scale = Math.min(1, maxEdge / Math.max(region.w, region.h))
  if (!sharedCanvas || !sharedContext) {
    sharedCanvas = document.createElement('canvas')
    sharedContext = sharedCanvas.getContext('2d', { willReadFrequently: true })
  }
  const canvas = sharedCanvas
  const ctx = sharedContext
  if (!canvas || !ctx) return null
  canvas.width = Math.max(1, Math.round(region.w * scale))
  canvas.height = Math.max(1, Math.round(region.h * scale))
  ctx.drawImage(
    source,
    region.x,
    region.y,
    region.w,
    region.h,
    0,
    0,
    canvas.width,
    canvas.height
  )
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(pixels.data, pixels.width, pixels.height, INVERSION)
  return code?.data ?? null
}

/**
 * Reads a QR token from any drawable source — a video frame or an uploaded
 * image — walking the crop ladder. Returns the decoded string, or null when
 * no code is in the frame. The token is 256 bits of opaque text (0018), so a
 * partial or garbled read is rejected downstream as an unknown card rather
 * than misattributing anything to a colleague.
 */
export function decodeQrToken(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: { cropLadder?: number[] } = {}
): string | null {
  if (sourceWidth <= 0 || sourceHeight <= 0) return null
  const ladder = options.cropLadder ?? [1, 0.8, 0.6]

  for (const fraction of ladder) {
    const regionW = Math.round(sourceWidth * fraction)
    const regionH = Math.round(sourceHeight * fraction)
    const region = {
      x: Math.round((sourceWidth - regionW) / 2),
      y: Math.round((sourceHeight - regionH) / 2),
      w: regionW,
      h: regionH,
    }
    const token = attemptDecode(source, region, fraction >= 1 ? FULL_FRAME_EDGE : CROP_EDGE)
    if (token) return token
  }
  return null
}