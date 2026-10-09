<script setup lang="ts">
// House invites: share your link, visitors knock, you choose Let them in or Not now. Up to five
// guests. Guests share a house chat and a guest list with the host. A knock only rings when the
// server sees the host connected and at home, and says which it is otherwise. The link carries
// only the public player id and is shown as text to copy, never as markup from another player.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, defineAsyncComponent, watch } from 'vue'
import { inviteIdFrom } from '../../../game/social-model.ts'
import type { HouseView } from '../../../types/social.ts'
import GameIcon from '../../ui/GameIcon.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import GateNote from './GateNote.vue'
const GuestsStrip = defineAsyncComponent(() => import('../visit/GuestsStrip.vue'))
const VisitButton = defineAsyncComponent(() => import('../visit/VisitButton.vue'))
import PlayerAvatar from './PlayerAvatar.vue'
import { HOST_STATUS, homeLine, knockReason, knockView, roomLine, statusText } from './inviteModel.ts'
import { inviteUi } from './socialState.ts'
import { useSocialScreen } from './useSocialScreen.ts'
import { copyText } from '../../../ui/share.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell, client, state, view, gate, action, runAction, retryLoad } = useSocialScreen()
const me = computed(() => state.me)
const link = computed(() => `${globalThis.location?.origin ?? ''}${me.value?.invitePath ?? ''}`)
const RULES = [
  'Anyone with the link can knock while you are at home. You decide who comes in.',
  'A guest joins the host’s home room (the host sees them standing by the door), and everyone inside shares the guest list and the house chat.',
  'A visit ends after 30 minutes, when the guest leaves or is asked to, or when the host goes out.',
  'Beta: guests do not see the host’s furniture yet, and there is no voice in a house visit from this screen.',
]

// Opened from an invite link: shell.open('invite', { host }). The lookup runs once the overview is here.
watch(() => props.params, (params) => {
  const host = (params as { host?: unknown } | null | undefined)?.host
  if (typeof host === 'string' && params !== inviteUi.params) { inviteUi.params = params; inviteUi.pending = host }
}, { immediate: true })
watch([() => inviteUi.pending, me], () => {
  if (inviteUi.pending && me.value) { const host = inviteUi.pending; inviteUi.pending = null; void lookUp(host) }
}, { immediate: true })

async function lookUp(host: string): Promise<void> {
  inviteUi.host = host; inviteUi.house = null; inviteUi.loading = true
  const result = await client.call<{ house: HouseView; knock: { status: 'pending' | 'accepted' | 'declined'; expiresAt: number } | null }>(`/api/social/house/${encodeURIComponent(host)}`)
  inviteUi.loading = false
  inviteUi.house = result.ok ? result : { error: result.reason }
  if (result.ok && result.knock?.status === 'pending') state.knock = { host, name: result.house.host.name, status: 'knocking', expiresAt: result.knock.expiresAt }
}

// What the looked-up house shows. Once I am inside, the overview's copy of the house is the current one;
// the looked-up copy predates the answer.
const looked = computed(() => (inviteUi.house && !('error' in inviteUi.house) ? inviteUi.house : null))
const lookError = computed(() => (inviteUi.house && 'error' in inviteUi.house ? inviteUi.house.error : null))
const house = computed<HouseView | null>(() => (looked.value ? (me.value?.visiting?.host.id === looked.value.house.host.id ? me.value.visiting : looked.value.house) : null))
const knock = computed(() => (house.value && state.knock?.host === house.value.host.id ? state.knock : null))
// The overview is authoritative; a cached lookup or accepted knock can outlive the visit.
const inside = computed(() => Boolean(house.value && me.value?.visiting?.host.id === house.value.host.id))
const knocking = computed(() => knockView(knock.value, view.value.now))
const why = computed(() => (house.value ? knockReason(house.value, inside.value, knocking.value.waiting) : null))

const answer = (visitor: string, choice: 'accept' | 'decline'): Promise<unknown> => client.perform<{ code: string }>('/api/social/house/answer', { visitor, answer: choice }, (done) => (done.code === 'accepted' ? 'They are in' : 'You said not now'))
const removeGuest = (guest: string): Promise<unknown> => client.perform('/api/social/house/leave', { host: me.value?.me.id, guest })
async function leave(host: string): Promise<void> {
  await client.perform('/api/social/house/leave', { host }, 'You left')
  state.knock = null
  if (inviteUi.host) void lookUp(inviteUi.host)
}
async function doKnock(host: string, name: string): Promise<void> {
  state.knock = { host, name, status: 'sending' }
  const result = await client.call<{ code: string; expiresAt?: number }>('/api/social/house/knock', { host, cityId: client.cityId() })
  state.knock = result.ok ? { host, name, status: result.code === 'inside' ? 'accepted' : 'knocking', expiresAt: result.expiresAt } : { host, name, status: 'failed', reason: result.reason }
  await client.sync(); void lookUp(host)
}
async function copy(): Promise<void> {
  if (await copyText(link.value)) game.toast('Link copied', 'good'); else game.toast('Could not copy. Select the link and copy it yourself.', 'error')
}
function visit(): void {
  const host = inviteIdFrom(inviteUi.paste)
  if (!host) { inviteUi.house = { error: 'That does not look like a house link. Paste the whole link.' }; return }
  void lookUp(host)
}
</script>

