<script setup lang="ts">
// Who is inside a home, as a compact strip: the host sees Call, Chat and Ask to leave for each guest (and Add friend for
// someone who came through a link); a guest sees who else is inside and Leave. Names are text, never markup.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { useCall } from '../calls/useCall.ts'
import PlayerAvatar from '../social/PlayerAvatar.vue'
import { call, perform, social, cityId, sync } from '../social/useSocial.ts'
import type { HouseView } from '../../../types/social.ts'
import type { CaptureConsentResult } from '../../../types/visit.ts'

const props = defineProps<{ house: HouseView }>()
const { shell } = useApp()
const { request } = useCall()
const mine = computed(() => social.me?.me.id ?? '')
const host = computed(() => props.house.role === 'host')
const friends = computed(() => new Set((social.me?.friends ?? []).map((item) => item.id)))
const asked = computed(() => new Set((social.me?.requests.out ?? []).map((item) => item.id)))
const others = computed(() => props.house.guests.filter((guest) => guest.id !== mine.value))
const captureBusy = ref(false)
const captureError = ref('')
/** Someone inside who is not the viewer's friend (yet): they came through a link or an invitation. */
const stranger = (id: string): boolean => id !== mine.value && !friends.value.has(id)
const askToLeave = (id: string): Promise<unknown> => perform('/api/social/house/leave', { host: props.house.host.id, guest: id })
const leave = (): Promise<unknown> => perform('/api/social/house/leave', { host: props.house.host.id }, 'You left')
const addFriend = (id: string): Promise<unknown> => perform('/api/social/friends/request', { to: id, cityId: cityId() }, 'Friend request sent')
async function setCaptureConsent(allow: boolean): Promise<void> {
  const permission = props.house.myCapture
  if (host.value || !permission || captureBusy.value) return
  captureBusy.value = true; captureError.value = ''
  try {
    const result = await call<Extract<CaptureConsentResult, { ok: true }>>('/api/social/visit/capture-consent', { host: props.house.host.id, visitId: permission.visitId, allow })
    if (!result.ok) { captureError.value = result.reason; await sync(); return }
    await sync()
  } finally { captureBusy.value = false }
}
</script>

<template>
  <section class="guests-strip" aria-label="Guests" data-visit="guests">
    <h3 class="ui-section">Guests<small>{{ house.guests.length }}/{{ house.capacity }}</small></h3>
    <p v-if="!host" class="social-note">You are visiting {{ house.host.name }}’s home.</p>
    <div v-if="!host && house.myCapture" class="guest-capture" data-visit="capture-consent">
      <strong>Silent scene video</strong>
      <p>Allow {{ house.host.name }} to save a silent video of the room for up to 30 seconds. It stays on their device. This permission ends when your visit does.</p>
      <button class="ui-button is-block" type="button" :aria-pressed="house.myCapture.allowed" :disabled="captureBusy" @click="setCaptureConsent(!house.myCapture.allowed)">
        {{ captureBusy ? 'Saving…' : house.myCapture.allowed ? 'Revoke recording permission' : 'Allow recording for this visit' }}
      </button>
      <p v-if="captureError" class="social-note" role="alert">{{ captureError }}</p>
    </div>
    <p v-if="host && house.guests.length" class="social-note" role="status" data-visit="capture-status">
      {{ house.capture?.ready ? 'Every guest has allowed a silent scene recording.' : 'Scene recording stays paused until every guest allows it.' }}
    </p>
    <div v-if="host && !house.guests.length" class="social-note">Nobody is inside.</div>
    <div v-if="host ? house.guests.length : others.length" class="social-list">
      <div v-for="guest in host ? house.guests : others" :key="guest.id" class="social-row" :data-guest="guest.id">
        <PlayerAvatar :name="guest.name" :seed="guest.id" />
        <div><strong>{{ guest.name }}</strong><small>Inside</small></div>
        <span class="social-actions">
          <button type="button" class="social-btn" @click="request({ id: guest.id, name: guest.name })">Call</button>
          <button type="button" class="social-btn" @click="shell.open('messages', { conv: `h.${house.host.id}` })">Chat</button>
          <button v-if="stranger(guest.id) && !asked.has(guest.id)" type="button" class="social-btn" data-visit="add-friend" @click="addFriend(guest.id)">Add friend</button>
          <button v-if="host" type="button" class="social-btn" data-visit="ask-to-leave" @click="askToLeave(guest.id)">Ask to leave</button>
        </span>
      </div>
    </div>
    <span v-if="!host && stranger(house.host.id) && !asked.has(house.host.id)" class="social-actions"><button type="button" class="social-btn" data-visit="add-host" @click="addFriend(house.host.id)">Add {{ house.host.name }} as a friend</button></span>
    <button v-if="!host" type="button" class="ui-button is-block" data-visit="leave" @click="leave">Leave</button>
  </section>
</template>

<style scoped>
.guest-capture { display: grid; gap: 8px; margin: 8px 0; padding: 12px; border: 1px solid var(--c-line); border-radius: var(--r-sm); background: var(--c-fill); }
.guest-capture > strong { font-size: 13px; }
.guest-capture > p { margin: 0; color: var(--c-ink-2); font-size: 12px; line-height: 1.4; }
.guest-capture button:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
