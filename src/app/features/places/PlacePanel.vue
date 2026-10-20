<script setup lang="ts">
// The panel under the scene while the player stands in a place (the Square, or a group's room), instead of the venue panel:
// who is here, voice, the room's chat, building the room together, its link, and the way out. Everything is the server's:
// this only asks (placesStore.ts). Voice is asked for by its button alone, as everywhere (src/community.ts).
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import PlayerAvatar from '../social/PlayerAvatar.vue'
import { copyText } from '../../../ui/share.ts'
import { FURNITURE } from '../../../game/content/furniture.ts'
import { PLACES, SERVICE_WORDS, SQUARE_ROOM, roomKeyOf } from '../../../places/model.ts'
import { placeNow, placePeople } from './placeState.ts'
import { addPiece, askToLeave, enterRoom, movePiece, places, removePiece, setLink, stepOut } from './placesStore.ts'
import { gist, loadGist } from '../gist/gistStore.ts'
import { squareLine } from '../gist/gistModel.ts'
import { SQUARE_TURN_MS } from '../gist/gistConfig.ts'
import type { FurnitureDefinition } from '../../../types/content.ts'

// Design with AI (docs/SPACES.md): fetched only when opened.
const DesignSheet = defineAsyncComponent(() => import('../spaces/DesignSheet.vue'))
const designOpen = ref(false)
const WorldScreen = defineAsyncComponent(() => import('../spaces/WorldScreen.vue'))
// The world's live moments here (docs/WORLD-EVENTS.md): the weekly event's bar and drops, election night, a stage. Its own chunk.
const PlaceLive = defineAsyncComponent(() => import('../world-events/PlaceLive.vue'))
const walking = ref(false)
const { game, shell, community } = useApp()
const now = computed(() => placeNow.value)
const room = computed(() => (now.value?.kind === 'room' ? places.room : null))
const member = computed(() => room.value?.role === 'member')
const others = computed(() => placePeople.value)
const title = computed(() => (now.value?.kind === 'room' ? now.value.name : 'The Square'))
const line = computed(() => {
  const n = others.value.length
  if (now.value?.kind === 'room') return n ? `Group room · ${n} ${n === 1 ? 'other person' : 'other people'} here` : 'Group room · only you are here'
  const total = places.square?.here ?? 0
  return total > 1 ? `${total} people from everywhere · ${n} around you` : 'Open to everyone, from every city'
})
const offline = computed(() => !game.view.value.connected)
// The Square's radio-style line: one fresh line of the city gist at a time ("Gist: ..."), at most three in turn, in the panel and never in chat.
const gistTurn = ref(0), clock = ref(Date.now())
const gistLine = computed(() => (now.value?.kind === 'square' ? squareLine(gist.lines, clock.value, gistTurn.value) : ''))
let reader: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void loadGist((path) => game.fetchJson(path), game.view.value.cityId)
  reader = setInterval(() => { gistTurn.value += 1; clock.value = Date.now(); void loadGist((path) => game.fetchJson(path), game.view.value.cityId, clock.value) }, SQUARE_TURN_MS)
})
onBeforeUnmount(() => { if (reader) clearInterval(reader) })
const pending = ref(false), problem = ref<string | null>(null)
async function run(operation: () => Promise<string | null>): Promise<void> {
  if (pending.value || offline.value) return
  pending.value = true; problem.value = null
  try { problem.value = await operation() } finally { pending.value = false }
}

// ---- voice: the room controller's own state and buttons ---------------------------------------------------------------
const voice = computed(() => community.state.value?.voice ?? null)
const joined = computed(() => community.state.value?.connection === 'Connected')
const voiceNote = computed(() => (voice.value?.on ? (voice.value.muted ? 'You are muted. Unmute to talk.' : 'You are live.') : now.value?.kind === 'room' ? 'Everyone in this room hears everyone who joins voice.' : 'Join voice to talk with the people standing near you.'))
const control = () => community.controller()

// ---- which part of the panel is open ----------------------------------------------------------------------------------
const tab = ref<'people' | 'build' | 'link' | null>(null)
const open = (next: 'people' | 'build' | 'link'): void => { tab.value = tab.value === next ? null : next; problem.value = null }

