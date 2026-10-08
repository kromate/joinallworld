/** Scene-only media capture. This module never requests a camera, microphone, or network upload. */
export type CaptureFailureCode = 'unsupported' | 'canvas_not_ready' | 'canvas_security' | 'empty_photo' | 'context_lost' | 'recorder_failed' | 'empty_video' | 'visit_ending'

export class CaptureFailure extends Error {
  readonly code: CaptureFailureCode
  constructor(code: CaptureFailureCode) {
    super(code)
    this.code = code
    this.name = 'CaptureFailure'
  }
}

function contextLost(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  return context?.isContextLost() === true
}

function checkCanvas(canvas: HTMLCanvasElement): void {
  if (!canvas.width || !canvas.height) throw new CaptureFailure('canvas_not_ready')
  if (contextLost(canvas)) throw new CaptureFailure('context_lost')
}

function securityError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'SecurityError'
}

/** Call immediately after the scene host has drawn; its renderer does not preserve old buffers. */
export function capturePng(canvas: HTMLCanvasElement): Promise<Blob> {
  checkCanvas(canvas)
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob?.size) { reject(new CaptureFailure('empty_photo')); return }
        resolve(blob)
      }, 'image/png')
    } catch (error) {
      reject(new CaptureFailure(securityError(error) ? 'canvas_security' : 'canvas_not_ready'))
    }
  })
}

export interface CanvasRecording {
  /** Stops and keeps a completed WebM when it contains frames. */
  stop(): void
  /** Stops and discards output. Use when consent, the scene or the connection is lost. */
  cancel(): void
}

export interface CanvasRecordingCallbacks {
  complete(blob: Blob): void
  fail(code: CaptureFailureCode): void
  limitReached(): void
}

function webmOptions(): MediaRecorderOptions {
  const choices = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  const mimeType = choices.find((type) => MediaRecorder.isTypeSupported(type))
  return mimeType ? { mimeType } : {}
}

/** Starts a user-initiated, canvas video capture with a hard 30 second cap. */
export function recordCanvas(canvas: HTMLCanvasElement, callbacks: CanvasRecordingCallbacks, maxDurationMs = 30_000): CanvasRecording {
  checkCanvas(canvas)
  if (!Number.isFinite(maxDurationMs) || maxDurationMs < 1000) throw new CaptureFailure('visit_ending')
  const duration = Math.min(30_000, Math.floor(maxDurationMs))
  if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') throw new CaptureFailure('unsupported')

  let stream: MediaStream | null = null
  let recorder: MediaRecorder
  try {
    stream = canvas.captureStream(20)
    // Canvas streams are video-only; remove any unexpected track before recording.
    for (const track of stream.getAudioTracks()) { stream.removeTrack(track); track.stop() }
    if (!stream.getVideoTracks().length) throw new CaptureFailure('unsupported')
    recorder = new MediaRecorder(stream, webmOptions())
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop())
    if (error instanceof CaptureFailure) throw error
    throw new CaptureFailure(securityError(error) ? 'canvas_security' : 'unsupported')
  }

  const chunks: Blob[] = []
  let discard = false, finished = false, reported = false
  let limit: ReturnType<typeof setTimeout> | undefined
  const stopTracks = (): void => { stream?.getTracks().forEach((track) => track.stop()) }
  const cleanup = (): void => {
    if (limit !== undefined) clearTimeout(limit)
    canvas.removeEventListener('webglcontextlost', onContextLost)
    stopTracks()
  }
  const finish = (): void => {
    if (finished) return
    finished = true
    cleanup()
    if (discard) return
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
    if (!blob.size) callbacks.fail('empty_video')
    else callbacks.complete(blob)
  }
  const stopRecorder = (): void => {
    if (limit !== undefined) clearTimeout(limit)
    if (recorder.state === 'inactive') finish()
    else { try { recorder.stop() } catch { finish() } }
  }
  const fail = (code: CaptureFailureCode): void => {
    if (!reported && !finished) { reported = true; discard = true; callbacks.fail(code) }
    stopRecorder()
  }
  function onContextLost(): void { fail('context_lost') }

  recorder.addEventListener('dataavailable', (event: BlobEvent) => { if (event.data.size) chunks.push(event.data) })
  recorder.addEventListener('stop', finish, { once: true })
  recorder.addEventListener('error', () => fail('recorder_failed'), { once: true })
  canvas.addEventListener('webglcontextlost', onContextLost, { once: true })
  try {
    recorder.start(1000)
    limit = setTimeout(() => { callbacks.limitReached(); stopRecorder() }, duration)
  } catch {
    discard = true
    cleanup()
    throw new CaptureFailure('recorder_failed')
  }

  return {
    stop: stopRecorder,
    cancel() { discard = true; stopRecorder() },
  }
}

export function captureFailureText(code: CaptureFailureCode): string {
  switch (code) {
    case 'unsupported': return 'This browser cannot record the scene here.'
    case 'canvas_not_ready': return 'The scene is still loading. Try again in a moment.'
    case 'canvas_security': return 'The scene cannot be exported by this browser.'
    case 'empty_photo': return 'No image was captured. Try again.'
    case 'context_lost': return 'The scene renderer stopped. Return to the scene and try again.'
    case 'recorder_failed': return 'Video recording stopped unexpectedly. Try again.'
    case 'empty_video': return 'No video frames were captured. Try again.'
    case 'visit_ending': return 'This visit is ending too soon to record a video.'
  }
}
