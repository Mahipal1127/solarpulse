'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Flashlight, FlashlightOff, LogIn, LogOut, ScanFace, Volume2 } from 'lucide-react'
import { decodeQrToken } from '@/lib/qr-decode'
import type { KioskMarkResult } from '@/lib/services/kiosk'

/**
 * The attendance kiosk screen.
 *
 * THE LOOP AN EMPLOYEE LIVES IN
 * Scan → the side panel fills with their photo and name, the machine says the
 * name out loud, the day's check-in or check-out is written, and the result
 * holds on screen for a few seconds before the kiosk clears itself for the
 * next person. No button, no session, no typing.
 *
 * SPEECH. window.speechSynthesis — built into every modern browser, no
 * dependency, no network round trip. Announced only after a SUCCESSFUL write
 * (or an explicit "already marked out"), never for an error: a machine that
 * talks over its own failure messages teaches people to ignore it.
 *
 * SCANNING IS jsQR, via the shared crop-ladder decoder (lib/qr-decode.ts):
 * full frame first, then 80% and 60% center crops at near-full resolution, so
 * a small or distant code keeps the pixels a flat downscale throws away, and
 * inverted (glare-blown) codes read. The token is 256 bits of opaque text, so
 * a misread frame is rejected by the server as an unrecognised card rather
 * than misattributing attendance to a colleague.
 *
 * TWO-FRAME AGREEMENT. A token must decode identically on two consecutive
 * frames before the kiosk acts. A torn or half-glimpsed frame that happens to
 * decode is noise by definition, and agreement across frames is what separates
 * a real card from one artefact. The screen shows "Hold steady" while the
 * second frame is being confirmed, so the employee knows not to move.
 *
 * TORCH. Doorways are dark and cards are glossy. When the camera supports a
 * flash (most rear Android cameras), a toggle lights the scan — often the
 * difference between a kiosk that works in the morning and one that works at
 * 9 am only.
 */

/** Same-token cooldown: a double-scan must not become a check-out. */
const COOLDOWN_MS = 15_000
/** How long a result holds on screen before the kiosk clears for the next person. */
const RESULT_HOLD_MS = 9_000
/** Milliseconds without a confirming decode before a pending read is discarded. */
const PENDING_WINDOW_MS = 1_500

interface ScanOutcome {
  key: number
  ok: boolean
  title: string
  detail: string
  result?: KioskMarkResult
}

/** Announces the scan outcome out loud. Silent when the browser lacks TTS. */
function speak(outcome: ScanOutcome) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const name = outcome.result?.identity.fullName.split(/\s+/)[0]
  const text =
    outcome.result?.action === 'in'
      ? `Welcome ${name}. Marked in.`
      : outcome.result?.action === 'out'
        ? `Goodbye ${name}. Marked out. ${Math.round(((outcome.result.workedMinutes ?? 0) / 60) * 10) / 10} hours worked today.`
        : outcome.result?.action === 'already_out'
          ? `${name}, you have already marked out today.`
          : outcome.title
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.05
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

