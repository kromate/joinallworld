// The Sound section of the Settings tab, as plain data and functions: which controls it lists, how a 0..1 level is shown, and what a
// change of one control does to the stored preferences. Pure, so it is tested without a browser. The values live in src/audio/settings.ts.
import type { SoundSettings } from '../../../audio/settings.ts'

export type SoundSwitchId = 'on' | 'quiet'
export type SoundSliderId = 'master' | 'effects' | 'ambience' | 'calls'
export const SOUND_SWITCHES: readonly { id: SoundSwitchId; label: string; hint: string }[] = [
  { id: 'on', label: 'Sound', hint: 'Everything the game plays. The speaker in the top bar does the same in one tap.' },
  { id: 'quiet', label: 'Quiet', hint: 'No background ambience, and softer effects. For buses and waiting rooms.' },
]
export const SOUND_SLIDERS: readonly { id: SoundSliderId; label: string; hint: string }[] = [
  { id: 'master', label: 'Volume', hint: 'Over everything.' },
  { id: 'effects', label: 'Effects', hint: 'Taps, coins, footsteps, doors, meals and rides.' },
  { id: 'ambience', label: 'Ambience', hint: 'The sound of the place you are in, and the weather.' },
  { id: 'calls', label: 'Call sounds', hint: 'Ringing and call tones.' },
]
export const SOUND_NOT_SAVED = 'This browser would not save the sound settings, so they last only until you close the tab.'

/** A 0..1 level as the whole percent shown beside a slider. */
export const percent = (level: number): number => Math.round(Math.min(1, Math.max(0, level)) * 100)
/** A slider's 0..100 value as a level. */
export const levelOf = (value: number | string): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, Math.round(n) / 100)) : 0
}
/** What changing one control stores. */
export function change(id: SoundSwitchId | SoundSliderId, value: boolean | number | string): Partial<SoundSettings> {
  if (id === 'on' || id === 'quiet') return { [id]: value === true }
  return { [id]: levelOf(value as number | string) }
}
/** The one-line state of the section: what the player hears right now. */
export function soundSummary(s: SoundSettings): string {
  if (!s.on) return 'Muted'
  if (s.master === 0) return 'Volume is at zero'
  return s.quiet ? 'On · quiet' : 'On'
}
