/**
 * Web Speech API declarations.
 *
 * WHY THIS FILE HAS TO EXIST
 * `SpeechRecognition` is not in TypeScript's `lib.dom.d.ts`. The API has never been
 * on a standards track that TypeScript ships types for — it is a WICG spec that
 * browsers implemented behind a `webkit` prefix and largely left there. So without
 * this file, `new webkitSpeechRecognition()` is a compile error and the only
 * alternatives are `as any` (which turns every property access into an unchecked
 * guess) or `@ts-expect-error` (which suppresses real mistakes alongside the
 * expected one).
 *
 * No imports or exports on purpose: a .d.ts with neither is a *script*, not a
 * module, so these declarations are global and `interface Window` merges with the
 * built-in one. Adding an `import` at the top would make it a module and silently
 * stop the Window augmentation from applying.
 *
 * Only the surface DictationButton.tsx actually uses is declared. A fuller
 * definition would be inventing detail for an API this app touches in one place.
 */

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResult {
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  /**
   * False while the engine is still revising its guess. Interim results arrive
   * repeatedly for the same span of speech and must not be appended blindly, or
   * every correction lands in the box alongside the text it was correcting.
   */
  readonly isFinal: boolean
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  /**
   * Where the new results start in `results`. The list is cumulative for the whole
   * session, so re-reading it from 0 on every event re-processes everything said so
   * far — this index is what makes incremental handling correct.
   */
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

/**
 * `error` is a string code, not an Error. The ones that matter in practice:
 * 'not-allowed' (permission refused or blocked by policy), 'no-speech' (silence),
 * 'audio-capture' (no usable microphone), 'network' (the recogniser is remote —
 * see the note in DictationButton.tsx), 'aborted' (stop() was called).
 */
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}

interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  /** Finishes the session and delivers any pending result. */
  stop(): void
  /** Drops the session and discards pending results. */
  abort(): void
  onstart: ((this: SpeechRecognition, event: Event) => void) | null
  onend: ((this: SpeechRecognition, event: Event) => void) | null
  onerror: ((this: SpeechRecognition, event: SpeechRecognitionErrorEvent) => void) | null
  onresult: ((this: SpeechRecognition, event: SpeechRecognitionEvent) => void) | null
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}

interface Window {
  /** Unprefixed. Present in newer Chromium; absent in Safari. */
  SpeechRecognition?: SpeechRecognitionConstructor
  /** The prefixed original, still the only spelling in Safari and older Chrome. */
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}
