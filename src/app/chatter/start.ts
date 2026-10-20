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
import { BUBBLE_MS, clearBubbles, say, sayTag, tagOf } from './bubbles.ts'
import { heard, heardStop } from '../../audio/voice/emit.ts'
import { cityTalkContextKey, createCityTalk, type CityTalkContext } from './cityTalk.ts'

/** How often the visit asks the picker. An exchange stays due for 20 s, so this never misses one. */
export const POLL_MS = 4_000

let started = false

export function startChatter(): void {
  if (started) return
  started = true
  const { game, scene, community } = useApp()
  const chatter = newChatter()
  const cityTalk = createCityTalk({ fetchView: () => game.fetchJson('/api/story/talk'), now: Date.now })
  const talkContext = (): CityTalkContext => ({
    identity: game.session.value?.id ?? null, bornAt: game.state.value.onboarding.bornAt ?? Number.NaN,
    city: game.view.value.cityId, venue: game.state.value.location,
    enabled: game.view.value.story.enabled === true, connected: game.connected.value,
  })
  let exchangeSerial = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (run: () => void, ms: number): void => {
    const id = globalThis.setTimeout(() => { timers.delete(id); run() }, ms)
    timers.add(id)
  }
  const stop = (): void => { exchangeSerial++; for (const id of timers) globalThis.clearTimeout(id); timers.clear(); clearBubbles(); heardStop() }

  /** The regulars standing in the scene that the scene is drawing a tag over: only they can be heard to talk. */
  const standing = (cityId: string, venue: string): Regular[] => {
    let list: readonly { id: string; name: string; venue: string }[] = []
    try { list = regularsFor(cityId) } catch { return [] }
    return list.filter((npc) => npc.venue === venue && tagOf(npc.id) !== null).map((npc) => ({ id: npc.id, name: npc.name }))
  }

  const speak = (who: { npcId: string; name: string; text: string }, beta: boolean, reply = false): void => {
    say(who.npcId, who.name, who.text, beta)
    scene.venue.value?.animateSpeech(`npc:${who.npcId}`, BUBBLE_MS)
    const at = scene.venue.value?.ambientPeople?.().find((person) => person.id === `npc:${who.npcId}`)
    heard({ id: `npc:${who.npcId}`, text: who.text, kind: 'regular', reply, ...(at ? { x: at.x, z: at.z } : {}) })
    community.controller()?.npcLine?.(beta ? `${who.name} (beta)` : who.name, who.text)
  }
  const play = (chosen: Chosen, current: () => boolean): void => {
    if (!current()) return
    // The two turn to face each other while they talk.
    scene.venue.value?.talk?.(`npc:${chosen.first.npcId}`, `npc:${chosen.second.npcId}`, REPLY_DELAY_MS + 6_000)
    speak(chosen.first, chosen.beta)
    scene.venue.value?.wakeAmbient()
    later(() => { if (current()) speak(chosen.second, chosen.beta, true) }, REPLY_DELAY_MS)
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
    if (!chosen) return
    const context = talkContext(), key = cityTalkContextKey(context), currentScene = scene.venue.value
    const serial = ++exchangeSerial
    const current = (): boolean => {
      if (serial !== exchangeSerial || cityTalkContextKey(talkContext()) !== key || !currentScene || scene.venue.value !== currentScene
        || globalThis.document.hidden || isDeparting(game.state.value)) return false
      const present = standing(context.city, context.venue)
      return present.some(row => row.id === chosen.first.npcId) && present.some(row => row.id === chosen.second.npcId)
    }
    if (!context.enabled || !context.connected || !context.identity || !Number.isFinite(context.bornAt)) {
      play(chosen, current)
      return
    }
    const replacement = cityTalk.replace(context, chosen), generation = cityTalk.generation
    const currentBank = (): boolean => current() && cityTalk.isCurrent(talkContext(), generation)
    if (replacement instanceof Promise) void replacement.then(next => play(next, currentBank), () => play(chosen, currentBank))
    else play(replacement, currentBank)
  }

  // An AI agent's line in the venue chat (community.ts raises the event): the same bubble over its character, labelled AI.
  globalThis.addEventListener('jaw:agent-say', (event) => {
    const detail = (event as CustomEvent<{ id?: string; name?: string; text?: string }>).detail
    if (detail?.id && detail.text) sayTag(detail.id, `${detail.name ?? 'Agent'} · AI`, detail.text)
  })
  const reset = (): void => { cityTalk.clear(); chatter.reset(); stop() }
  watch(() => [cityTalkContextKey(talkContext()), scene.venue.value] as const, reset, { flush: 'sync' })
  globalThis.document.addEventListener('visibilitychange', () => { if (globalThis.document.hidden) reset() })
  globalThis.setInterval(tick, POLL_MS)
  // The city news strip (src/news/, docs/GIST.md "The ticker") starts here too: this chunk is fetched by every player once the game is up, so the first download carries nothing of it.
  void import('../features/gist/mountTicker.ts').then(({ mountTicker }) => { mountTicker() }, () => undefined)
}
