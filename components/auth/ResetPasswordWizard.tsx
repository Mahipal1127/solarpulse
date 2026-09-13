'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import Link from 'next/link'
import { ArrowLeft, Camera, CheckCircle2, Eye, EyeOff, FileUp, KeyRound } from 'lucide-react'

type Step = 'id' | 'scan' | 'password' | 'done'

interface ResetIdentity {
  fullName: string
  departmentName: string | null
  designation: string | null
  employeeCode: string
}

const STEP_LABELS: Record<'id' | 'scan' | 'password', string> = {
  id: 'Employee ID',
  scan: 'Scan QR',
  password: 'New password',
}

// ---------------------------------------------------------------------------
// QR decoding — jsQR, on every browser
//
// The camera loop and the photo upload both decode through jsQR: draw the frame
// (video frame or uploaded image) onto a canvas, read the pixels back, and hand
// them to the decoder. jsQR is pure JavaScript with no platform dependencies,
// so scanning works identically on Chrome, Firefox and iOS Safari — the
// browser's own BarcodeDetector API cannot be relied on (missing in Firefox and
// iOS Safari), which is why this moved off it.
// ---------------------------------------------------------------------------

/** Longest edge of the decode canvas. Photos come in at 4000px+; the downscale
 *  is what keeps decode times acceptable on a phone. */
const MAX_DECODE_EDGE = 960

function readPixels(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number
): ImageData {
  const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(sourceWidth, sourceHeight))
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context is unavailable in this browser.')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Decodes a QR from any drawable source; null when no code is in the frame. */
function decodeQr(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): string | null {
  const canvas = document.createElement('canvas')
  const pixels = readPixels(canvas, source, sourceWidth, sourceHeight)
  const code = jsQR(pixels.data, pixels.width, pixels.height)
  return code?.data ?? null
}

/**
 * The self-service password reset wizard.
 *
 * THREE STEPS, mirroring the API: the Employee ID printed on the card ("ID No"), then the
 * attendance QR — the same credential the kiosk trusts — and finally the new password.
 * Verification happens server-side on BOTH calls; this component only choreographs.
 *
 * SCANNING WITH jsQR. The camera loop and the photo upload decode through jsQR
 * (canvas pixels in, token string out), so both work on every browser — this
 * used to lean on the browser's BarcodeDetector API, which is missing in
 * Firefox and iOS Safari and silently left both buttons dead. The QR encodes
 * the raw token (lib/services/qr.ts), so a decoded value is submitted as-is.
 * The camera itself still needs the browser's permission and a secure context
 * (https, or localhost) — both failures speak plainly and the paste-code
 * fallback is always there.
 */
