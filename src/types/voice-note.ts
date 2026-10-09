/** Shared limits for recorded chat audio; recordings stay outside message history payloads. */
export const VOICE_NOTE_LIMITS = Object.freeze({ durationMs: 60_000, bytes: 512_000, audioBitsPerSecond: 32_000, idPattern: /^[0-9a-f]{32}$/ })
export type VoiceNoteFormat = 'webm-opus'
export const VOICE_NOTE_MIME: Record<VoiceNoteFormat, string> = { 'webm-opus': 'audio/webm;codecs=opus' }
export interface VoiceNoteView {
  id: string
  durationMs: number
  state?: 'expired' | 'hidden' | 'reported' | 'off'
}