// ---- building the room together -------------------------------------------------------------------------------------
const CATEGORY_LABELS: Record<string, string> = { comfort: 'Seating', fun: 'Fun', decor: 'Decor', sleep: 'Beds', kitchen: 'Kitchen', bath: 'Bathroom', bathroom: 'Bathroom', study: 'Study', skills: 'Skills', light: 'Lights', pets: 'Pets' }
const labelOf = (id: string): string => CATEGORY_LABELS[id] ?? `${id.charAt(0).toUpperCase()}${id.slice(1)}`
const catalogue = Object.values(FURNITURE) as FurnitureDefinition[]
const categories = [...new Set(catalogue.map((item) => item.category))].sort((a, b) => Number(b === 'comfort') - Number(a === 'comfort') || Number(b === 'decor') - Number(a === 'decor') || Number(b === 'fun') - Number(a === 'fun') || a.localeCompare(b))
const category = ref<string>(categories[0] ?? 'comfort')
const palette = computed(() => catalogue.filter((item) => item.category === category.value))
const placed = computed(() => (room.value?.items ?? []).map((item) => ({ ...item, label: FURNITURE[item.itemId]?.label ?? item.itemId })))
const chosen = ref<string | null>(null)
const piece = computed(() => placed.value.find((item) => item.id === chosen.value) ?? null)
const full = computed(() => (room.value?.items.length ?? 0) >= PLACES.roomItems)
const add = (itemId: string): Promise<void> => run(() => addPiece(itemId))
const nudge = (dx: number, dy: number): Promise<void> => run(async () => { const at = piece.value; return at ? movePiece(at.id, at.x + dx, at.y + dy, at.rot) : null })
const turn = (): Promise<void> => run(async () => { const at = piece.value; return at ? movePiece(at.id, at.x, at.y, (at.rot + 1) % 4) : null })
const takeOut = (): Promise<void> => run(async () => { const at = piece.value; if (!at) return null; const said = await removePiece(at.id); if (!said) chosen.value = null; return said })

