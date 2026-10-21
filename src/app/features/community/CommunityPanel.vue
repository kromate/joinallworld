<script setup lang="ts">
// The community panel: who is here, nearby voice, room chat. It renders the controller's state
// (src/types/community.ts CommunityState) and calls its actions; it holds no rule of its own.
// Everything a player or the server typed (nicknames, chat lines, the server's sentences) is shown
// as text by Vue's interpolation, never as markup.
//
// The microphone: the Join voice button is the only control that can start it (a user gesture), and
// the controller starts the stream muted. Nothing in this file asks for media.
//
// Links: the server lets an allow-listed link through only from a checked stall owner in their own venue
// (server/trust/service.ts). Such a link is drawn as a button, never an <a>: it opens the lazy "You are leaving
// Allworld" sheet (features/trust/LinkInterstitial.vue), which shows who sent it before anything opens.
//
// Layout: a header (place, connection, head count), then the people and voice, then the chat, whose thread takes the room that is
// left and whose composer stays at the bottom of the sheet. On a wide screen the people and voice sit left and the chat right.
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CommunityStore } from './communityStore.ts'
import NpcBadge from '../../ui/NpcBadge.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import { initialOf, hueOf } from '../../ui/format.ts'
import { lineParts } from '../../../game/trust/links.ts'
import type { OutboundLink } from '../../../game/trust/links.ts'
import type { ChatLine, MemberRow } from '../../../types/community.ts'
import ScamNotice from '../trust/ScamNotice.vue'
import { SCAM_REPORT_REASON, scamReportText } from '../trust/scamNotice.ts'
import '../../../community.css'
const LinkInterstitial = defineAsyncComponent(() => import('../trust/LinkInterstitial.vue'))

const props = defineProps<{ store: Pick<CommunityStore, 'state' | 'controller' | 'close' | 'openPerson'> }>()
const s = computed(() => props.store.state.value)
const control = () => props.store.controller()
const nickname = ref('')
const draft = ref('')
const messages = ref<HTMLElement | null>(null)
const composer = ref<HTMLTextAreaElement | null>(null)
const leaving = ref<{ link: OutboundLink; line: ChatLine } | null>(null)
const linkOpened = ref(false)
const unseen = ref(0)
function openLink(link: OutboundLink, line: ChatLine): void { linkOpened.value = true; leaving.value = { link, line } }

const scamNote = ref('')
/** The scam banner's Report: the speaker is reported as a scam with the line as the note (the same report a player's card files). */
async function reportScam(line: ChatLine): Promise<void> {
  if (!line.authorId) return
  try {
    // The application's client is fetched only when someone taps Report (it is not part of what this panel needs to draw).
    const { useApp } = await import('../../state/app.ts')
    const sent = await useApp().game.fetchJson<{ ok?: boolean; code?: string; reason?: string }>('/api/social/reports', { method: 'POST', body: { id: line.authorId, reason: SCAM_REPORT_REASON, text: scamReportText(line.body) } })
    scamNote.value = sent.ok === false ? sent.reason ?? 'That report was not sent.' : 'Report received. A moderator will look at it.'
  } catch (error) { scamNote.value = error instanceof Error ? error.message : 'That report was not sent. Try again.' }
}

async function saveName(): Promise<void> { await control()?.saveName(nickname.value) }
function send(): void {
  if (!draft.value.trim()) return
  if (control()?.sendChat(draft.value)) { draft.value = ''; void nextTick(grow) }
}
/** A person's card opens over the game, so the panel steps aside. */
function openPerson(id: string, name: string): void { props.store.close(); props.store.openPerson(id, name) }
/** The HUD's own Invite button opens the share sheet (src/app/features/growth/InviteButton.vue): this presses it. */
function invite(): void { document.querySelector<HTMLButtonElement>('[data-invite-button]')?.click() }
function chooseDevice(event: Event): void { control()?.selectDevice((event.target as HTMLSelectElement).value) }
/** Enter sends, Shift+Enter makes a new line; Enter while a phone keyboard is composing a word does neither. */
function onComposerKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  send()
}
/** The composer grows with what is typed, up to four lines. */
function grow(): void {
  const field = composer.value
  if (!field) return
  field.style.height = 'auto'
  field.style.height = `${Math.min(field.scrollHeight, 104)}px`
}

