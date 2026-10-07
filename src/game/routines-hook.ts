// Where the regulars are (src/game/routines/). The engine asks; the routines pack answers once it is installed.
// With no pack installed every regular is where the venue's cast puts them, as before the routines existed.
import type { NpcDefinition } from '../types/content.ts'

/** Whether a regular is at their venue now, and one plain line saying where they are ("At Balogun Market till 6PM"). */
export interface Whereabouts { here: boolean; line: string }
type Answer = (npc: NpcDefinition, now: number, city: string) => Whereabouts

let answer: Answer | null = null
export const installRoutines = (next: Answer): void => { answer = next }
export const whereabouts = (npc: NpcDefinition, now: number, city: string): Whereabouts | null => answer?.(npc, now, city) ?? null
