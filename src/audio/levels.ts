// The gain each category plays at, from the preferences. Used by the audio engine and by the call tones; not in the first download.
import { getSound, type SoundSettings } from './settings.ts'

export type SoundCategory = 'effects' | 'ambience' | 'calls'
/** What Quiet does to the effects level. */
export const QUIET_EFFECTS = 0.5

/** 0 when muted, and 0 for ambience in Quiet. Call tones ignore Quiet (a ringing phone must still be heard). */
export function levelFor(settings: SoundSettings, category: SoundCategory): number {
  if (!settings.on) return 0
  if (category === 'ambience' && settings.quiet) return 0
  return settings.master * settings[category] * (category === 'effects' && settings.quiet ? QUIET_EFFECTS : 1)
}
/** The gain for a category right now. Call tones route their output through this and listen with onSoundChange. */
export const soundLevel = (category: SoundCategory): number => levelFor(getSound(), category)
