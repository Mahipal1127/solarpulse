'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, MicOff } from 'lucide-react'

/**
 * Speak instead of type.
 *
 * ── WHERE THE AUDIO GOES, WHICH IS NOT OBVIOUS ─────────────────────────────
 * This is the browser's Web Speech API, and in Chrome it is NOT on-device: the
 * audio is streamed to Google's speech service and the transcript comes back. That
 * is why 'network' is one of its error codes. Safari behaves similarly with Apple's
 * service.
 *
 * For this app that is a real disclosure rather than a footnote. A CEO dictating
 * here will say customer names, deal values and staff names out loud, and those
 * words leave the machine to a third party that is not the AI provider configured
 * in AI Settings and not covered by anything the operator chose there. So the
 * caption pill says it plainly while the microphone is live — that is the moment it
 * is relevant, and a permanent line under the composer would be read once and then
 * never again. Nothing is done to prevent it, because dictation cannot work without
 * it, but the person holding the microphone gets to know.
 *
 * ── THE THREE BUGS THIS API INVITES ────────────────────────────────────────
 * 1. `results` is CUMULATIVE for the whole session, and interim results are
 *    repeatedly revised. Reading the list from index 0 on every event, or appending
 *    interim text as it arrives, produces "show me the show me the overdue overdue
 *    tasks". Only `isFinal` results are committed here, from `resultIndex` forward;
 *    interim text is held separately for display and thrown away when it is
 *    superseded.
 *
 * 2. STALE CLOSURES. A SpeechRecognition object is created once and keeps its
 *    handlers, so a handler assigned during the first render captures that render's
 *    props forever — the transcript would be handed to a callback that closed over
 *    an old textarea state. Every handler below reads its callback out of a ref that
 *    an effect keeps current.
 *
 * 3. A MICROPHONE LEFT OPEN. Without an unmount teardown the session survives the
 *    component, and the browser's tab recording indicator stays lit after the user
 *    has navigated away — which looks exactly like an app secretly listening.
 *    abort() rather than stop() on unmount, because stop() delivers a final result
 *    to a component that no longer exists.
 */

/** Chrome ends a session on silence even with continuous = true. */
const MAX_EMPTY_RESTARTS = 3

/**
 * A hard cap on one dictation session. A mic that stays live because someone walked
 * away is worse than a truncated sentence.
 */
const MAX_SESSION_MS = 120_000

interface Props {
  /** Called with each committed (final) chunk of speech, ready to append. */
  onTranscript: (text: string) => void
  disabled?: boolean
}

/**
 * Whether the browser has the API, read the way React wants an external value read.
 *
 * The obvious version — `useState(false)` plus an effect that calls setState — is a
 * lint error here, and the rule is right: it renders once with a wrong value and
 * then immediately re-renders, which is a cascading render to discover a constant.
 * Reading `window` during render instead is worse, because it does not exist on the
 * server and the client's first paint would disagree with the server's HTML.
 *
 * useSyncExternalStore is the sanctioned answer. `getServerSnapshot` supplies
 * `false` for SSR and hydration, so both passes agree; `getSnapshot` supplies the
 * truth immediately after. `subscribe` returns a no-op teardown because support
 * cannot change during a session — there is genuinely nothing to subscribe to.
 * Module-level constants, not inline closures, or a new function identity on every
 * render would make React resubscribe each time.
 */
const subscribeToNothing = () => () => {}
const readSpeechSupport = () =>
  Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
const noSupportOnServer = () => false

