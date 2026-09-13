'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, CameraOff, LogIn, LogOut, ScanFace, Volume2 } from 'lucide-react'
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
 * SCANNING IS jsQR, as in the password-reset wizard: camera frames → canvas →
 * decode, throttled. The token is 256 bits of opaque text, so a misread frame
 * is rejected by the server as an unrecognised card rather than misattributing
 * attendance to a colleague.
 *
 * COOLDOWN. The same token scanned again within fifteen seconds is ignored —
 * a person often scans twice before realising the screen already answered,
 * and the second scan must not flip their fresh check-in into a check-out.
 * Fifteen seconds later the scan works again, which is how a second scan is
 * SUPPOSED to behave (leaving for lunch, coming back).
 */

/** Same-token cooldown: a double-scan must not become a check-out. */
const COOLDOWN_MS = 15_000
/** How long a result holds on screen before the kiosk clears for the next person. */
const RESULT_HOLD_MS = 9_000
/** Longest edge of the decode canvas. */
const MAX_DECODE_EDGE = 960

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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
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
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
      })
      streamRef.current = stream
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
    video.srcObject = stream
    void video.play().catch(() => {})

    function tick() {
      if (cancelled || !video) return
      if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        performance.now() - lastDecodeAt > 150
      ) {
        lastDecodeAt = performance.now()
        try {
          const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(video.videoWidth, video.videoHeight))
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(video.videoWidth * scale)
          canvas.height = Math.round(video.videoHeight * scale)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(pixels.data, pixels.width, pixels.height)
            if (code?.data) {
              cancelled = true
              handleRef.current(code.data)
              return
            }
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
              <div className="pointer-events-none absolute inset-8 rounded-2xl border-4 border-brand-gold/80" />
              <button
                type="button"
                onClick={stopCamera}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white"
              >
                <CameraOff className="h-3.5 w-3.5" /> Stop camera
              </button>
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