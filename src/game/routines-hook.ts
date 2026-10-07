// Where the regulars are (src/game/routines/). The engine asks; the routines pack answers once it is installed.
// With no pack installed every regular is where the venue's cast puts them, as before the routines existed.
import type { NpcDefinition } from '../types/content.ts'
import type { SocialView } from '../types/view.ts'

/** Whether a regular is at their venue now, one plain line saying where they are ("At Balogun Market till 6PM"), their entry in the venue's away list, and what a refusal to speak to them says. */
export interface Whereabouts { here: boolean; line: string; away: SocialView['away'][number]; refusal: string }
type Answer = (npc: NpcDefinition, now: number, city: string) => Whereabouts

const EVERYWHERE = { here: true, line: '' } as Whereabouts
/** The answer to ask: everyone is at their venue until a pack is installed (a live binding, so callers see the pack the moment it lands). */
export let whereabouts: Answer = () => EVERYWHERE
export const installRoutines = (next: Answer): void => { whereabouts = next }