export function DictationButton({ onTranscript, disabled = false }: Props) {
  const supported = useSyncExternalStore(
    subscribeToNothing,
    readSpeechSupport,
    noSupportOnServer
  )
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  /** What the user wants, as opposed to whether a session happens to be running. */
  const wantListeningRef = useRef(false)
  const emptyRestartsRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /*
   * The live callback, so the handlers below never close over a stale prop. This is
   * trap 2 above; without it the transcript is appended to whatever the composer
   * contained on first render.
   */
  const onTranscriptRef = useRef(onTranscript)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const stop = useCallback(() => {
    wantListeningRef.current = false
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    // stop(), not abort(): the engine flushes whatever it has decided so far, so the
    // last few words are not lost on release.
    recognitionRef.current?.stop()
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Constructor) return

    setError(null)
    emptyRestartsRef.current = 0
    wantListeningRef.current = true

    const recognition = new Constructor()
    /*
     * en-IN rather than en-US. The words being dictated are Indian names, places and
     * lakh/crore figures, and the recogniser's language model is what decides
     * whether "Priya" comes back as a name or as noise.
     */
    recognition.lang = 'en-IN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let committed = ''
      let pending = ''

      // From resultIndex forward only — the list holds the whole session, and
      // re-reading it from 0 would re-commit every sentence already handled.
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) committed += text
        else pending += text
      }

      if (committed.trim()) {
        emptyRestartsRef.current = 0
        onTranscriptRef.current(committed.trim())
        // Cleared as soon as the words are committed, or the caption would keep
        // showing text that is already in the composer.
        setInterim('')
      } else {
        setInterim(pending)
      }
    }

    recognition.onerror = (event) => {
      /*
       * 'no-speech' and 'aborted' are not failures worth a message. The first is
       * silence, which the auto-restart below already handles; the second is this
       * component's own teardown. Surfacing either would put a red error under the
       * button for using it normally.
       */
      if (event.error === 'no-speech' || event.error === 'aborted') return

      wantListeningRef.current = false
      setListening(false)
      setInterim('')

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone access is blocked. Allow it in your browser’s site settings.')
      } else if (event.error === 'audio-capture') {
        setError('No microphone was found.')
      } else if (event.error === 'network') {
        setError('Speech recognition needs a network connection.')
      } else {
        setError('Dictation stopped unexpectedly.')
      }
    }

    recognition.onend = () => {
      /*
       * Chrome ends the session after a pause even with continuous = true, so a
       * restart is what makes "hold a thought mid-sentence" work. Capped on
       * *consecutive empty* sessions: an unrestricted restart on a dead microphone
       * is a loop that hammers the speech service forever.
       */
      if (wantListeningRef.current && emptyRestartsRef.current < MAX_EMPTY_RESTARTS) {
        emptyRestartsRef.current += 1
        try {
          recognition.start()
          return
        } catch {
          // Already starting — fall through and settle on stopped.
        }
      }
      wantListeningRef.current = false
      setListening(false)
      setInterim('')
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
      setListening(true)
      timeoutRef.current = setTimeout(stop, MAX_SESSION_MS)
    } catch {
      // start() throws if a session is already live; treat it as already listening.
      setError('Dictation could not start. Try again.')
      wantListeningRef.current = false
      setListening(false)
    }
  }, [stop])

  // Trap 3: never leave the microphone live past this component.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      // abort(), not stop(): no final result should be delivered into an unmounted tree.
      recognitionRef.current?.abort()
    }
  }, [])

  /*
   * A disabled composer must not keep listening — the assistant being turned off or
   * mid-request while the microphone stays open is the state that makes an app feel
   * like it is not paying attention to itself.
   */
  useEffect(() => {
    if (disabled && wantListeningRef.current) stop()
  }, [disabled, stop])

  /*
   * Renders nothing where the API does not exist, which today is mainly Firefox.
   * A visible-but-dead button invites a click that silently does nothing; the
   * textarea beside it is not degraded in any way by the absence.
   */
  if (!supported) return null

  return (
    <div className="relative flex items-center">
      {/* The live caption. Positioned absolutely so a long phrase cannot push the
          composer's layout around while someone is still speaking. */}
      {listening && (
        <div className="animate-mic-caption pointer-events-none absolute bottom-full right-0 mb-3 flex max-w-[min(28rem,70vw)] items-center gap-2 rounded-full border border-border-subtle bg-surface-card px-3 py-1.5 shadow-sm">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-mic-ring absolute inset-0 rounded-full bg-status-danger" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-status-danger" />
          </span>
          {/*
            Before any words arrive there is nothing to caption, so that space
            carries the disclosure instead of a bare "Listening…". Once speech is
            recognised the transcript takes over — by then the point has been made.
          */}
          <span className="truncate text-xs text-text-muted">
            {interim || 'Listening — your browser sends this audio to its speech service'}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={listening ? stop : start}
        disabled={disabled}
        aria-pressed={listening}
        aria-label={listening ? 'Stop dictation' : 'Dictate your message'}
        title={listening ? 'Stop dictation' : 'Dictate your message'}
        className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          listening
            ? 'animate-mic-breathe bg-status-danger text-white'
            : 'text-text-muted hover:bg-surface-bg hover:text-brand-slate'
        }`}
      >
        {/*
          The expanding ring, behind the icon and outside the button's own bounds.
          A separate element rather than a box-shadow so it can scale past the
          button without affecting layout. pointer-events-none so the growing ring
          never eats the click that stops it.
        */}
        {listening && (
          <span
            aria-hidden
            className="animate-mic-ring pointer-events-none absolute inset-0 rounded-full bg-status-danger"
          />
        )}
        {/* relative, so the icon sits above the ring rather than under it. */}
        <span className="relative flex items-center justify-center">
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </span>
      </button>

      {/*
        role="alert" so a screen reader is told the microphone was refused. Without
        it a blocked permission is a button that visibly does nothing.
      */}
      {error && (
        <p
          role="alert"
          className="absolute bottom-full right-0 mb-3 w-max max-w-[min(24rem,70vw)] rounded-lg border border-border-subtle bg-surface-card px-3 py-2 text-xs text-status-danger shadow-sm"
        >
          {error}
        </p>
      )}
    </div>
  )
}