// ---- who is here ------------------------------------------------------------------------------------------
const place = computed(() => { const parts = (s.value?.roomText ?? '').split(' · '); return parts.length > 1 ? parts.slice(1).join(' · ') : parts[0] ?? '' })
const city = computed(() => { const parts = (s.value?.roomText ?? '').split(' · '); return parts.length > 1 ? parts[0] ?? '' : '' })
const tone = computed(() => (s.value?.connection === 'Connected' ? 'good' : s.value?.canReconnect || /dis|unavail|changed/i.test(s.value?.connection ?? '') ? 'bad' : 'warn'))
const others = computed(() => (s.value?.members ?? []).filter((member) => !member.you))
const alone = computed(() => Boolean(s.value?.hasSession && !s.value.privateHome && s.value.connection === 'Connected' && others.value.length === 0))
/** A home or a group's room with nobody else in it: nothing to hear and nobody to hear you. With company, voice and the list are shown as anywhere. */
const privateAlone = computed(() => Boolean(s.value?.privateHome && others.value.length === 0))
const hereText = computed(() => { const n = s.value?.memberCount ?? 0; return n === 1 ? 'Just you' : `${n} here` })
function caption(member: MemberRow): string {
  if (member.you) return member.voice === 'off' ? 'You' : member.voice === 'muted' ? 'You · muted' : 'You · in voice'
  if (member.voice === 'off') return ''
  return `${member.voice === 'muted' ? 'Muted' : 'In voice'}${member.range === 'near' ? ' · near' : member.range === 'far' ? ' · far' : ''}`
}
const canWalk = computed(() => Boolean(s.value && !s.value.privateHome && !s.value.walkDisabled && others.value.length > 0))