function formatClock(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

export function KioskScanner() {
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [history, setHistory] = useState<ScanOutcome[]>([])
  // A read is in progress: the first agreeing frame decoded and the kiosk is
  // confirming it. Shown as "Hold steady" so nobody moves mid-read.
  const [confirming, setConfirming] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const rafRef = useRef<number | null>(null)
  // Per-token cooldown and a latest-ref handler, so the camera loop never
  // needs to be torn down when state changes.
  const cooldownRef = useRef<Map<string, number>>(new Map())
  const handleRef = useRef<(token: string) => void>(() => {})

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    trackRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
    setConfirming(false)
    setTorchOn(false)
    setTorchAvailable(false)
  }, [])

  async function toggleTorch() {
    const track = trackRef.current
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      setTorchAvailable(false)
    }
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  async function handleToken(rawToken: string) {
    const token = rawToken.trim()
    if (!token) return

    const now = Date.now()
    const lastSeen = cooldownRef.current.get(token) ?? 0
    if (now - lastSeen < COOLDOWN_MS) return
    cooldownRef.current.set(token, now)

    let outcome: ScanOutcome
    try {
      const res = await fetch('/api/attendance/kiosk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = (await res.json().catch(() => ({}))) as
        | KioskMarkResult
        | { error?: string }

      if (!res.ok || !('identity' in body)) {
        const message =
          'error' in body && body.error ? body.error : 'This card is not recognised.'
        outcome = { key: now, ok: false, title: 'Card not recognised', detail: message }
      } else {
        const mark = body as KioskMarkResult
        const firstName = mark.identity.fullName.split(/\s+/)[0]
        if (mark.action === 'in') {
          outcome = {
            key: now,
            ok: true,
            title: `Marked IN · ${formatClock(mark.checkIn)}`,
            detail: `Have a good day, ${firstName}.`,
            result: mark,
          }
        } else if (mark.action === 'out') {
          const hours = Math.round(((mark.workedMinutes ?? 0) / 60) * 10) / 10
          outcome = {
            key: now,
            ok: true,
            title: `Marked OUT · ${formatClock(mark.checkOut)}`,
            detail:
              mark.status === 'half_day'
                ? `${hours}h today — recorded as a half day.`
                : `${hours}h worked today. See you tomorrow, ${firstName}.`,
            result: mark,
          }
        } else {
          outcome = {
            key: now,
            ok: true,
            title: 'Already marked out',
            detail: `In ${formatClock(mark.checkIn)} · Out ${formatClock(mark.checkOut)} — the day is already complete.`,
            result: mark,
          }
        }
      }
    } catch {
      outcome = {
        key: now,
        ok: false,
        title: 'Could not reach the server',
        detail: 'Check the kiosk connection and scan again.',
      }
    }

    setOutcome(outcome)
    if (outcome.ok) {
      setHistory((prev) => [outcome, ...prev].slice(0, 12))
      speak(outcome)
      // Clear for the next person, but only if nothing newer arrived.
      window.setTimeout(() => {
        setOutcome((current) => (current?.key === outcome.key ? null : current))
      }, RESULT_HOLD_MS)
    }
  }

  useEffect(() => {
    handleRef.current = (token) => void handleToken(token)
  })

  async function startCamera() {
    setCameraError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser cannot open a camera. Use Chrome or Edge on the kiosk device.')
      return
    }
    try {
      // Higher ideal resolution: QR modules are small, and every pixel the
      // sensor gives the decoder is accuracy the crop ladder can spend.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      streamRef.current = stream

      const track = stream.getVideoTracks()[0] ?? null
      trackRef.current = track
      // Torch support is a capability of the specific camera, not the browser:
      // probe it rather than assuming, and hide the toggle where absent.
      const capabilities = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined
      setTorchAvailable(Boolean(capabilities?.torch))

      setCameraOn(true)
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      ) {
        setCameraError(
          'Camera access was blocked. Allow camera access for this site, then press Start again.'
        )
      } else {
        setCameraError('No camera could be opened on this device.')
      }
    }
  }

  useEffect(() => {
    if (!cameraOn) return
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return

    let cancelled = false
    let lastDecodeAt = 0
    // The candidate read: the first agreeing decode, waiting for a second
    // frame to confirm it. Cleared on a different decode, on timeout, or on
    // confirmation — never allowed to age into an unconfirmed act.
    let pendingToken: string | null = null
    let pendingAt = 0
    video.srcObject = stream
    void video.play().catch(() => {})

    function tick() {
      if (cancelled || !video) return
      if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        performance.now() - lastDecodeAt > 130
      ) {
        lastDecodeAt = performance.now()
        try {
          const token = decodeQrToken(video, video.videoWidth, video.videoHeight)
          if (token) {
            if (token === pendingToken) {
              // Second consecutive identical decode — a real card, held
              // steady. The kiosk acts on the read.
              cancelled = true
              setConfirming(false)
              handleRef.current(token)
              return
            }
            // First decode (or a different one than the pending candidate).
            pendingToken = token
            pendingAt = performance.now()
            setConfirming(true)
          } else if (pendingToken && performance.now() - pendingAt > PENDING_WINDOW_MS) {
            // The confirming frame never came — the card moved or the glare
            // shifted. Discard the candidate and keep scanning.
            pendingToken = null
            setConfirming(false)
          }
        } catch {
          // A torn frame mid-teardown; keep scanning.
        }
      }
      rafRef.current = requestAnimationFrame(() => tick())
    }
    tick()

    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [cameraOn])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.2fr_1fr]">
        {/* Scanner */}
        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-black/90">
          {cameraOn ? (
            <div className="relative">
              <video ref={videoRef} muted playsInline className="h-[420px] w-full object-cover" />
              <div
                className={`pointer-events-none absolute inset-8 rounded-2xl border-4 transition-colors ${
                  confirming ? 'border-status-info/90' : 'border-brand-gold/80'
                }`}
              />
              {confirming && (
                <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
                  <span className="rounded-full bg-black/70 px-4 py-1.5 text-xs font-semibold text-white">
                    Hold steady — confirming…
                  </span>
                </div>
              )}
              <div className="absolute right-3 top-3 flex gap-2">
                {torchAvailable && (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                      torchOn ? 'bg-brand-gold text-white' : 'bg-black/60 text-white'
                    }`}
                  >
                    {torchOn ? <FlashlightOff className="h-3.5 w-3.5" /> : <Flashlight className="h-3.5 w-3.5" />}
                    {torchOn ? 'Torch off' : 'Torch'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white"
                >
                  <CameraOff className="h-3.5 w-3.5" /> Stop camera
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-[420px] flex-col items-center justify-center gap-4 bg-surface-card px-8 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-gold/10 text-brand-gold">
                <Camera className="h-8 w-8" />
              </span>
              <p className="text-base font-semibold text-brand-slate">Scan your attendance card</p>
              <p className="max-w-sm text-xs leading-relaxed text-text-muted">
                Press start and hold the QR on your ID card in front of the camera. The kiosk
                marks you in — and when your shift ends, the next scan marks you out.
              </p>
              <button
                type="button"
                onClick={startCamera}
                className="rounded-xl bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange"
              >
                Start camera
              </button>
            </div>
          )}
        </div>

        {/* Result panel — photo, name, and what the scan did */}
        <div className="flex min-h-[420px] flex-col rounded-2xl border border-border-subtle bg-surface-card">
          {outcome && outcome.result?.identity ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              {outcome.result.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL for the kiosk screen; next/image would optimise a URL that expires in minutes.
                <img
                  src={outcome.result.photoUrl}
                  alt=""
                  className="h-32 w-32 rounded-2xl border border-border-subtle object-cover"
                />
              ) : (
                <span className="flex h-32 w-32 items-center justify-center rounded-2xl bg-brand-gold/10 text-3xl font-bold text-brand-gold">
                  {outcome.result.identity.fullName
                    .split(/\s+/)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || '?'}
                </span>
              )}
              <p className="text-xl font-bold text-brand-slate">{outcome.result.identity.fullName}</p>
              {outcome.result.identity.departmentName && (
                <p className="text-xs text-text-muted">{outcome.result.identity.departmentName}</p>
              )}
              <div
                className={`mt-1 flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${
                  outcome.result.action === 'in'
                    ? 'bg-status-success/10 text-status-success'
                    : outcome.result.action === 'out'
                      ? 'bg-status-info/10 text-status-info'
                      : 'bg-surface-bg text-text-muted'
                }`}
              >
                {outcome.result.action === 'in' ? (
                  <LogIn className="h-4 w-4" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                {outcome.title}
              </div>
              <p className="text-xs text-text-muted">{outcome.detail}</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-text-muted/70">
                <Volume2 className="h-3 w-3" /> Announced aloud
              </p>
            </div>
          ) : outcome ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-lg font-semibold text-status-danger">{outcome.title}</p>
              <p className="text-xs text-text-muted">{outcome.detail}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <ScanFacePlaceholder />
            </div>
          )}
        </div>
      </div>

      {/* Session log */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-border-subtle bg-surface-card">
          <p className="border-b border-border-subtle px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
            This session
          </p>
          <ul className="divide-y divide-border-subtle">
            {history.map((entry) => (
              <li key={entry.key} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="text-sm font-medium text-brand-slate">
                  {entry.result?.identity.fullName ?? entry.title}
                </span>
                <span className="text-xs text-text-muted">{entry.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cameraError && (
        <p className="rounded-2xl border border-status-danger/15 bg-status-danger/5 px-4 py-3 text-xs font-medium text-status-danger">
          {cameraError}
        </p>
      )}
    </div>
  )
}

/** Idle state of the result panel. */
function ScanFacePlaceholder() {
  return (
    <>
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-bg text-text-muted/40">
        <ScanFace />
      </span>
      <p className="text-sm font-semibold text-brand-slate">Waiting for a scan</p>
      <p className="max-w-xs text-xs text-text-muted">
        Your photo and name appear here, and the kiosk says your name when it marks you.
      </p>
    </>
  )
}