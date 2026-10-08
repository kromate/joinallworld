<script setup lang="ts">
// The host's side of visiting, on the Home tab: who can come in, Invite friends over, Share a link to my home, the door
// (Close the door, End visit) and the Guests strip. The word "friends" here means ordinary friends: the founder's automatic
// friendship never opens a door (server/social/visit.ts). Everything is the server's: this only asks.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, onMounted, reactive, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import PlayerAvatar from '../social/PlayerAvatar.vue'
import { cityId, social } from '../social/useSocial.ts'
import { copyText } from '../../../ui/share.ts'
import { VISIT, timeLeft } from '../../../game/visit.ts'
import GuestsStrip from './GuestsStrip.vue'
import VisitDoor from './VisitDoor.vue'
import { chooseDoor, closeDoor, endLink, endVisit, inviteOver, loadLinks, makeLink, visitState } from './visitStore.ts'

const { game } = useApp()
const me = computed(() => social.me)
const house = computed(() => me.value?.house ?? null)
const guests = computed(() => house.value?.guests.length ?? 0)
const closed = computed(() => house.value?.closed === true)
const pending = ref(false), problem = ref<string | null>(null)
const offline = computed(() => !game.view.value.connected)
async function manage(operation: () => Promise<string | null>): Promise<void> {
  if (pending.value || offline.value) return
  pending.value = true; problem.value = null
  try { problem.value = await operation() } finally { pending.value = false }
}

// ---- the one-time question for a player who has not chosen yet ----------------------------------
const asking = computed(() => me.value !== null && !me.value.door.chosen)