export function ResetPasswordWizard() {
  const [step, setStep] = useState<Step>('id')
  const [employeeCode, setEmployeeCode] = useState('')
  const [identity, setIdentity] = useState<ResetIdentity | null>(null)
  const [verifiedToken, setVerifiedToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Scan-step state.
  const [cameraOn, setCameraOn] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  // Latest-ref bridge: the camera loop below must call the CURRENT verifyToken (which closes
  // over employeeCode) without tearing the video effect down on every keystroke.
  const detectedRef = useRef<(raw: string) => void>(() => {})

  // Password-step state
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)

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

  // The camera is stopped at every exit from the scan step — "Change Employee ID", a successful
  // verification (inside verifyToken) and startOver each call stopCamera() explicitly, and the
  // unmount cleanup below kills the tracks regardless. A silently running camera light on a
  // password page is its own kind of incident, so every path out is covered by hand rather than
  // by an effect watching `step` (setState inside an effect body is a lint error here).
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  async function verifyToken(rawToken: string) {
    const token = rawToken.trim()
    if (!token || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/password-reset/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_code: employeeCode.trim(), token }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        verified?: boolean
        identity?: ResetIdentity
        error?: string
      }
      if (!res.ok || !body.verified || !body.identity) {
        setError(body.error ?? 'We could not verify that card. Check the Employee ID and try again.')
        return
      }
      // Success leaves the scan step — kill the camera before moving on (the camera-loop path
      // already stopped it; the call is idempotent).
      stopCamera()
      setIdentity(body.identity)
      setVerifiedToken(token)
      setStep('password')
    } catch {
      setError('Something went wrong reaching the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    detectedRef.current = (raw) => {
      stopCamera()
      void verifyToken(raw)
    }
  })

  async function startCamera() {
    setError(null)
    // getUserMedia exists only in secure contexts (https, or localhost). A user
    // opening the reset page from a phone over the LAN as http://192.168.x.x
    // would otherwise hit a bare "could not open" with no hint at the cause.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'The camera needs a secure connection (https, or localhost). Upload a photo of the QR or paste the code instead.'
      )
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setCameraOn(true)
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setError(
          'Camera access was blocked. Allow camera access for this site, then try again — or upload a photo of the QR or paste the code.'
        )
      } else {
        setError('Could not open the camera. Upload a photo of the QR or paste the code instead.')
      }
    }
  }

  // Camera loop: attach the stream, then decode frames through jsQR until a QR
  // appears. Frames are drawn to an offscreen canvas and throttled to roughly
  // eight decodes a second — a phone decodes comfortably at that rate without
  // cooking its battery, and the await-before-scheduling pattern means a slow
  // device scans slower rather than piling frames up.
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
      const ready = video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
      if (ready && performance.now() - lastDecodeAt > 120) {
        lastDecodeAt = performance.now()
        try {
          const raw = decodeQr(video, video.videoWidth, video.videoHeight)
          if (raw) {
            cancelled = true
            detectedRef.current(raw)
            return
          }
        } catch {
          // A torn frame mid-teardown or a failed pixel read; both are normal.
          // Keep scanning.
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

  async function handleUpload(file: File) {
    setBusy(true)
    setError(null)
    try {
      // An object URL + <img> decodes in every browser, including iOS Safari,
      // where createImageBitmap on a File is not available.
      const url = URL.createObjectURL(file)
      const image = new Image()
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Could not load that image'))
      })
      image.src = url
      await loaded

      const raw = decodeQr(image, image.naturalWidth, image.naturalHeight)
      URL.revokeObjectURL(url)

      if (!raw) {
        setError('No QR code found in that photo. Use the card image HR shared, or paste the code.')
        return
      }
      await verifyToken(raw)
    } catch {
      setError('Could not read that photo. Try the camera or paste the code instead.')
    } finally {
      setBusy(false)
    }
  }

  async function submitNewPassword() {
    if (!identity || !verifiedToken || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_code: employeeCode.trim(),
          token: verifiedToken,
          password,
          confirm,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Could not set the new password. Try again.')
        return
      }
      setStep('done')
    } catch {
      setError('Something went wrong reaching the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    stopCamera()
    setStep('id')
    setIdentity(null)
    setVerifiedToken('')
    setManualToken('')
    setPassword('')
    setConfirm('')
    setError(null)
  }

  return (
    <div className="space-y-4">
      {/* Step tracker — the current step darkens, the rest stay muted. */}
      <ol className="flex items-center justify-center gap-3 text-[11px] font-medium">
        {(['id', 'scan', 'password'] as const).map((s, i) => (
          <li key={s} className={step === s ? 'text-brand-slate' : 'text-text-muted/50'}>
            {i + 1} · {STEP_LABELS[s]}
          </li>
        ))}
      </ol>

      {error && (
        <p className="rounded-2xl border border-status-danger/15 bg-status-danger/5 px-4 py-2.5 text-xs font-medium text-status-danger">
          {error}
        </p>
      )}

      {step === 'id' && (
        <>
          <div>
            <div className="relative flex items-center rounded-2xl bg-surface-bg px-4 py-3.5 ring-1 ring-border-subtle transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-slate focus-within:shadow-sm">
              <KeyRound className="mr-3 h-4 w-4 shrink-0 text-text-muted/60" />
              <input
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                placeholder="Employee ID (e.g. SP-014)"
                autoComplete="off"
                className="w-full bg-transparent text-sm text-brand-slate outline-none placeholder:text-text-muted/60"
              />
            </div>
            <p className="mt-1.5 px-3 text-[11px] text-text-muted">The ID No printed on your ID card.</p>
          </div>

          <button
            type="button"
            disabled={employeeCode.trim().length < 2 || busy}
            onClick={() => {
              setError(null)
              setStep('scan')
            }}
            className="w-full rounded-2xl bg-brand-gold px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-brand-orange active:scale-[0.99] disabled:opacity-60"
          >
            Continue
          </button>
        </>
      )}

      {step === 'scan' && (
        <>
          <div className="rounded-2xl bg-surface-bg px-4 py-3.5 text-xs leading-relaxed text-text-muted ring-1 ring-border-subtle">
            Scan the QR on your attendance ID card to prove it is in your hands. The card stays
            valid — this only verifies who you are.
          </div>

          {cameraOn && (
            <div className="relative overflow-hidden rounded-2xl ring-1 ring-border-subtle">
              <video ref={videoRef} muted playsInline className="h-56 w-full bg-black object-cover" />
              <div className="pointer-events-none absolute inset-x-10 top-1/2 h-32 -translate-y-1/2 rounded-xl border-2 border-brand-gold/80" />
              <button
                type="button"
                onClick={stopCamera}
                className="absolute right-2 top-2 rounded-lg bg-black/50 px-2 py-1 text-xs font-medium text-white"
              >
                Stop
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={startCamera}
              disabled={busy || cameraOn}
              className="flex items-center justify-center gap-2 rounded-xl border border-border-subtle px-3 py-2.5 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold disabled:opacity-40"
            >
              <Camera className="h-4 w-4" /> Scan with camera
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl border border-border-subtle px-3 py-2.5 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold disabled:opacity-40"
            >
              <FileUp className="h-4 w-4" /> Upload QR photo
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleUpload(file)
              e.target.value = ''
            }}
          />

          <p className="px-1 text-[11px] leading-relaxed text-text-muted">
            Hold the card steady, fill the frame, and avoid glare. Prefer to type it? The card
            code below also works.
          </p>

          <div>
            <div className="flex items-center rounded-2xl bg-surface-bg px-4 py-3 ring-1 ring-border-subtle transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-slate">
              <input
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Or paste the card code"
                autoComplete="off"
                className="w-full bg-transparent text-xs text-brand-slate outline-none placeholder:text-text-muted/60"
              />
            </div>
            <button
              type="button"
              disabled={manualToken.trim().length < 16 || busy}
              onClick={() => verifyToken(manualToken)}
              className="mt-2 w-full rounded-xl border border-border-subtle px-4 py-2.5 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold disabled:opacity-40"
            >
              {busy ? 'Verifying…' : 'Verify card'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              stopCamera()
              setError(null)
              setStep('id')
            }}
            className="flex items-center gap-1 text-xs font-medium text-text-muted transition hover:text-brand-slate"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Change Employee ID
          </button>
        </>
      )}

      {step === 'password' && identity && (
        <>
          <div className="rounded-2xl bg-status-success/5 px-4 py-3 text-xs ring-1 ring-status-success/20">
            <p className="font-medium text-brand-slate">Verified: {identity.fullName}</p>
            <p className="mt-0.5 text-text-muted">
              {[identity.designation, identity.departmentName].filter(Boolean).join(' · ') ||
                identity.employeeCode}
            </p>
          </div>

          <div>
            <div className="relative flex items-center rounded-2xl bg-surface-bg px-4 py-3.5 ring-1 ring-border-subtle transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-slate focus-within:shadow-sm">
              <KeyRound className="mr-3 h-4 w-4 shrink-0 text-text-muted/60" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                autoComplete="new-password"
                className="w-full bg-transparent text-sm text-brand-slate outline-none placeholder:text-text-muted/60"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="shrink-0 text-text-muted/60 transition hover:text-text-muted"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password.length > 0 && password.length < 8 && (
              <p className="mt-1.5 px-3 text-xs font-medium text-status-danger">
                Password must be at least 8 characters
              </p>
            )}
          </div>

          <div>
            <div className="relative flex items-center rounded-2xl bg-surface-bg px-4 py-3.5 ring-1 ring-border-subtle transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-slate focus-within:shadow-sm">
              <KeyRound className="mr-3 h-4 w-4 shrink-0 text-text-muted/60" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                className="w-full bg-transparent text-sm text-brand-slate outline-none placeholder:text-text-muted/60"
              />
            </div>
            {confirm.length > 0 && confirm !== password && (
              <p className="mt-1.5 px-3 text-xs font-medium text-status-danger">
                Passwords do not match
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={busy || password.length < 8 || password !== confirm}
            onClick={submitNewPassword}
            className="w-full rounded-2xl bg-brand-gold px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-brand-orange active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Set new password'}
          </button>

          <button
            type="button"
            onClick={startOver}
            className="flex items-center gap-1 text-xs font-medium text-text-muted transition hover:text-brand-slate"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Not you? Start over
          </button>
        </>
      )}

      {step === 'done' && (
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-status-success" />
          <p className="text-sm font-medium text-brand-slate">Password updated</p>
          <p className="text-xs text-text-muted">You can sign in with your new password now.</p>
          <Link
            href="/login"
            className="block w-full rounded-2xl bg-brand-gold px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-brand-orange"
          >
            Back to sign in
          </Link>
        </div>
      )}
    </div>
  )
}