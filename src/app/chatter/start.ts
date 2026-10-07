// REALISM R12: the regulars of a venue talk to each other. Fetched after the game is ready and the scene is up (src/app/startApp.ts);
// nothing of it is in the first download. Every NPC line is shown with the NPC mark and added to the venue feed as a local line: it
// never goes to the server and never reads as a player. Nothing runs at home or on a trip, nor while the page is hidden.
import { watch } from 'vue'
import { cachedCityContent } from '../../game/cities/registry.ts'
import { regularsFor } from '../../game/cities/runtime.ts'
import { REPLY_DELAY_MS, newChatter } from '../../game/chatter/index.ts'
import type { Chosen, Regular } from '../../game/chatter/index.ts'
import { isDeparting } from '../../life.ts'
import { useApp } from '../state/app.ts'
import { clearBubbles, say, tagOf } from './bubbles.ts'

/** How often the visit asks the picker. An exchange stays due for 20 s, so this never misses one. */
export const POLL_MS = 4_000

let started = false

export function startChatter(): void {
  if (started) return
  started = true
  const { game, scene, community } = useApp()
  const chatter = newChatter()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (run: () => void, ms: number): void => {
    const id = globalThis.setTimeout(() => { timers.delete(id); run() }, ms)
    timers.add(id)
  }
  const stop = (): void => { for (const id of timers) globalThis.clearTimeout(id); timers.clear(); clearBubbles() }

  /** The regulars standing in the scene that the scene is drawing a tag over: only they can be heard to talk. */
  const standing = (cityId: string, venue: string): Regular[] => {
    let list: readonly { id: string; name: string; venue: string }[] = []
    try { list = regularsFor(cityId) } catch { return [] }
    return list.filter((npc) => npc.venue === venue && tagOf(npc.id) !== null).map((npc) => ({ id: npc.id, name: npc.name }))
  }

  const speak = (who: { npcId: string; name: string; text: string }, beta: boolean): void => {
    say(who.npcId, who.name, who.text, beta)
    community.controller()?.npcLine?.(beta ? `${who.name} (beta)` : who.name, who.text)
  }
  const play = (chosen: Chosen, key: string): void => {
    const same = (): boolean => `${game.view.value.cityId}|${game.state.value.location}` === key && !isDeparting(game.state.value)
    speak(chosen.first, chosen.beta)
    later(() => { if (same()) speak(chosen.second, chosen.beta) }, REPLY_DELAY_MS)
  }

  const tick = (): void => {
    if (globalThis.document.hidden) return
    const state = game.state.value
    if (!scene.venue.value || state.location === 'home' || isDeparting(state)) { chatter.reset(); stop(); return }
    const cityId = game.view.value.cityId
    const venue = cachedCityContent(cityId)?.venues.find((item) => item.id === state.location)
    if (!venue) return
    const regulars = standing(cityId, state.location)
    if (regulars.length < 2) return
    const chosen = chatter.poll({ cityId, venueId: state.location, place: { kind: venue.kind }, regulars }, Date.now())
    if (chosen) play(chosen, `${cityId}|${state.location}`)
  }

  // Leaving a venue ends its talk at once.
  watch(() => `${game.view.value.cityId}|${game.state.value.location}`, () => { chatter.reset(); stop() })
  globalThis.setInterval(tick, POLL_MS)
}