// ---- walking: four arrow buttons, and the arrow keys while one of them has focus ---------------------------------
const STEPS = { up: [0, -2], left: [-2, 0], down: [0, 2], right: [2, 0] } as const
type Way = keyof typeof STEPS
function walk(way: Way): void { control()?.walk(STEPS[way][0], STEPS[way][1]) }
const KEYS: Record<string, Way> = { ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' }
function onPadKey(event: KeyboardEvent): void {
  const way = KEYS[event.key]
  if (!way || event.altKey || event.ctrlKey || event.metaKey || s.value?.walkDisabled) return
  event.preventDefault()
  walk(way)
}

// ---- voice -------------------------------------------------------------------------------------------------
const VOICE_RULES = [
  'Voice follows where your character stands: people near you are louder, and you stop hearing them 12 steps away.',
  'Your microphone starts muted. You choose when to unmute.',
]
const voiceRules = computed(() => [...VOICE_RULES, s.value?.voice.relayNote])
const voiceLine = computed(() => {
  const voice = s.value?.voice
  if (!voice) return ''
  if (voice.joining) return voice.status
  if (voice.on) return voice.status
  return 'Talk to people standing near you.'
})
const refusalNow = computed(() => Boolean(s.value?.refusal && s.value.feedback && s.value.feedback === s.value.refusal.text))
/** The server's refusal of a chat line shows by the composer; every other sentence shows at the top. */
const shownFeedback = computed(() => (refusalNow.value ? '' : s.value?.feedback ?? ''))

// ---- the thread ---------------------------------------------------------------------------------------------
const reduceMotion = (): boolean => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
const atBottom = (): boolean => { const list = messages.value; return !list || list.scrollHeight - list.scrollTop - list.clientHeight < 48 }
function toBottom(): void { const list = messages.value; if (list) { list.scrollTo({ top: list.scrollHeight, behavior: reduceMotion() ? 'auto' : 'smooth' }); unseen.value = 0 } }
function onScroll(): void { if (atBottom()) unseen.value = 0 }
const mine = (line: ChatLine): boolean => Boolean(line.authorId && line.authorId === s.value?.session?.id)
function clock(at?: number): string { return at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' }
// Keep the newest line in view as lines arrive, unless the player scrolled up to read: then offer a jump.
watch(() => s.value?.chat.length ?? 0, async (now, before) => {
  const stick = atBottom()
  const last = s.value?.chat[now - 1]
  await nextTick()
  if (stick || (last && mine(last))) { const list = messages.value; if (list) list.scrollTop = list.scrollHeight; unseen.value = 0 }
  else if (now > before) unseen.value += now - before
})

// ---- the keyboard: where the page does not shrink for it (iOS), lift the sheet by what the keyboard covers ----------
let viewport: VisualViewport | null = null
function lift(): void {
  const sheet = document.getElementById('community-panel')
  if (!sheet || !viewport) return
  const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
  sheet.style.setProperty('--kb', `${covered}px`)
}
onMounted(() => { viewport = globalThis.visualViewport ?? null; viewport?.addEventListener('resize', lift); viewport?.addEventListener('scroll', lift); lift() })
onBeforeUnmount(() => { viewport?.removeEventListener('resize', lift); viewport?.removeEventListener('scroll', lift); document.getElementById('community-panel')?.style.removeProperty('--kb') })
</script>

<template>
  <section v-if="s" class="community" :class="{ 'is-alone': alone }" aria-label="Local community" data-community-panel>
    <header class="community-header">
      <div class="community-title">
        <h2>{{ place }}</h2>
        <p v-if="city" class="community-room">{{ city }}</p>
      </div>
      <p class="community-status">
        <span class="community-connection" :class="`is-${tone}`" role="status"><i aria-hidden="true" />{{ s.connection }}</span>
        <span v-if="s.hasSession && !privateAlone && s.memberCount > 0" class="community-count">{{ hereText }}</span>
      </p>
    </header>

    <div class="community-notice" :class="{ 'is-empty': !shownFeedback && !s.canReconnect }">
      <p class="community-feedback" role="status">{{ shownFeedback }}</p>
      <button v-if="s.canReconnect" class="community-retry" type="button" @click="control()?.reconnect()">Reconnect</button>
    </div>

    <form v-if="!s.hasSession" class="community-name" @submit.prevent="saveName">
      <label for="community-nickname">Choose a device nickname</label>
      <div class="community-input-row">
        <input id="community-nickname" v-model="nickname" name="name" required minlength="3" maxlength="24" autocomplete="nickname" placeholder="Your name">
        <button :disabled="s.savingName">Join room</button>
      </div>
      <p>This nickname is saved on this device. It is not a verified identity.</p>
    </form>

    <p v-if="privateAlone" class="community-private-note">Only you are here. This room is private: when friends come in, you can talk here by voice and chat.</p>
    <div v-if="s.hasSession" class="community-content">
      <div class="community-side">
        <div class="community-presence">
          <h3 class="community-sr-only">{{ s.group ? 'Around you' : 'In this room' }}</h3>
          <p v-if="s.group && (s.group.total > s.group.here || s.group.groups > 1)" class="community-group-header" data-group-header>{{ s.group.header }}</p>
          <p v-if="s.groupNote" class="community-group-note" role="status" data-group-note>{{ s.groupNote }} <button type="button" class="community-link" @click="control()?.clearGroupNote()">OK</button></p>
          <p v-if="s.apart" class="community-group-apart" data-group-apart>
            {{ s.apart.name }} is in another part of the venue.
            <button type="button" data-group-join-friend :disabled="s.apart.waiting" @click="control()?.joinFriendGroup(s.apart.id)">{{ s.apart.waiting ? 'Waiting for room…' : `Join ${s.apart.name}'s group` }}</button>
          </p>
          <ul class="community-members" aria-label="Room members">
            <li v-for="member in s.members" :key="member.id" :class="[`is-${member.voice}`, { 'is-you': member.you }]">
              <component :is="member.you ? 'div' : 'button'" class="community-person" :type="member.you ? undefined : 'button'" :aria-label="member.you ? undefined : `${member.name}, open card`" @click="member.you || openPerson(member.id, member.name)">
                <span class="community-avatar" aria-hidden="true" :style="{ '--hue': hueOf(member.id) }">{{ initialOf(member.name) }}
                  <svg v-if="member.voice !== 'off'" class="community-mic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /><path v-if="member.voice === 'muted'" d="M4 4l16 16" /></svg>
                </span>
                <span class="community-name-line">{{ member.name }}</span>
                <small v-if="caption(member)">{{ caption(member) }}</small>
              </component>
            </li>
          </ul>
          <div v-if="alone" class="community-alone">
            <p>You are the first one here.</p>
            <button type="button" class="community-invite" @click="invite()">Invite a friend</button>
          </div>
          <div v-if="s.group && s.group.groups > 1" class="community-groups">
            <button v-if="!s.groupList" type="button" data-groups-open @click="control()?.listGroups()">See other groups</button>
            <template v-else>
              <ul class="community-group-list" aria-label="Groups in this place" data-group-list>
                <li v-for="group in s.groupList.groups" :key="group.id">
                  <span><b v-if="group.clan" class="community-clan" :style="{ borderColor: group.clan.hex }">{{ group.clan.name }}</b> Group {{ group.no }}{{ group.mine ? ' (yours)' : '' }} · {{ group.size }} {{ group.size === 1 ? 'person' : 'people' }}<template v-if="group.friends.length"> · {{ group.friends.join(', ') }}</template></span>
                  <button v-if="!group.mine" type="button" :disabled="!group.open" :data-group-join="group.id" @click="control()?.joinGroup(group.id)">{{ group.open ? 'Join' : 'Full' }}</button>
                </li>
              </ul>
              <p v-if="s.groupList.more" class="community-position-note">and {{ s.groupList.more }} more groups</p>
              <button type="button" @click="control()?.closeGroups()">Close</button>
            </template>
          </div>
        </div>

        <div v-if="!privateAlone" class="community-voice" :class="{ 'is-on': s.voice.on }">
          <div class="community-voice-top">
            <div class="community-voice-text">
              <h3>Voice</h3>
              <p class="community-voice-status" role="status">{{ voiceLine }}</p>
            </div>
            <button v-if="!s.voice.on" class="community-join-voice" type="button" :disabled="!s.voice.canJoin" @click="control()?.joinVoice()">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /></svg>{{ s.voice.joinLabel }}
            </button>
            <div v-else class="community-voice-buttons">
              <button class="community-mute" type="button" :aria-pressed="s.voice.muted" @click="control()?.toggleMute()">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /><path v-if="s.voice.muted" d="M4 4l16 16" /></svg>{{ s.voice.muteLabel }}
              </button>
              <button class="community-leave-voice" type="button" @click="control()?.leaveVoice()">Leave</button>
            </div>
          </div>
          <div v-if="s.voice.devices" class="community-device">
            <label for="community-microphone">Microphone</label>
            <select id="community-microphone" aria-label="Microphone device" :value="s.voice.selectedDevice" @change="chooseDevice">
              <option v-for="device in s.voice.devices" :key="device.id" :value="device.id">{{ device.label }}</option>
            </select>
          </div>
          <p v-if="s.voice.playbackNote" class="community-playback-note">{{ s.voice.playbackNote }}</p>
          <div class="community-audio">
            <pre v-if="s.diagnosticsText !== null" class="community-diagnostics" aria-label="Synthetic test connection diagnostics">{{ s.diagnosticsText }}</pre>
            <div v-for="peer in s.voice.blocked" :key="peer.id">
              <button type="button" data-community-play @click="control()?.playPeer(peer.id)">Play audio from {{ peer.name }}</button>
            </div>
          </div>
          <HowItWorks id="community-voice" label="How voice works" :rules="voiceRules" />
        </div>

        <div v-if="!s.privateHome && canWalk" class="community-proximity">
          <div class="community-movement" role="group" aria-label="Walk your character" @keydown="onPadKey">
            <button type="button" class="community-north" aria-label="Walk up" :disabled="s.walkDisabled" @click="walk('up')"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>
            <button type="button" class="community-west" aria-label="Walk left" :disabled="s.walkDisabled" @click="walk('left')"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7" /></svg></button>
            <button type="button" class="community-south" aria-label="Walk down" :disabled="s.walkDisabled" @click="walk('down')"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg></button>
            <button type="button" class="community-east" aria-label="Walk right" :disabled="s.walkDisabled" @click="walk('right')"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg></button>
          </div>
          <div class="community-move-text">
            <b>Move closer</b>
            <p>Walk closer to hear someone.</p>
            <p class="community-position" role="status">{{ s.positionText }}</p>
          </div>
        </div>
      </div>

      <template v-if="!privateAlone">
      <div class="community-chat">
        <h3>Room chat</h3>
        <div class="community-thread">
          <ol ref="messages" class="community-messages" aria-label="Room messages" aria-live="polite" aria-relevant="additions" @scroll.passive="onScroll">
            <li v-for="line in s.chat" :key="line.key" :class="{ 'is-npc': line.npc, 'is-mine': mine(line) }" :data-npc-line="line.npc ? '' : undefined">
              <div class="community-meta"><strong><NpcBadge v-if="line.npc" lead />{{ mine(line) ? 'You' : line.author }}</strong><time v-if="line.at">{{ clock(line.at) }}</time><small v-if="line.delivery && line.delivery !== 'Sent'">{{ line.delivery }}</small></div>
              <p><template v-for="(part, i) in lineParts(line.body)" :key="i"><button v-if="part.link" type="button" class="community-link" data-community-link @click="openLink(part.link, line)">{{ part.text }}</button><template v-else>{{ part.text }}</template></template></p>
              <ScamNotice v-if="line.scam && !mine(line)" @report="reportScam(line)" />
              <button v-if="line.canRetry" type="button" data-community-retry-message @click="control()?.retryMessage(line.key)">Retry message</button>
            </li>
          </ol>
          <p v-if="!s.chat.length" class="community-empty">No messages yet. Say hello.</p>
          <p v-if="scamNote" class="community-empty" role="status" data-scam-note>{{ scamNote }}</p>
          <button v-if="unseen" type="button" class="community-jump" @click="toBottom">New messages ↓</button>
        </div>
      </div>
      <form class="community-compose" @submit.prevent="send">
        <p v-if="refusalNow" class="community-refusal" role="alert">{{ s.refusal?.text }}</p>
        <label class="community-sr-only" for="community-message">Message this room</label>
        <div class="community-input-row">
          <textarea id="community-message" ref="composer" v-model="draft" rows="1" maxlength="500" autocomplete="off" enterkeyhint="send" placeholder="Say hello…" :disabled="s.composeDisabled" @keydown="onComposerKey" @input="grow" />
          <button type="submit" class="community-send" aria-label="Send" :disabled="s.composeDisabled || !draft.trim()"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
        </div>
      </form>
      </template>
    </div>

    <LinkInterstitial v-if="linkOpened" :link="leaving?.link ?? null" :author-id="leaving?.line.authorId" :author-name="leaving?.line.author ?? ''" @close="leaving = null" />
  </section>
</template>

<style scoped>
.community-clan { padding: 0 6px; margin-right: 4px; border-left: 4px solid; font-weight: 700; }
/* A game character's line: tinted, with a dashed rule down its left edge, besides the NPC badge before its name. A real player's line is plain. */
.community-messages li.is-npc { background: var(--c-fill, #eef1ef); border-left: 3px dashed var(--c-faint, #6b737c); }
/* A shared link: underlined like a link, but a button, so it can only open the "leaving Allworld" sheet. */
.community-link { all: unset; cursor: pointer; text-decoration: underline; color: var(--c-link, #0b5cad); overflow-wrap: anywhere; }
.community-link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
