import { VOICE_NOTE_LIMITS, VOICE_NOTE_MIME } from '../../../types/voice-note.ts'

export type VoiceDraft = { blob: Blob; url: string; durationMs: number }
export type VoiceRecorderState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'recording'; elapsedMs: number }
  | { kind: 'review'; draft: VoiceDraft }
  | { kind: 'failed'; reason: string }

export function canRecordVoice(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && MediaRecorder.isTypeSupported(VOICE_NOTE_MIME['webm-opus'])
}

/** One recorder owns its microphone and object URL. Dispose when the chat or account changes. */
export function createVoiceRecorder(changed: (state: VoiceRecorderState) => void) {
  let state: VoiceRecorderState = { kind: 'idle' }, generation = 0, disposed = false
  let recorder: MediaRecorder | null = null, stream: MediaStream | null = null
  let timer: ReturnType<typeof setInterval> | null = null, url: string | null = null
  const set = (next: VoiceRecorderState): void => { state = next; if (!disposed) changed(next) }
  const hidden = (): void => { if (document.hidden) stop() }
  function release(): void {
    document.removeEventListener('visibilitychange', hidden)
    if (timer !== null) clearInterval(timer)
    timer = null
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = null
  }
  function clear(): void {
    generation++
    const old = recorder; recorder = null
    if (old && old.state !== 'inactive') old.stop()
    release()
    if (url) URL.revokeObjectURL(url)
    url = null
  }
  function cancel(): void { clear(); set({ kind: 'idle' }) }
  function stop(): void {
    if (state.kind !== 'recording' || !recorder || recorder.state === 'inactive') return
    recorder.stop(); release()
  }
  async function start(): Promise<void> {
    if (disposed || state.kind === 'recording' || state.kind === 'requesting') return
    clear()
    if (!canRecordVoice()) { set({ kind: 'failed', reason: 'Voice recording needs a browser that supports Opus audio. You can still send a text message.' }); return }
    const current = generation
    set({ kind: 'requesting' })
    document.addEventListener('visibilitychange', hidden)
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
      if (disposed || current !== generation || document.hidden) { for (const track of acquired.getTracks()) track.stop(); if (!disposed && current === generation) { release(); set({ kind: 'idle' }) }; return }
      stream = acquired
      const capture = new MediaRecorder(acquired, { mimeType: VOICE_NOTE_MIME['webm-opus'], audioBitsPerSecond: VOICE_NOTE_LIMITS.audioBitsPerSecond })
      recorder = capture
      const chunks: Blob[] = []
      let total = 0, tooLarge = false, failed = false
      const started = performance.now()
      capture.ondataavailable = event => {
        if (current !== generation || disposed) return
        total += event.data.size
        if (total > VOICE_NOTE_LIMITS.bytes) { tooLarge = true; chunks.length = 0; stop() }
        else if (!tooLarge && event.data.size) chunks.push(event.data)
      }
      capture.onerror = () => {
        if (current !== generation || disposed) return
        failed = true; release(); set({ kind: 'failed', reason: 'Recording stopped unexpectedly. Please record again.' })
      }
      capture.onstop = () => {
        if (current !== generation || disposed) return
        release(); recorder = null
        if (failed) return
        if (tooLarge) { set({ kind: 'failed', reason: 'That recording is too large. Try a shorter voice note.' }); return }
        const durationMs = Math.min(VOICE_NOTE_LIMITS.durationMs, Math.round(performance.now() - started))
        if (durationMs < 300 || !total) { set({ kind: 'failed', reason: 'Hold the recording for a little longer, then stop.' }); return }
        const blob = new Blob(chunks, { type: VOICE_NOTE_MIME['webm-opus'] })
        url = URL.createObjectURL(blob)
        set({ kind: 'review', draft: { blob, url, durationMs } })
      }
      capture.start(250)
      set({ kind: 'recording', elapsedMs: 0 })
      timer = setInterval(() => {
        if (current !== generation || disposed) return
        const elapsedMs = performance.now() - started
        set({ kind: 'recording', elapsedMs: Math.min(elapsedMs, VOICE_NOTE_LIMITS.durationMs) })
        // Leave room for the encoder's final Opus packet.
        if (elapsedMs >= VOICE_NOTE_LIMITS.durationMs - 250) stop()
      }, 100)
    } catch (error) {
      if (current !== generation || disposed) return
      release(); recorder = null
      set({ kind: 'failed', reason: error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access was not allowed. You can enable it in your browser’s site settings or send text.' : 'The microphone could not start. Check that it is connected and try again.' })
    }
  }
  return { start, stop, cancel, dispose(): void { disposed = true; clear() } }
}
