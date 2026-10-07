// The routines pack: importing this file teaches the engine where the regulars are (src/game/routines-hook.ts).
//
// The engine itself carries only the hook, a few bytes. The table, the classifier and the resolver sit in this chunk (vite.config.ts,
// `routines`), imported by the server, the Worker and the tests, and fetched by the browser once the game is on screen (src/app/startApp.ts).
// Until it arrives, the browser lists every regular of a venue as it always did; when it installs, the views are derived again.
import { installRoutines, type Whereabouts } from '../routines-hook.ts'
import { systemsChanged } from '../registry.ts'
import { venueFor } from '../cities/runtime.ts'
import { weatherAt } from '../systems/health.ts'
import { nextChange, where, whereLine } from './resolve.ts'
import type { Sky } from './types.ts'

const DRY: Sky = { raining: false }
/** Weather is read by the engine's own rules; a city it does not know has a dry sky. */
function skyAt(now: number, city: string): Sky {
  try { return { raining: weatherAt(now, city).raining } } catch { return DRY }
}

/** A quarter of an hour of one regular in one sky is one answer: the People panel asks for the same regulars on every redraw. */
const answers = new Map<string, Whereabouts>()

function whereabouts(npc: Parameters<typeof where>[0], now: number, city: string): Whereabouts {
  const at = Number.isFinite(now) ? now : 0, sky = skyAt(at, city)
  const key = `${city}|${npc.id}|${Math.floor(at / 900000)}|${sky.raining ? 1 : 0}`
  const known = answers.get(key)
  if (known) return known
  const presence = where(npc, at, city, sky)
  const answer: Whereabouts = { here: presence.here, line: presence.why === 'always' ? '' : whereLine(presence, venueFor(city, npc.venue)?.label ?? 'here', nextChange(npc, at, city, sky), at) }
  if (answers.size > 4000) answers.clear()
  answers.set(key, answer)
  return answer
}

installRoutines(whereabouts)
systemsChanged()
