<script setup lang="ts">
// The notices of a visit, one stack at the bottom of the screen: a link someone opened ("Ada invites you to their home in
// Allworld" — for a person who has not played yet it says Play needs no sign-up; once they are in the game the link is used and
// they land inside), "Bola is at your door" with Let in / Not now, "Ada invited you over" with Come in, and a thank-you when a
// guest's visit ends. Text only: a player's name is never markup. Mounted by features/ping/PingNotices.vue, which is loaded
// when there is something to show (ping/pingLoader.ts).
import '../../../ui/controls.css'
import { computed, reactive, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { attach, call, perform, social, sync } from '../social/useSocial.ts'
import { HOUSE_KEY } from '../ping/pingLoader.ts'
import type { LinkEnterResult } from '../../../types/visit.ts'
import { peekLink, visitHome } from './visitStore.ts'

const { game, shell, api } = useApp()
attach(api)
const KEEP_MS = 3 * 3600000
const store = (): Storage | null => { try { return globalThis.localStorage ?? null } catch { return null } }
function kept(): string | null {
  try {
    const found = JSON.parse(store()?.getItem(HOUSE_KEY) ?? 'null') as { token?: unknown; at?: unknown } | null
    if (found && typeof found.token === 'string' && Date.now() - Number(found.at) < KEEP_MS) return found.token
  } catch { /* nothing kept */ }
  return null
}
const forget = (): void => { try { store()?.removeItem(HOUSE_KEY) } catch { /* nothing was kept */ } token.value = null }
const token = ref<string | null>(kept())
const line = ref<{ title: string; text: string; tone: 'good' | 'info' } | null>(null)
const hands = { toast: (text: string, tone?: 'good' | 'error') => game.toast(text, tone), open: (id: string, params?: unknown) => shell.open(id, params) }
const ready = computed(() => game.connected.value && game.view.value.onboarding?.required !== true)
/** A host this device is about to be let in by (a link that asked, or an invitation): the visit opens its screen when it begins. */
let expecting: string | null = null

// ---- a house link: what it is, then use it ------------------------------------------------------
watch(token, async (now) => {
  if (!now) return
  const seen = await peekLink(now)
  if (token.value !== now) return
  if (!seen) return
  if (seen.code === 'open') line.value = { title: `${seen.host.name} invites you to their home in Allworld`, text: ready.value ? 'Coming in…' : 'Allworld is a game. Pick a name and press Play: no sign-up needed.', tone: 'good' }
  else { line.value = { title: seen.code === 'expired' ? 'That home link has run out' : 'That home link has ended', text: 'You can still play Allworld.', tone: 'info' }; forget() }
}, { immediate: true })
let entering = false
watch([ready, token], async ([now, held]) => {
  if (!now || !held || entering) return
  entering = true
  try {
    const done = await call<Extract<LinkEnterResult, { ok: true }>>('/api/social/visit/link/enter', { token: held })
    // No answer, or no life in the game yet: the link is kept for the next try.
    if (!done.ok && (done.transport || done.code === 'device_session_required' || done.code === 'onboarding_required' || done.code === 'rate_limited')) return
    forget()
    if (!done.ok) { line.value = { title: 'Could not come in', text: done.reason, tone: 'info' }; return }
    if (done.code === 'knocking') {
      const host = line.value?.title.replace(/ invites you.*$/, '') ?? 'the host'
      line.value = { title: `Asking ${host} to let you in`, text: 'They see your name at their door. It takes a moment.', tone: 'good' }
      expecting = 'link'
      void sync()
      return
    }
    line.value = null
    await sync()
    const host = social.me?.visiting?.host
    if (host) { hands.toast(`You are visiting ${host.name}’s home.`, 'good'); hands.open('invite', { host: host.id }) }
  } finally { entering = false }
}, { immediate: true })

// ---- a visit that began (a knock answered) and one that ended ------------------------------------
watch(() => social.me?.visiting?.host.id ?? null, (now, before) => {
  if (now && expecting) { expecting = null; line.value = null; hands.toast(`You are visiting ${social.me?.visiting?.host.name ?? 'their'}’s home.`, 'good'); hands.open('invite', { host: now }) }
  if (!now && before) {
    const guest = game.state.value.onboarding?.stage === 'guest' && !game.state.value.onboarding.done
    line.value = { title: 'Thanks for visiting', text: guest ? 'You are back where you were. Settle in to build a home of your own, and sign up to keep your friends.' : 'You are back where you were.', tone: 'info' }
  }
})

// ---- at the door, and invited ---------------------------------------------------------------------
const now = computed(() => game.view.value.now)
const knocks = computed(() => (social.me?.house.knocks ?? []).filter((knock) => knock.expiresAt > now.value))
const dismissed = reactive(new Set<string>())
const invites = computed(() => (social.me?.invites ?? []).filter((invite) => invite.expiresAt > now.value && !dismissed.has(invite.from.id)))
const answer = (visitor: string, choice: 'accept' | 'decline'): Promise<unknown> => perform<{ code: string }>('/api/social/house/answer', { visitor, answer: choice }, (done) => (done.code === 'accepted' ? 'They are in' : 'You said not now'))
const comeIn = (id: string, name: string): Promise<boolean> => visitHome(hands, id, name)
const dismiss = (): void => { line.value = null; if (token.value) forget() }
const any = computed(() => line.value !== null || knocks.value.length > 0 || invites.value.length > 0)
</script>

<template>
  <div v-if="any" class="visit-stack" role="status" aria-live="polite" data-visit="notices">
    <aside v-if="line" class="visit-card" :class="`is-${line.tone}`" data-visit="line">
      <div class="visit-words"><strong>{{ line.title }}</strong><small>{{ line.text }}</small></div>
      <button type="button" class="visit-close" aria-label="Dismiss" @click="dismiss">×</button>
    </aside>
    <aside v-for="knock in knocks" :key="`k${knock.from.id}`" class="visit-card is-good" data-visit="knock">
      <div class="visit-words"><strong>{{ knock.from.name }} {{ knock.via === 'link' ? 'wants to come in through your link' : 'is at your door' }}</strong><small>{{ knock.via === 'link' ? 'You have not met yet. Let them in or not.' : 'Let them in or not now.' }}</small></div>
      <div class="visit-actions">
        <button type="button" class="ui-button is-small is-primary" data-visit="let-in" @click="answer(knock.from.id, 'accept')">Let in</button>
        <button type="button" class="ui-button is-small" data-visit="not-now" @click="answer(knock.from.id, 'decline')">Not now</button>
      </div>
    </aside>
    <aside v-for="invite in invites" :key="`i${invite.from.id}`" class="visit-card is-good" data-visit="invite">
      <div class="visit-words"><strong>{{ invite.from.name }} invited you over</strong><small>Come in any time in the next half hour.</small></div>
      <div class="visit-actions">
        <button type="button" class="ui-button is-small is-primary" data-visit="come-in" @click="comeIn(invite.from.id, invite.from.name)">Come in</button>
        <button type="button" class="ui-button is-small" @click="dismissed.add(invite.from.id)">Later</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.visit-stack { position: fixed; left: 50%; bottom: calc(env(safe-area-inset-bottom) + 84px); transform: translateX(-50%); zoom: var(--ui-zoom, 1); z-index: 70; display: grid; gap: 8px; width: min(440px, calc(100% - 16px)); font-family: var(--font); }
.visit-card { box-sizing: border-box; display: grid; grid-template-columns: 1fr auto; gap: 8px 10px; align-items: start; padding: 12px 12px 12px 14px; border-radius: 16px; background: #fff; color: var(--c-ink); box-shadow: 0 8px 28px rgba(0, 0, 0, .28); }
.visit-card.is-good { border-left: 5px solid var(--c-green-dark); }
.visit-card.is-info { border-left: 5px solid #e39a1c; }
.visit-words { min-width: 0; }
.visit-words strong { display: block; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
.visit-words small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.35; color: var(--c-muted); }
.visit-actions { grid-column: 1 / -1; display: flex; gap: 6px; }
.visit-actions .ui-button { flex: 1 1 0; min-height: 40px; }
.visit-close { width: 32px; height: 32px; border: 0; border-radius: 50%; background: var(--c-fill); color: var(--c-ink); font-size: 18px; line-height: 1; cursor: pointer; }
</style>