// ---- the room's link ---------------------------------------------------------------------------------------------------
const origin = (): string => globalThis.location?.origin ?? ''
const linkUrl = computed(() => (room.value?.link?.path ? `${origin()}${room.value.link.path}` : now.value?.kind === 'square' ? `${origin()}/square` : ''))
const linkOn = computed(() => Boolean(room.value?.link?.on))
const link = (on: boolean, fresh = false): Promise<void> => run(async () => (await setLink(on, fresh)).reason)
async function share(): Promise<void> {
  const url = linkUrl.value
  if (!url) return
  const nav = globalThis.navigator as Navigator | undefined, words = now.value?.kind === 'room' ? `Come to our room in Allworld: ${title.value}` : 'Meet me in the Square in Allworld'
  if (typeof nav?.share === 'function') { try { await nav.share({ title: words, text: `${words}.`, url }); return } catch (error) { if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') return } }
  const copied = await copyText(url)
  game.toast(copied ? 'Link copied. Send it to a friend.' : 'Could not copy. Select the link and copy it yourself.', copied ? 'good' : 'error')
}
function selectLink(event: Event): void { if (event.target instanceof HTMLInputElement) event.target.select() }
const whatsapp = computed(() => `https://wa.me/?text=${encodeURIComponent(`${now.value?.kind === 'room' ? `Come to our room in Allworld (${title.value})` : 'Meet me in the Square in Allworld'}: ${linkUrl.value}`)}`)
</script>

<template>
  <section v-if="now" class="life-venue-panel place-panel" aria-label="The place you are standing in" data-place="panel" :data-place-kind="now.kind">
    <header class="life-venue-header">
      <button class="life-avatar" type="button" aria-label="Open your character: profile, needs, goals and skills" @click="shell.open('sim')"><GameIcon inline name="person" /></button>
      <div class="life-venue-heading"><h1><GameIcon inline :name="now.kind === 'room' ? 'home' : 'globe'" /> {{ title }}</h1><p :title="line">{{ line }}</p></div>
      <button class="life-icon-button" type="button" aria-label="Open the chat of this place" title="Chat and people" data-place="chat" :disabled="offline" @click="community.toggle(true)"><GameIcon name="chat" /></button>
      <button class="life-icon-button" type="button" aria-label="Step out of this place" title="Step out" data-place="leave" @click="stepOut()"><GameIcon name="close" /></button>
    </header>
    <div class="life-spots">
      <button v-if="voice && !voice.on" type="button" class="place-voice" data-place="voice-join" :disabled="!voice.canJoin || !joined || offline" @click="control()?.joinVoice()"><GameIcon inline name="megaphone" /><span>{{ voice.joining ? 'Asking for the microphone…' : 'Join voice' }}</span></button>
      <template v-else-if="voice">
        <button type="button" class="place-voice is-on" data-place="voice-mute" :aria-pressed="voice.muted" @click="control()?.toggleMute()"><GameIcon inline name="megaphone" /><span>{{ voice.muted ? 'Unmute' : 'Mute' }}</span></button>
        <button type="button" data-place="voice-leave" @click="control()?.leaveVoice()"><span>Leave voice</span></button>
      </template>
      <button type="button" data-place="people" :aria-expanded="tab === 'people'" @click="open('people')"><GameIcon inline name="people" /><span>People ({{ others.length }})</span></button>
      <button v-if="member" type="button" data-place="build" :aria-expanded="tab === 'build'" @click="open('build')"><GameIcon inline name="buy" /><span>Build</span></button>
      <button v-if="member || now.kind === 'square'" type="button" data-place="link" :aria-expanded="tab === 'link'" @click="open('link')"><GameIcon inline name="invite" /><span>Invite</span></button>
      <button type="button" data-place="step-out" @click="stepOut()"><span>Step out</span></button>
    </div>
    <p class="social-note place-voice-note" role="status">{{ voiceNote }}</p>
    <p v-if="gistLine" class="social-note place-gist" data-place="gist">{{ gistLine }}</p>
    <PlaceLive :room="now.kind === 'room' ? roomKeyOf(now.id) : SQUARE_ROOM" :square="now.kind === 'square'" />
    <p v-if="offline" class="ui-note" role="status">Reconnect to talk, build or invite.</p>
    <p v-if="problem" class="ui-error" role="alert">{{ problem }}</p>

    <div v-if="tab === 'people'" class="place-part" data-place="people-list">
      <p v-if="!others.length" class="social-note">{{ now.kind === 'room' ? 'Nobody else is in the room. Send the link, or ask your group to come.' : 'Nobody is near you yet. Send the link to a friend: the Square is one place for every city.' }}</p>
      <div v-else class="social-list">
        <div v-for="person in others" :key="person.id" class="social-row">
          <PlayerAvatar :name="person.name" :seed="person.id" status="online" />
          <div>
            <strong>{{ person.name }}<template v-if="person.agent"> · AI-played</template></strong>
            <small v-if="person.service">{{ SERVICE_WORDS[person.service.kind] }} · {{ person.service.title }} — {{ person.service.about }}</small>
            <small v-else>{{ person.friend ? 'Friend' : now.kind === 'room' ? (person.member ? 'Member' : 'Visitor') : 'Here now' }}</small>
          </div>
          <span class="social-actions">
            <button type="button" class="social-btn" @click="shell.open('person', { player: person.id })">Open</button>
            <button v-if="member && !person.member" type="button" class="social-btn" :disabled="pending || offline" @click="run(() => askToLeave(person.id))">Ask to leave</button>
          </span>
        </div>
      </div>
    </div>

    <div v-if="tab === 'build' && member && room" class="place-part" data-place="builder">
      <button type="button" class="social-btn" data-place="design-ai" :disabled="offline" @click="designOpen = true">Design with AI</button>
      <DesignSheet v-if="designOpen" target="room" :room-id="room.id" @close="designOpen = false" @applied="enterRoom(room.id)" />
      <button type="button" class="social-btn" data-place="walk-3d" :disabled="offline" @click="walking = true">Walk in 3D</button>
      <WorldScreen v-if="walking" :where="{ target: 'room', id: room.id }" @close="walking = false" />
      <p class="social-note">Everyone in the group can add, move and take out pieces. They are free and belong to the room. {{ room.items.length }} of {{ PLACES.roomItems }} used.</p>
      <label class="place-field">Add<select v-model="category" aria-label="Kind of furniture"><option v-for="id in categories" :key="id" :value="id">{{ labelOf(id) }}</option></select></label>
      <div class="place-palette">
        <button v-for="item in palette" :key="item.id" type="button" class="social-btn" :data-add="item.id" :disabled="pending || offline || full" @click="add(item.id)">{{ item.label }}</button>
      </div>
      <label class="place-field">In the room<select v-model="chosen" aria-label="A piece in the room"><option :value="null">Choose a piece to move</option><option v-for="item in placed" :key="item.id" :value="item.id">{{ item.label }} ({{ item.x + 1 }}, {{ item.y + 1 }})</option></select></label>
      <div v-if="piece" class="place-move" role="group" :aria-label="`Move the ${piece.label}`">
        <button type="button" class="social-btn" aria-label="Move left" :disabled="pending || offline" @click="nudge(-1, 0)">←</button>
        <button type="button" class="social-btn" aria-label="Move back" :disabled="pending || offline" @click="nudge(0, -1)">↑</button>
        <button type="button" class="social-btn" aria-label="Move forward" :disabled="pending || offline" @click="nudge(0, 1)">↓</button>
        <button type="button" class="social-btn" aria-label="Move right" :disabled="pending || offline" @click="nudge(1, 0)">→</button>
        <button type="button" class="social-btn" :disabled="pending || offline" @click="turn()">Turn</button>
        <button type="button" class="social-btn" data-place="take-out" :disabled="pending || offline" @click="takeOut()">Take out</button>
      </div>
    </div>

    <div v-if="tab === 'link'" class="place-part" data-place="link-part">
      <template v-if="now.kind === 'square'">
        <p class="social-note">Anyone who opens this link lands in the Square, from any city, with no sign-up.</p>
      </template>
      <template v-else-if="!linkOn">
        <p class="social-note">Switch the room’s link on and anyone you send it to can come in and talk, even if they have never played. Visitors cannot read your group chat or change the room.</p>
        <button type="button" class="ui-button is-primary is-block" data-place="link-on" :disabled="pending || offline" @click="link(true)">Switch the link on</button>
      </template>
      <template v-if="linkUrl">
        <input class="place-link-url" :value="linkUrl" aria-label="The link to this place" readonly @focus="selectLink">
        <span class="social-actions">
          <button type="button" class="social-btn is-primary" data-place="link-share" @click="share()">Send</button>
          <a class="social-btn" :href="whatsapp" target="_blank" rel="noopener noreferrer">WhatsApp</a>
          <template v-if="now.kind === 'room'">
            <button type="button" class="social-btn" :disabled="pending || offline" @click="link(true, true)">New link</button>
            <button type="button" class="social-btn" data-place="link-off" :disabled="pending || offline" @click="link(false)">Switch off</button>
          </template>
        </span>
        <p v-if="now.kind === 'room'" class="social-note">A new link, or switching it off, sends every visitor out. Members stay.</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.place-panel { min-width: 0; overflow-wrap: anywhere; }
.place-panel .life-spots { flex-wrap: wrap; overflow: visible; row-gap: 8px; }
.place-panel .life-spots button { min-height: 44px; }
.place-voice.is-on { outline: 2px solid var(--c-good, #1a7f4b); }
.place-voice-note { margin: 2px 2px 0; }
.place-part { display: grid; gap: 8px; margin-top: 8px; max-height: min(46vh, 420px); overflow-y: auto; padding: 2px; }
.place-part .social-row { flex-wrap: wrap; }
.place-part .social-row > div { flex: 1 1 150px; min-width: 0; }
.place-field { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.place-field select { flex: 1; min-width: 0; min-height: 44px; font: 400 16px var(--font); }
.place-palette, .place-move { display: flex; flex-wrap: wrap; gap: 6px; }
.place-palette .social-btn, .place-move .social-btn { min-height: 44px; }
.place-move .social-btn { min-width: 44px; }
.place-link-url { box-sizing: border-box; width: 100%; min-height: 44px; padding: 8px 10px; font: 400 16px var(--font); border: 1px solid var(--c-line); border-radius: 8px; background: var(--c-fill); color: var(--c-ink); }
</style>
