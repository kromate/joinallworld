/**
 * What the room voice (src/community.ts) and one-to-one calls (src/calls.ts) share: the connection
 * settings from /api/voice-config, and the plain-language reasons a microphone could not be opened.
 * Nothing here opens a microphone or a connection.
 */

/** The connection servers the host hands out. `expiresAt` is a browser-clock ms time, or null when they do not expire. */
export interface IceConfig { iceServers: RTCIceServer[]; expiresAt: number | null; turnConfigured?: boolean; mode?: string }

/** The shared failure text: the settings could not be read, or they were already expired when read. */
export const VOICE_CONFIG_UNAVAILABLE = 'Voice configuration unavailable'

/** Read /api/voice-config. Any failure, including credentials that are already expired, is the one error above. */
export async function fetchIceConfig(fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<IceConfig> {
  try {
    const response = await fetcher('/api/voice-config')
    if (!response.ok) throw new Error(VOICE_CONFIG_UNAVAILABLE)
    const config = await response.json() as { iceServers?: RTCIceServer[]; expiresAt?: number | string | null; turnConfigured?: boolean; mode?: string }
    if (!Array.isArray(config.iceServers) || !config.iceServers.length) throw new Error(VOICE_CONFIG_UNAVAILABLE)
    const expiresAt = config.expiresAt ? (typeof config.expiresAt === 'number' ? config.expiresAt : Date.parse(config.expiresAt)) : null
    if (expiresAt && expiresAt <= now()) throw new Error('Voice relay credentials expired')
    return { ...config, iceServers: config.iceServers, expiresAt }
  } catch { throw new Error(VOICE_CONFIG_UNAVAILABLE) }
}

/** True when a cached configuration has run out. */
export const iceExpired = (config: IceConfig | null, now: number): boolean => Boolean(config?.expiresAt && now >= config.expiresAt)

/** What to tell the player when getUserMedia failed. */
export function microphoneFailure(error: unknown): 'denied' | 'unavailable' {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable'
}

/** Why a microphone could not be opened, as far as the browser says. */
export type MicProblem = 'denied' | 'no-device' | 'in-use' | 'failed'
export function microphoneProblem(error: unknown): MicProblem {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-device'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'in-use'
  return 'failed'
}
/** What to tell the player, with what they can do about it. */
export const MIC_HELP: Readonly<Record<MicProblem, string>> = {
  denied: 'Microphone blocked. Allow the microphone for this site (the lock icon in the address bar, or your phone’s browser settings), then tap Try again.',
  'no-device': 'No microphone was found. Plug one in or switch it on, then tap Try again.',
  'in-use': 'Your microphone is being used by another app. Close that app, then tap Try again.',
  failed: 'The microphone could not be opened. Tap Try again.',
}
