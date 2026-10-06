<script setup lang="ts">
// The notices of a ping, one at a time: a friend pinged ("Ada is at Freedom Park, Lagos" — Join, Call, Chat), the landing of
// a join link, "You joined Ada", "Ada joined you", "Ada has left — you can message them", and "that invitation was for
// another player". Text only: a player's name is never markup. Nothing here opens the microphone: Call is the ordinary
// call button's ring, on an explicit tap.
import '../../../ui/controls.css'
import { computed, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { useCall } from '../calls/useCall.ts'
import { keptToken, pingUi } from './pingLoader.ts'
import { bannerView } from './pingModel.ts'
import type { PingAction } from './pingModel.ts'
import { closeBanner, joinFriend, loadIncoming, openKeptLink, pingState, takeFrames } from './pingStore.ts'

defineProps<{ inDialog?: boolean }>()
const { game, shell } = useApp()
const { request } = useCall()
// A join that changed city reads the life in that city (asking for it in the old one would only be told where it went).
const deps = {
  refresh: (cityId?: string) => (cityId && cityId !== game.cityId.value ? game.switchCity(cityId) : game.refresh()),
  // The join is this device's own change: while it runs the client follows no hint that the life changed (src/client.ts catchUp).
  async during<T>(work: () => Promise<T>): Promise<T> {
    const client = game.client
    if (client.busy) return work()
    client.busy = true
    try { return await work() } finally { client.busy = false }
  },
}
/** In the game as somebody: connected, and not still held for a look. */
const ready = computed(() => game.connected.value && game.view.value.onboarding?.required !== true)

watch(() => pingUi.frames.length, () => { takeFrames() }, { immediate: true })
// Once in the game (now, or after logging in): the link this device was opened with is answered, then what is still waiting is asked for.
watch(ready, async (now) => {
  if (!now) return
  if (keptToken() !== null) await openKeptLink(deps)
  if (!pingState.banner) await loadIncoming()
}, { immediate: true })

const view = computed(() => (pingState.banner ? bannerView(pingState.banner) : null))
const LABELS: Readonly<Record<PingAction, string>> = { join: 'Join', call: 'Call', chat: 'Chat', knock: 'Knock' }
/** What a screen reader says for a button: the short word alone would not say whom. */
const spoken = (action: PingAction): string => { const name = view.value?.who?.name ?? 'them'; return action === 'chat' ? `Chat with ${name}` : action === 'knock' ? `Knock at ${name}’s door` : `${LABELS[action]} ${name}` }
async function act(action: PingAction): Promise<void> {
  const who = view.value?.who
  if (!who) return
  if (action === 'join') { await joinFriend(who, deps); return }
  // Chat, Call and Knock open their own screens; the notice has done its work.
  closeBanner()
  if (action === 'chat') shell.open('messages', { to: who.id, name: who.name })
  else if (action === 'knock') shell.open('invite', { host: who.id })
  else if (action === 'call') await request({ id: who.id, name: who.name })
}
</script>

<template>
  <aside v-if="view" class="ping-notice" :class="[`is-${view.tone}`, { 'is-in-dialog': inDialog }]" role="status" aria-live="polite" data-ping="notice">
    <div class="ping-notice-words"><strong>{{ view.title }}</strong><small>{{ view.text }}</small></div>
    <div v-if="view.actions.length" class="ping-notice-actions">
      <button v-for="(action, index) in view.actions" :key="action" type="button" class="ui-button is-small" :class="{ 'is-primary': index === 0 }" :disabled="view.busy" :data-ping="action" :aria-label="spoken(action)" @click="act(action)">{{ view.busy && action === 'join' ? 'Joining…' : LABELS[action] }}</button>
    </div>
    <button type="button" class="ping-notice-close" aria-label="Dismiss" data-ping="close" @click="closeBanner">×</button>
  </aside>
</template>

<style scoped>
.ping-notice { box-sizing: border-box; position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 8px); transform: translateX(-50%); zoom: var(--ui-zoom, 1); z-index: 71; display: grid; grid-template-columns: 1fr auto; gap: 8px 10px; align-items: start; width: min(440px, calc(100% - 16px)); padding: 12px 12px 12px 14px; border-radius: 16px; background: #fff; color: var(--c-ink); box-shadow: 0 8px 28px rgba(0, 0, 0, .28); font-family: var(--font); }
/* Inside an open sheet: under its bar, so the sheet's own Back and Close stay in reach. */
.ping-notice.is-in-dialog { zoom: 1; top: calc(env(safe-area-inset-top) + 64px); }
.ping-notice.is-good { border-left: 5px solid var(--c-green-dark); }
.ping-notice.is-info { border-left: 5px solid #e39a1c; }
.ping-notice-words { min-width: 0; }
.ping-notice-words strong { display: block; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
.ping-notice-words small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.35; color: var(--c-muted); }
.ping-notice-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.ping-notice-actions .ui-button { flex: 1 1 0; min-width: 76px; min-height: 40px; }
.ping-notice-close { grid-column: 2; grid-row: 1; width: 32px; height: 32px; border: 0; border-radius: 50%; background: var(--c-fill); color: var(--c-ink); font-size: 18px; line-height: 1; cursor: pointer; }
.ping-notice-close:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