// ---- Invite friends over -------------------------------------------------------------------------
const picking = ref(false)
const search = ref('')
const chosen = reactive(new Set<string>())
const note = ref<string | null>(null)
const friends = computed(() => (me.value?.friends ?? []).filter((friend) => !friend.founder)
  .filter((friend) => friend.name.toLowerCase().includes(search.value.trim().toLowerCase()))
  .sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online') || a.name.localeCompare(b.name)))
const here = computed(() => (me.value?.friends ?? []).filter((friend) => !friend.founder && friend.status === 'online' && friend.cityId === cityId()).slice(0, VISIT.inviteAll))
function toggle(id: string): void { if (chosen.has(id)) chosen.delete(id); else if (chosen.size < VISIT.inviteAll) chosen.add(id) }
async function send(ids: string[]): Promise<void> {
  if (!ids.length || pending.value || offline.value) return
  pending.value = true; problem.value = null
  try {
    const done = await inviteOver(ids)
    note.value = done.words
    game.toast(done.words, done.ok ? 'good' : 'error')
    if (done.ok) { chosen.clear(); picking.value = false }
  } finally { pending.value = false }
}

// ---- Share a link to my home ----------------------------------------------------------------------
const open = ref(false), limited = ref(false), uses = ref(5), hours = ref(VISIT.linkHours)
const linkNote = ref<string | null>(null)
onMounted(() => { void loadLinks() })
const origin = (): string => globalThis.location?.origin ?? ''
const words = (path: string): string => `Come to my home in Allworld: ${origin()}${path}`
async function make(): Promise<void> {
  if (pending.value || offline.value) return
  pending.value = true; linkNote.value = null
  try {
    const done = await makeLink({ hours: hours.value, ...(limited.value ? { max: uses.value } : {}), ...(open.value ? { open: true } : {}) })
    linkNote.value = done.reason
    if (done.link) await share(done.link.path)
  } finally { pending.value = false }
}
async function share(path: string): Promise<void> {
  const url = `${origin()}${path}`
  const nav = globalThis.navigator as Navigator | undefined
  if (typeof nav?.share === 'function') { try { await nav.share({ title: 'Come to my home in Allworld', text: 'Come to my home in Allworld.', url }); return } catch (error) { if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') return } }
  const copied = await copyText(url)
  game.toast(copied ? 'Link copied. Send it to a friend.' : 'Could not copy. Select the link and copy it yourself.', copied ? 'good' : 'error')
}
const whatsapp = (path: string): string => `https://wa.me/?text=${encodeURIComponent(words(path))}`
const live = computed(() => visitState.links.filter((link) => !link.ended && link.expiresAt > game.view.value.now))
const past = computed(() => visitState.links.filter((link) => link.ended || link.expiresAt <= game.view.value.now).slice(0, 3))
const usesLine = (link: { uses: number; max?: number }): string => `${link.uses}${link.max !== undefined ? ` of ${link.max}` : ''} ${link.uses === 1 ? 'person has' : 'people have'} come in`
</script>

<template>
  <section v-if="me && house" class="visit-home" aria-label="Visitors" data-visit="home">
    <h3 class="ui-section">Visitors</h3>
    <p v-if="offline" class="ui-note" role="status">Reconnect to manage visitors or create home links.</p>
    <p v-if="problem" class="ui-error" role="alert">{{ problem }}</p>
    <div v-if="asking" class="ui-card visit-ask" data-visit="ask">
      <strong>Let friends walk in?</strong>
      <p>Right now your friends knock and you answer. They can walk straight in while you are home instead: only your ordinary friends, never an empty home, and you can change it any time.</p>
      <span class="social-actions">
        <button type="button" class="social-btn is-primary" data-visit="ask-yes" :disabled="pending || offline" @click="manage(() => chooseDoor('walk'))">Yes, let them walk in</button>
        <button type="button" class="social-btn" data-visit="ask-no" :disabled="pending || offline" @click="manage(() => chooseDoor('knock'))">Keep knocking</button>
      </span>
    </div>

    <button type="button" class="ui-button is-primary is-block visit-big" data-visit="invite-open" :aria-expanded="picking" :disabled="pending" @click="picking = !picking"><GameIcon name="invite" inline /> Invite friends over</button>
    <div v-if="picking" class="visit-pick" data-visit="picker">
      <button type="button" class="ui-button is-block" data-visit="invite-here" :disabled="!here.length || pending || offline" @click="send(here.map((friend) => friend.id))">Everyone here ({{ here.length }})</button>
      <input v-model="search" class="visit-search" type="search" maxlength="40" placeholder="Search friends" aria-label="Search friends" autocomplete="off">
      <div v-if="friends.length" class="social-list">
        <label v-for="friend in friends" :key="friend.id" class="social-row visit-row">
          <PlayerAvatar :name="friend.name" :seed="friend.id" :status="friend.status" />
          <div><strong>{{ friend.name }}</strong><small>{{ friend.status === 'online' ? 'Online' : 'Not online' }}</small></div>
          <input type="checkbox" :disabled="pending" :checked="chosen.has(friend.id)" :aria-label="`Invite ${friend.name}`" :data-friend="friend.id" @change="toggle(friend.id)">
        </label>
      </div>
      <p v-else class="social-note">No friends to invite yet. Make friends first, or share a link below.</p>
      <button type="button" class="ui-button is-block" data-visit="invite-send" :disabled="!chosen.size || pending || offline" @click="send([...chosen])">Send {{ chosen.size ? `to ${chosen.size}` : 'invitations' }}</button>
      <p class="social-note">Each friend gets “{{ me.me.name }} invited you over” and can come in for the next {{ VISIT.inviteMinutes }} minutes.</p>
    </div>
    <p v-if="note" class="social-note" role="status">{{ note }}</p>

    <h3 class="ui-section">Share a link to my home</h3>
    <p class="social-note">Anyone with the link can come in, even if you are not friends yet: a real-life friend, a new player. Only while you are home, and you decide who comes in.</p>
    <div class="visit-options">
      <label class="visit-check"><input v-model="open" :disabled="pending" type="checkbox" data-visit="link-open"> Let anyone with the link in (no asking)</label>
      <label class="visit-check"><input v-model="limited" :disabled="pending" type="checkbox" data-visit="link-limit"> Limit to <input v-model.number="uses" class="visit-num" type="number" min="1" :max="VISIT.linkMaxUses" aria-label="Number of people" :disabled="!limited || pending"> people</label>
      <label class="visit-check">Ends after <select v-model.number="hours" :disabled="pending" aria-label="How long the link works"><option :value="1">1 hour</option><option :value="2">2 hours</option><option :value="6">6 hours</option><option :value="24">24 hours</option></select></label>
    </div>
    <button type="button" class="ui-button is-block" data-visit="link-make" :disabled="pending || offline" @click="make">Share a link to my home</button>
    <p v-if="linkNote" class="ui-error" role="alert">{{ linkNote }}</p>
    <div v-if="live.length || past.length" class="social-list" data-visit="links">
      <div v-for="link in live" :key="link.id" class="social-row" :data-link="link.id">
        <span class="social-avatar" aria-hidden="true"><GameIcon name="invite" inline /></span>
        <div><strong>Home link</strong><small>{{ timeLeft(link.expiresAt, game.view.value.now) }} · {{ usesLine(link) }}{{ link.open ? ' · lets anyone in' : '' }}</small></div>
        <span class="social-actions">
          <button type="button" class="social-btn" @click="share(link.path)">Send</button>
          <a class="social-btn" :href="whatsapp(link.path)" target="_blank" rel="noopener noreferrer">WhatsApp</a>
          <button type="button" class="social-btn" data-visit="link-end" :disabled="pending || offline" @click="manage(() => endLink(link.id))">End</button>
        </span>
      </div>
      <div v-for="link in past" :key="link.id" class="social-row">
        <span class="social-avatar" aria-hidden="true"><GameIcon name="invite" inline /></span>
        <div><strong>Ended link</strong><small>{{ usesLine(link) }}</small></div>
      </div>
    </div>

    <div class="visit-door-row">
      <button type="button" class="ui-button" data-visit="close" :disabled="pending || offline" @click="manage(() => closeDoor(!closed))">{{ closed ? 'Open the door again' : 'Close the door' }}</button>
      <button v-if="guests" type="button" class="ui-button" data-visit="end" :disabled="pending || offline" @click="manage(endVisit)">End visit</button>
    </div>
    <p v-if="closed" class="social-note">The door is closed: nobody new comes in. Your guests stay.</p>
    <GuestsStrip :house="house" />
    <VisitDoor />
  </section>
</template>

<style scoped>
.visit-big { margin: 8px 0; }
.visit-pick { display: grid; gap: 8px; margin: 6px 0 10px; }
.visit-home { min-width: 0; overflow-wrap: anywhere; }
.visit-home .social-row { flex-wrap: wrap; }
.visit-home .social-row > div { flex: 1 1 150px; min-width: 0; }
.visit-home .social-actions { flex-wrap: wrap; }
.visit-search { box-sizing: border-box; width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--c-line, #d8d8d8); border-radius: 10px; font: 400 16px var(--font); }
.visit-row { cursor: pointer; }
.visit-row input { width: 22px; height: 22px; flex: none; }
.visit-options { display: grid; gap: 6px; margin: 6px 0 10px; font-size: 13px; }
.visit-check { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.visit-num { width: 76px; min-height: 44px; font: 400 16px var(--font); }
.visit-check select { min-height: 44px; max-width: 100%; font: 400 16px var(--font); }
.visit-door-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 4px; }
.visit-door-row .ui-button { flex: 1 1 140px; }
.visit-ask p { margin: 4px 0 8px; font-size: 13px; }
</style>