<template>
  <GateNote v-if="gate || !me" :gate="gate ?? { text: 'Loading…', warn: false, link: false, retry: false }" :action="action?.label ?? null" @action="runAction" @retry="retryLoad" />
  <div v-else class="invite">
    <section class="invite-card" aria-label="Your house link">
      <span class="invite-mark" aria-hidden="true"><GameIcon name="invite" bare /></span>
      <small>Your house link</small><strong>{{ game.state.value.name }}’s place</strong>
      <output class="social-code">{{ link }}</output>
      <button type="button" class="ui-button is-block" @click="copy">Copy link</button>
      <p>{{ homeLine(me.house.guests.length, me.house.capacity, game.state.value.location === 'home') }}</p>
    </section>
    <p class="ui-note">Share the link: people knock, you decide who comes in. A visit lasts up to 30 minutes.</p>

    <template v-if="me.house.knocks.length">
      <h3 class="ui-section">At your door</h3>
      <div class="social-list">
        <template v-for="visitor in me.house.knocks" :key="visitor.from.id">
          <div class="social-row is-ask">
            <PlayerAvatar :name="visitor.from.name" :seed="visitor.from.id" />
            <div><strong>{{ visitor.from.name }}</strong><small>is knocking{{ visitor.expiresAt <= view.now ? ' · expired' : '' }}</small></div>
            <span class="social-actions">
              <button type="button" class="social-btn is-primary" :disabled="me.house.guests.length >= me.house.capacity" @click="answer(visitor.from.id, 'accept')">Let them in</button>
              <button type="button" class="social-btn" @click="answer(visitor.from.id, 'decline')">Not now</button>
            </span>
          </div>
          <span v-if="me.house.guests.length >= me.house.capacity" class="social-why">Your house is full ({{ me.house.capacity }} guests). Ask someone to leave first.</span>
        </template>
      </div>
    </template>

    <h3 class="ui-section">Guests<small>{{ me.house.guests.length }}/{{ me.house.capacity }}</small></h3>
    <div v-if="me.house.guests.length" class="social-list">
      <div v-for="guest in me.house.guests" :key="guest.id" class="social-row">
        <PlayerAvatar :name="guest.name" :seed="guest.id" />
        <div><strong>{{ guest.name }}</strong><small>Inside · the visit ends after 30 minutes, or when you go out</small></div>
        <span class="social-actions"><button type="button" class="social-btn" @click="removeGuest(guest.id)">Ask to leave</button></span>
      </div>
    </div>
    <p v-else class="social-note">Nobody is visiting.</p>
    <button v-if="me.house.conv" type="button" class="ui-button is-block" @click="shell.open('messages', { conv: me.house.conv })">Open house chat</button>

    <template v-if="me.visiting">
      <h3 class="ui-section">You are visiting</h3>
      <div class="social-list">
        <div class="social-row is-visit">
          <span class="social-avatar" aria-hidden="true"><GameIcon name="home" inline /></span>
          <div><strong>{{ me.visiting.host.name }}’s house</strong><small>{{ HOST_STATUS[me.visiting.hostStatus] ?? '' }} · {{ me.visiting.guests.length }}/{{ me.visiting.capacity }} guests · {{ roomLine(state.houseRoom, me.visiting.host.id) }}</small></div>
          <span class="social-actions">
            <button type="button" class="social-btn is-primary" @click="shell.open('messages', { conv: `h.${me.visiting.host.id}` })">House chat</button>
            <button type="button" class="social-btn" @click="leave(me.visiting.host.id)">Leave</button>
          </span>
        </div>
      </div>
      <GuestsStrip :house="me.visiting" />
    </template>

    <h3 class="ui-section">Visit a house</h3>
    <form class="social-form is-search" @submit.prevent="visit">
      <input v-model="inviteUi.paste" name="link" maxlength="200" placeholder="Paste a house link" aria-label="House link" autocomplete="off"><button type="submit" class="social-btn">Find</button>
    </form>
    <p v-if="inviteUi.loading" class="social-note">Finding that house…</p>
    <p v-else-if="lookError !== null" class="social-note is-warn">{{ lookError }}</p>
    <p v-else-if="house && house.role === 'host'" class="social-note">That is your own house. Share the link with someone else.</p>
    <div v-else-if="house" class="ui-card">
      <h3>{{ house.host.name }}’s house</h3>
      <p>{{ statusText(house.hostStatus) }} · {{ house.guests.length }}/{{ house.capacity }} guests</p>
      <template v-if="inside">
        <p><strong>You are inside.</strong></p>
        <span class="social-actions">
          <button type="button" class="social-btn is-primary" @click="shell.open('messages', { conv: `h.${house.host.id}` })">Open house chat</button>
          <button type="button" class="social-btn" @click="leave(house.host.id)">Leave</button>
        </span>
      </template>
      <template v-else>
        <VisitButton :id="house.host.id" :name="house.host.name" />
        <button type="button" class="ui-button is-primary is-block" :disabled="Boolean(why)" @click="doKnock(house.host.id, house.host.name)">Knock</button>
        <span v-if="why" class="social-why">{{ why }}</span>
        <p v-if="knock?.status === 'declined'" class="social-note is-warn">{{ house.host.name }} said not now. You can knock again in a minute.</p>
        <p v-if="knock?.status === 'failed'" class="social-note is-warn">{{ knock.reason }}</p>
        <p v-if="knocking.expired" class="social-note is-warn">Nobody answered. Knock again if they are still home.</p>
        <button type="button" class="social-link" @click="lookUp(house.host.id)">Check again</button>
      </template>
    </div>
    <HowItWorks id="invite-rules" :rules="RULES" label="How visits work" page />
  </div>
</template>
