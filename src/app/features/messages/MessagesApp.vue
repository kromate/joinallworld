<script setup lang="ts">
import { civicTitle } from '../../../game/cities/terminology.ts'
// Messages app: Chats and Updates.
//
// Chats: find a player and message them, the conversation list with unread counts, groups (create,
// rename, add and remove members, leave). Every message you send appears at once as "Sending…",
// then becomes sent, or "Not sent" with the reason and a Retry that can never duplicate it (the
// outbox in src/game/social-model.ts keeps one client id per message). Updates is the game's one
// notice surface: friend requests, knocks, gifts and report receipts together with what the life
// itself posts — rent, loan, promotions, illness, the Governor's news — newest first.
//
// The social state is the one the existing People, Contacts and Invite screens use
// (src/app/features/social/useSocial.ts): a message sent here shows there. All text is rendered as text;
// nothing a player typed is ever markup or a link.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { formatClock } from '../../../game/clock.ts'
import type { Conversation, Message, SearchResult } from '../../../types/social.ts'
import type { PlayerRef } from '../../../types/protocol.ts'
import { call, cityId as socialCityId, discard, newClientId, openThread, perform, reconnect as reconnectSocial, retry, send, social, start as startSocial, sync, threadView } from '../social/useSocial.ts'
import BaseButton from '../../ui/BaseButton.vue'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import ListRow from '../../ui/ListRow.vue'
import ListRows from '../../ui/ListRows.vue'
import RowMark from '../../ui/RowMark.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { linkWords } from '../../../ui/link.ts'
import GlyphText from '../kit/GlyphText.vue'
import LinkButton from '../growth/LinkButton.vue'
import { useGrowth } from '../growth/useGrowth.ts'
import PersonCallButton from '../calls/PersonCallButton.vue'
import PingButton from '../ping/PingButton.vue'
import PingStrip from '../ping/PingStrip.vue'
import { pingInstead } from '../ping/pingModel.ts'
import { personUi } from '../social/socialState.ts'
import FounderTag from '../social/FounderTag.vue'
import ResidentBadge from '../locate/ResidentBadge.vue'
import CompanionPin from '../companion/CompanionPin.vue'
import { noticeMarks, showConversation, takeDraft, ui } from './messagesState.ts'
import { unreadChats, updatesCount } from './messagesModel.ts'
import { isOutbox, lastLine, partnerOf, provisionalKey, readOnlyReason, targetOf, threadKind, threadTitle, updateLines } from './messagesThread.ts'
import { filterChats, sortChats, threadRows } from './messagesText.ts'
import Composer from './Composer.vue'
import MessageBubble from './MessageBubble.vue'
import FriendPicker from './FriendPicker.vue'
import GroupManage from './GroupManage.vue'
import ChatSettings from './ChatSettings.vue'
import Lightbox from './Lightbox.vue'
import { askedAboutNotifications, noteAskedAboutNotifications } from './notifyAsk.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell, api, menu } = useApp()
const growth = useGrowth()

/**
 * The social client is reactive (useSocial), and it also calls api.refresh() on every change,
 * which bumps this. What is read from it is still copied on each bump — the outbox, which
 * threadView() reads, is not reactive.
 */
const tick = shell.legacyTick
const me = computed(() => { void tick.value; return social.me ? { ...social.me } : null })
const view = game.view
const connected = game.connected
const notices = computed(() => view.value.social?.notices ?? [])
const time = (at: number): string => formatClock(at).split('· ')[1] ?? ''

// ---- what is open --------------------------------------------------------------------------
function setOpen(key: string | null): void {
  showConversation(key); social.openConv = key
  replying.value = null; fresh.value = 0; quoted.value = null
  if (key) void nextTick(() => composer.value?.focus())
}
// Opened from a person card, a contact or a notification: { to, name } | { conv } | { tab }.
watch(() => props.params, (params) => {
  const asked = (params ?? null) as { tab?: string; conv?: string; to?: string; name?: string } | null
  if (!asked) return
  if (asked.tab === 'updates' || asked.tab === 'chats') { setOpen(null); ui.tab = asked.tab }
  else if (asked.conv) { setOpen(asked.conv); void openThread(asked.conv) }
  else if (asked.to) {
    const existing = social.me?.conversations.find((conv) => conv.with === asked.to)
    setOpen(existing ? existing.id : provisionalKey(asked.to)); ui.openName = asked.name ?? null; ui.tab = 'chats'
    if (existing) void openThread(existing.id)
  }
}, { immediate: true })
// A new chat received its real conversation id.
watch(tick, () => { if (social.openConv !== ui.open && social.openConv) ui.open = social.openConv })

const gate = computed<{ text: string; warn: boolean; retry: boolean; link: boolean } | null>(() => {
  void tick.value
  // Held for the quick start: the look is not confirmed yet. (A guest who has tapped Play is in the city like anyone else.)
  if (view.value.onboarding?.required) return { text: 'Choose your look and tap Play first. People and messages open as soon as you are in the city.', warn: false, retry: false, link: false }
  if (!connected.value) return { text: `${linkWords(view.value)?.why ?? 'Not connected.'} People and messages are read-only until that is resolved.`, warn: true, retry: false, link: true }
  if (social.error && !social.me) return { text: `Could not load: ${social.error}`, warn: true, retry: true, link: false }
  if (!social.me) return { text: 'Loading…', warn: false, retry: false, link: false }
  return null
})
/** The one tap that resolves a lost connection ("Try again", "Start a new life"). */
const linkAction = computed(() => linkWords(view.value)?.action ?? null)
function runLinkAction(): void {
  const next = linkAction.value
  if (!next) return
  if (next.menu) menu(next.menu)
  else if (next.gate) { const target = shell.sessionGate(next.gate); if (target) shell.open(target.id, { reason: next.gate }) }
}
const socket = computed(() => { void tick.value; return social.socket })

// ---- the thread ----------------------------------------------------------------------------
const conv = computed<Conversation | null>(() => (ui.open ? me.value?.conversations.find((item) => item.id === ui.open) ?? null : null))
const thread = computed(() => { void tick.value; const now = ui.open ? social.threads.get(ui.open) : undefined; return now ? { loaded: now.loaded, error: now.error } : null })
const items = computed(() => { void tick.value; return ui.open ? threadView(ui.open) : [] })
const title = computed(() => (ui.open ? threadTitle(ui.open, conv.value, ui.openName) : ''))
/** The other player of the direct chat on screen, also before its first message (messagesThread.ts partnerOf). */
const partner = computed(() => partnerOf(ui.open, conv.value))
/** A direct chat with the founder: the server marked that member. */
const withFounder = computed(() => conv.value?.kind === 'dm' && conv.value.members.some((member) => member.id === conv.value?.with && member.founder === true))
const readOnly = computed(() => (ui.open && me.value ? readOnlyReason(ui.open, me.value, connected.value ? null : linkWords(view.value)?.cannot('send messages') ?? 'Not connected.') : null))
const isGroup = computed(() => Boolean(conv.value) && conv.value?.kind !== 'dm')
const threadBox = ref<HTMLElement | null>(null)
const composer = ref<InstanceType<typeof Composer> | null>(null)
/** The message being answered, until it is sent or cancelled. */
const replying = ref<Message | null>(null)
const rows = computed(() => threadRows(items.value, Date.now()))
/** Scrolled up to read earlier lines: new ones count on the jump button instead of pulling the view down. */
const atBottom = ref(true)
const fresh = ref(0)
const quoted = ref<{ from: string; text: string } | null>(null)
const nearBottom = (box: HTMLElement): boolean => box.scrollHeight - box.scrollTop - box.clientHeight < 80
function onScroll(): void { const box = threadBox.value; if (!box) return; atBottom.value = nearBottom(box); if (atBottom.value) fresh.value = 0 }
function toLatest(): void { const box = threadBox.value; if (box) box.scrollTo({ top: box.scrollHeight }); fresh.value = 0; atBottom.value = true }
// A new line, or a line changing from sending to sent: keep the newest in view, unless the player scrolled up to read.
watch(() => items.value.length, (now, was) => {
  const last = items.value.at(-1)
  const mineLast = Boolean(last && (isOutbox(last) || last.from?.id === me.value?.me.id))
  if (atBottom.value || mineLast) void nextTick(toLatest)
  else if (now > was) fresh.value += now - was
}, { flush: 'post' })
watch(() => ui.open, () => { atBottom.value = true; void nextTick(toLatest) })
watch(thread, () => { if (atBottom.value) void nextTick(toLatest) })
function jump(seq: number): void {
  const box = threadBox.value, target = box?.querySelector<HTMLElement>(`[data-seq="${seq}"]`)
  if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('is-flash'); setTimeout(() => target.classList.remove('is-flash'), 1400); quoted.value = null; return }
  // No longer in the kept window: show what the quote froze.
  const original = items.value.find((item): item is Message => !isOutbox(item) && item.replyTo?.seq === seq)
  quoted.value = original?.replyTo ? { from: original.replyTo.from?.name ?? 'Message', text: original.replyTo.text || 'Picture' } : null
}
async function react(item: Message, emoji: string | null): Promise<void> {
  const key = ui.open
  if (!key) return
  const result = await call<{ message: Message }>(`/api/social/conversations/${encodeURIComponent(key)}/react`, { seq: item.seq, emoji })
  if (!result.ok) { game.toast(result.reason, 'error'); return }
  const record = social.threads.get(key)
  if (record) record.messages = record.messages.map((line) => (line.seq === item.seq ? result.message : line))
  shell.bump()
}
const openCard = (id: string): void => { shell.open('person', { player: id }) }

function openConversation(key: string): void { setOpen(key); void openThread(key) }
const rootBox = ref<HTMLElement | null>(null)
/** Back to the list. The keyboard goes to the conversation that was open, so it is never left on nothing. */
function back(): void {
  const was = ui.open
  setOpen(null); void sync()
  void nextTick(() => { const list = rootBox.value; (Array.from(list?.querySelectorAll<HTMLElement>('[data-conv]') ?? []).find((row) => row.dataset.conv === was) ?? list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus() })
}
function reloadThread(): void { const current = ui.open ? social.threads.get(ui.open) : undefined; if (current && ui.open) { current.error = null; void openThread(ui.open) } }
function sendFromComposer(body: string, extra: { mentions?: { id: string; start: number }[]; replyTo?: number }): void {
  const key = ui.open
  if (!key || readOnly.value) return
  // Shows at once as "Sending…"; the outbox turns it into sent, or failed with a Retry.
  send(key, targetOf(key), body, extra)
  replying.value = null
  ui.prefill = ''
}

// ---- finding a player, groups --------------------------------------------------------------
const find = reactive<{ text: string; busy: boolean; results: SearchResult[] | null; error: string | null }>({ text: '', busy: false, results: null, error: null })
async function search(): Promise<void> {
  const text = find.text.trim()
  if (text.length < 2) { find.results = null; find.error = 'Type at least two letters of their name.'; return }
  find.busy = true; find.error = null
  const result = await call<{ results: SearchResult[] }>(`/api/social/search?q=${encodeURIComponent(text)}`)
  find.busy = false
  if (result.ok) find.results = result.results; else { find.results = null; find.error = result.reason }
}
function messagePlayer(player: SearchResult): void {
  const existing = me.value?.conversations.find((item) => item.with === player.id)
  setOpen(existing ? existing.id : provisionalKey(player.id)); ui.openName = player.name
  find.results = null; find.text = ''
  if (existing) void openThread(existing.id)
}
const group = reactive<{ open: boolean; name: string; members: PlayerRef[]; clientId: string; busy: boolean }>({ open: false, name: '', members: [], clientId: '', busy: false })
/** Whether a friend is in the game now: known for friends only (nothing is said about anyone else). */
const presenceOf = (id: string | null | undefined): 'online' | 'offline' | null => {
  const friend = id ? me.value?.friends.find((item) => item.id === id) : undefined
  return friend ? (friend.status === 'online' || friend.status === 'away' ? 'online' : 'offline') : null
}
/** A friend who is not in the game: Ping stands where Call does. Nobody else is ever offered it here. */
const pingFor = (id: string | null | undefined): boolean => pingInstead(id ? me.value?.friends.find((item) => item.id === id)?.status : null)
const presenceWord = (id: string | null | undefined): string | null => { const state = presenceOf(id); return state === 'online' ? 'Online now' : state === 'offline' ? 'Offline' : null }
/** Send money from a chat: the player's card opens with its gift form already showing (the card owns the limits and the one-send client id). */
async function sendMoneyTo(player: string, name: string): Promise<void> {
  shell.open('person', { player, name })
  // The card clears its forms when it first shows a player, so the form is opened once the card has taken this player.
  for (let tries = 0; tries < 40 && personUi.player !== player; tries += 1) await new Promise((done) => setTimeout(done, 50))
  if (personUi.player === player) { personUi.form = 'money'; personUi.clientId = newClientId() }
}
function newGroup(): void { Object.assign(group, { open: true, name: '', members: [], clientId: newClientId() }) }
async function createGroup(): Promise<void> {
  if (group.busy) return
  group.busy = true
  // One client id per group form, reused on a retry, so a retry cannot create it twice.
  const result = await perform<{ conv: Conversation }>('/api/social/groups', { name: group.name, members: group.members.map((person) => person.id), clientId: group.clientId }, 'Group created')
  group.busy = false
  if (result.ok) { group.open = false; openConversation(result.conv.id) }
}
function groupLeft(): void { const key = ui.open; if (key) social.threads.delete(key); setOpen(null) }
/** Remove a chat from my list only: the other person keeps theirs, and it comes back with a new message. */
async function hideChat(): Promise<void> {
  const key = ui.open
  if (!key) return
  const result = await perform(`/api/social/conversations/${encodeURIComponent(key)}/prefs`, { hide: true })
  if (result.ok) groupLeft()
}
async function pinChat(on: boolean): Promise<void> { const key = ui.open; if (key) await perform(`/api/social/conversations/${encodeURIComponent(key)}/prefs`, { pin: on }) }
const chatFilter = ref('')
const chatList = computed(() => sortChats(filterChats(me.value?.conversations ?? [], chatFilter.value)))
const showSettings = ref(false)
const lightbox = ref<Message | null>(null)
/** The picture button shows where pictures are switched on and the chat takes them: a direct chat with a friend, or a group. */
const pictureAllowed = computed(() => Boolean(me.value?.limits.pictures.on && ui.open && !ui.open.startsWith('h.') && (conv.value?.kind === 'group' || Boolean(partner.value && me.value?.friends.some((friend) => friend.id === partner.value))) && !readOnly.value))
async function pictureSent(result: { conv: Conversation }): Promise<void> {
  const real = result.conv.id
  if (ui.open !== real) setOpen(real)
  await openThread(real)
}
async function reportPicture(): Promise<void> {
  const line = lightbox.value, key = ui.open
  if (!line?.image || !key) return
  lightbox.value = null
  await perform('/api/social/reports', { conv: key, image: line.image.id, reason: 'other' }, 'Report received. The picture is hidden for you.')
  void openThread(key)
}
/** After the player's own message in a chat, once: "Get a notification when Joy replies?" (never on arrival; the browser's own question comes only after Yes). */
const askNotify = computed(() => Boolean(ui.open && conv.value && items.value.some((item) => isOutbox(item) || (!isOutbox(item) && item.from?.id === me.value?.me.id)) && !askedAboutNotifications() && growth.state.hello?.consent?.push !== true && growth.state.hello?.consent?.age !== 'minor'))
const askedNow = ref(0)
function answerNotify(yes: boolean): void { noteAskedAboutNotifications(); askedNow.value += 1; if (yes) shell.open('touch') }

// ---- updates -------------------------------------------------------------------------------
const chats = computed(() => unreadChats(me.value))
const updates = computed(() => { void tick.value; return me.value ? updatesCount(me.value, noticeMarks.fresh(view.value.cityId, notices.value)) : 0 })
/** The mark from before the tab was opened: what was new stays marked "New" while it is read. */
const seenBefore = ref<number | null>(null)
const lines = computed(() => updateLines(me.value?.updates ?? [], notices.value, seenBefore.value ?? noticeMarks.seen(view.value.cityId)))
function readUpdates(): void {
  if (ui.tab !== 'updates' || ui.open || !me.value) { seenBefore.value = null; return }
  seenBefore.value ??= noticeMarks.seen(view.value.cityId)
  if (noticeMarks.mark(view.value.cityId, notices.value)) shell.bump()
}
function showTab(tab: 'chats' | 'updates'): void {
  ui.tab = tab
  if (tab === 'updates' && (me.value?.updates ?? []).some((update) => !update.read)) void call('/api/social/updates/read', {}).then(sync)
}
watch([() => ui.tab, () => ui.open, me, notices], readUpdates, { immediate: true })
/** The notice that put the player in a group offers one tap to leave it. */
async function leaveFromUpdate(key: string): Promise<void> { await perform(`/api/social/groups/${encodeURIComponent(key)}`, { op: 'leave' }, 'You left the group.'); social.threads.delete(key) }
const answerFriend = (from: string, accept: boolean): Promise<unknown> => perform('/api/social/friends/answer', { from, accept, cityId: socialCityId() }, accept ? 'You are now friends' : null)
const answerBae = (from: string, accept: boolean): Promise<unknown> => perform('/api/social/bae/answer', { from, accept, cityId: socialCityId() })

onMounted(() => {
  void growth.load() // the footer's WhatsApp link comes with the growth hello (asked for at most every five minutes)
  startSocial(api)
  // The thread that was on screen when the app was closed is on screen again: say so, and catch up.
  if (ui.open) { social.openConv = ui.open; if (!ui.open.startsWith('to:')) void openThread(ui.open) }
})
// Off screen, no conversation is "open": a message that arrives then is unread, with its toast and its badge.
onBeforeUnmount(() => { social.openConv = null })

defineExpose({
  /** Esc inside a conversation goes back to the list first; the next Esc leaves the app. */
  keys(action: string): boolean {
    if (action !== 'cancel' || !ui.open) return false
    back()
    return true
  },
})
</script>

<template>
  <div ref="rootBox" class="messages" :class="{ 'panel-fill': Boolean(ui.open) && !gate }">
    <div v-if="gate" class="messages-note" :class="{ 'is-warn': gate.warn }" role="status">
      {{ gate.text }} <button v-if="gate.link && linkAction" class="messages-link" type="button" @click="runLinkAction">{{ linkAction.label }}</button><button v-if="gate.retry" class="messages-link" type="button" @click="social.error = null; sync()">Retry</button>
    </div>
    <template v-else-if="me">
      <div v-if="socket !== 'open'" class="messages-note" :class="{ 'is-warn': socket === 'offline', 'is-inset': ui.open }" role="status">
        <template v-if="socket === 'offline'">Live updates are off. <button class="messages-link" type="button" @click="reconnectSocial()">Reconnect</button></template>
        <template v-else>Connecting live updates… new messages still load when you open a chat.</template>
      </div>

      <!-- A conversation -->
      <div v-if="ui.open" class="messages-chat">
        <header class="messages-head">
          <button class="messages-back" type="button" aria-label="Back to chats" @click="back"><GameIcon name="back" :size="22" /></button>
          <RowMark v-if="conv?.kind === 'group'" :name="title" :seed="conv.id" />
          <RowMark v-else-if="ui.open.startsWith('h.')" round>🏠</RowMark>
          <RowMark v-else :name="title" :seed="conv?.with ?? ui.open" />
          <h3 v-if="withFounder"><button type="button" class="messages-name" :aria-label="`${title}: open profile`" @click="conv?.with && shell.open('person', { player: conv.with, name: title })">{{ title }}</button><FounderTag /><ResidentBadge v-if="conv?.kind === 'dm' && conv.with" :id="conv.with" /><small :class="presenceOf(conv?.with) ? `messages-presence is-${presenceOf(conv?.with)}` : undefined">{{ (conv?.kind === 'dm' && presenceWord(conv.with)) || threadKind(conv) }}</small></h3>
          <h3 v-else><button v-if="partner" type="button" class="messages-name" :aria-label="`${title}: open profile`" @click="shell.open('person', { player: partner, name: title })">{{ title }}</button><template v-else>{{ title }}</template><small :class="partner && presenceOf(partner) ? `messages-presence is-${presenceOf(partner)}` : undefined">{{ (partner && presenceWord(partner)) || threadKind(conv) }}</small></h3>
          <BaseButton v-if="conv?.kind === 'group'" small :aria-expanded="ui.manage" @click="ui.manage = !ui.manage">{{ ui.manage ? 'Done' : 'Group' }}</BaseButton>
          <template v-else-if="partner">
            <BaseButton small data-chat="send-money" @click="sendMoneyTo(partner, title)">Send money</BaseButton>
            <!-- A friend who is not in the game cannot be rung: Ping takes Call's place, so the header never holds a fourth control. -->
            <PingButton v-if="pingFor(partner)" compact :id="partner" :name="title" />
            <PersonCallButton v-else compact :id="partner" :name="title" :status="presenceOf(partner) ?? undefined" />
            <button v-if="conv" type="button" class="messages-kebab" aria-label="Chat options" :aria-expanded="ui.manage" @click="ui.manage = !ui.manage">⋯</button>
          </template>
        </header>
        <PingStrip v-if="partner && pingFor(partner)" inset :id="partner" :name="title" />
        <div v-if="conv?.kind === 'house'" class="messages-note is-inset">House chat: only the host and the guests inside can read this.</div>

        <GroupManage v-if="conv?.kind === 'group' && ui.manage" :conv="conv" :me="me" @left="groupLeft" @player="openCard" />
        <section v-else-if="conv?.kind === 'dm' && ui.manage" class="messages-manage" aria-label="Chat options">
          <label class="messages-switch"><input type="checkbox" :checked="conv.pinned === true" @change="pinChat(($event.target as HTMLInputElement).checked)"> Pin to the top of my chats</label>
          <BaseButton small variant="danger" @click="hideChat">Delete this chat for me</BaseButton>
          <div class="messages-note">The other person keeps their copy. The chat comes back if either of you writes again.</div>
        </section>

        <div class="messages-body">
          <div ref="threadBox" class="messages-thread" aria-live="polite" @scroll.passive="onScroll">
            <template v-if="conv && !thread?.loaded">
              <div v-if="thread?.error" class="messages-note is-warn">{{ thread.error }} <button class="messages-link" type="button" @click="reloadThread">Retry</button></div>
              <div v-else class="messages-note">Loading messages…</div>
            </template>
            <div v-else-if="!items.length" class="messages-note">{{ isGroup ? 'No messages yet. Say hello to the group.' : 'No messages yet. Say something.' }}</div>
            <template v-for="row in rows" v-else :key="row.key">
              <div v-if="row.kind === 'day'" class="messages-day" role="separator"><span>{{ row.label }}</span></div>
              <div v-else-if="isOutbox(row.item)" class="bubble is-mine" :class="row.item.status === 'failed' ? 'is-failed' : 'is-pending'">
                <span>{{ row.item.body }}</span>
                <small>{{ row.item.status === 'failed' ? `Not sent · ${row.item.reason}` : 'Sending…' }}</small>
                <span v-if="row.item.status === 'failed'" class="bubble-actions">
                  <BaseButton small variant="primary" @click="retry(row.item.clientId)">Retry</BaseButton>
                  <BaseButton small @click="discard(row.item.clientId)">Delete</BaseButton>
                </span>
              </div>
              <div v-else-if="row.item.sys" class="bubble is-sys">{{ row.item.body }}</div>
              <MessageBubble v-else :item="row.item" :me-id="me.me.id" :group="isGroup" :head="row.head" :tail="row.tail" :time="time(row.item.at)" :can-react="conv?.kind !== 'house'" @reply="(line) => { replying = line; composer?.focus() }" @react="react" @player="openCard" @jump="jump" @picture="(line) => { lightbox = line }" />
            </template>
          </div>
          <button v-if="fresh > 0 || !atBottom" type="button" class="messages-latest" :aria-label="fresh ? `Jump to latest, ${fresh} new` : 'Jump to latest'" @click="toLatest">↓<span v-if="fresh" class="messages-badge">{{ fresh }}</span></button>
        </div>
        <div v-if="quoted" class="messages-quoted" role="status"><b>{{ quoted.from }}</b> {{ quoted.text }}<small> — the original is no longer kept</small> <button type="button" class="messages-link" @click="quoted = null">Close</button></div>

        <div v-if="askNotify && askedNow >= 0" class="messages-ask-notify" role="group" aria-label="Notifications">
          <span>Get a notification when {{ conv?.kind === 'dm' ? title : 'someone answers here' }} replies?</span>
          <BaseButton small variant="primary" @click="answerNotify(true)">Yes</BaseButton><BaseButton small @click="answerNotify(false)">Not now</BaseButton>
        </div>
        <footer class="messages-foot">
          <span v-if="readOnly" class="messages-why">{{ readOnly }}</span>
          <Composer ref="composer" :pictures="pictureAllowed" :target="targetOf(ui.open)" :new-id="newClientId" :conv="ui.open" :members="isGroup && conv?.kind === 'group' ? conv.members : []" :me-id="me.me.id" :admin="conv?.owner === me.me.id" :max="me.limits.body" :disabled="Boolean(readOnly)" :reply="replying" :prefill="ui.prefill" @send="sendFromComposer" @cancel-reply="replying = null" @sent-picture="pictureSent" />
        </footer>
      </div>

      <!-- The lists -->
      <template v-else>
        <div class="messages-tabs" role="tablist">
          <button role="tab" type="button" :aria-selected="ui.tab === 'chats'" @click="showTab('chats')">Chats<span v-if="chats" class="messages-badge">{{ chats }}</span></button>
          <button role="tab" type="button" :aria-selected="ui.tab === 'updates'" @click="showTab('updates')">Updates<span v-if="updates" class="messages-badge">{{ updates }}</span></button>
        </div>

        <div v-if="ui.tab === 'chats'" role="tabpanel">
          <CompanionPin />
          <form class="messages-form is-search" role="search" @submit.prevent="search">
            <input v-model="find.text" name="q" maxlength="36" placeholder="Find a player by name" aria-label="Find a player by name" autocomplete="off">
            <BaseButton small type="submit" :disabled="find.busy">Find</BaseButton>
          </form>
          <div v-if="find.busy" class="messages-note" role="status">Searching…</div>
          <div v-else-if="find.error" class="messages-note is-warn" role="alert">{{ find.error }}</div>
          <ListRows v-else-if="find.results?.length" label="Players found">
            <ListRow v-for="player in find.results" :key="player.id" :title="player.name" :sub="`Real player${player.friend ? ' · Friend' : ''} · #${player.id.slice(0, 6)}`">
              <template #icon><RowMark :name="player.name" :seed="player.id" /></template>
              <template #end><BaseButton small variant="primary" @click="messagePlayer(player)">Message</BaseButton></template>
            </ListRow>
          </ListRows>
          <div v-else-if="find.results" class="messages-note" role="status">Nobody found with that name. Players appear here once they have opened the game.</div>

          <SectionTitle>Chats<template #end><BaseButton v-if="!group.open" small @click="newGroup">New group</BaseButton></template></SectionTitle>
          <form v-if="group.open" class="messages-manage" @submit.prevent="createGroup">
            <input v-model="group.name" class="messages-field" name="name" :maxlength="me.limits.groupName" placeholder="Group name" aria-label="Group name" required>
            <FriendPicker v-model:selected="group.members" :exclude="[]" :max="me.limits.groupSize - 1" />
            <div class="messages-note">{{ me.limits.groupSize }} people at most, including you. Only friends can be added, and you will be the admin.</div>
            <span class="bubble-actions is-start">
              <BaseButton small variant="primary" type="submit" :disabled="group.busy || !group.name.trim()" :reason="group.name.trim() ? null : 'Give the group a name.'">{{ group.busy ? 'Creating…' : 'Create group' }}</BaseButton>
              <BaseButton small @click="group.open = false">Cancel</BaseButton>
            </span>
          </form>

          <input v-if="me.conversations.length > 4" v-model="chatFilter" class="messages-filter" type="search" name="chatfilter" placeholder="Search your chats" aria-label="Search your chats" autocomplete="off">
          <ListRows v-if="chatList.length" label="Chats">
            <ListRow v-for="item in chatList" :key="item.id" as="button" :data-conv="item.id" :title="`${item.pinned ? '📌 ' : ''}${item.name}${item.muted ? ' 🔕' : ''}`" :sub="lastLine(item, me.me.id)" :unread="item.unread > 0" @click="openConversation(item.id)">
              <template #icon>
                <RowMark v-if="item.kind === 'group'" :name="item.name" :seed="item.id" />
                <RowMark v-else-if="item.kind === 'house'" round>🏠</RowMark>
                <RowMark v-else :name="item.name" :seed="item.with ?? item.id" />
              </template>
              <template #end>
                <span class="messages-when"><small v-if="item.kind === 'dm' && presenceOf(item.with)" class="messages-presence" :class="`is-${presenceOf(item.with)}`">{{ presenceOf(item.with) === 'online' ? 'Online' : 'Offline' }}</small><small v-if="item.last?.at">{{ time(item.last.at) }}</small><span v-if="item.mentions" class="messages-at" aria-label="You were mentioned">@</span><span v-if="item.unread" class="messages-badge" :class="{ 'is-quiet': item.muted }" :aria-label="`${item.unread} unread`">{{ item.unread }}</span></span>
              </template>
            </ListRow>
          </ListRows>
          <p v-else-if="me.conversations.length" class="messages-note" role="status">No chat has that name.</p>
          <EmptyState v-else icon="messages" title="No chats yet" text="Find a player by name above, or tap someone at a venue and press Chat. You can also make a group with your friends.">
            <BaseButton @click="shell.open('people')">See who is here</BaseButton>
          </EmptyState>
          <BaseButton small class="messages-settings-toggle" :aria-expanded="showSettings" @click="showSettings = !showSettings">{{ showSettings ? 'Hide chat settings' : 'Chat settings' }}</BaseButton>
          <ChatSettings v-if="showSettings" :prefs="me.prefs" />
        </div>

        <div v-else role="tabpanel">
          <template v-if="me.requests.in.length || me.baeRequests.length || me.house.knocks.length">
            <SectionTitle>Waiting for you</SectionTitle>
            <ListRows>
              <div v-for="request in me.requests.in" :key="`f${request.id}`" class="messages-ask">
                <ListRow :title="request.name" sub="wants to be friends"><template #icon><RowMark :name="request.name" :seed="request.id" /></template></ListRow>
                <span class="bubble-actions"><BaseButton small variant="primary" @click="answerFriend(request.id, true)">Accept</BaseButton><BaseButton small @click="answerFriend(request.id, false)">Decline</BaseButton></span>
              </div>
              <div v-for="request in me.baeRequests" :key="`b${request.id}`" class="messages-ask">
                <ListRow :title="request.name" sub="asked you to be their Bae"><template #icon><RowMark round><GameIcon name="heart" /></RowMark></template></ListRow>
                <span class="bubble-actions"><BaseButton small variant="primary" @click="answerBae(request.id, true)">Yes</BaseButton><BaseButton small @click="answerBae(request.id, false)">Not now</BaseButton></span>
              </div>
              <div v-if="me.house.knocks.length" class="messages-ask">
                <ListRow :title="me.house.knocks.map((knock) => knock.from.name).join(', ')" sub="knocking at your door"><template #icon><RowMark round><GameIcon name="invite" /></RowMark></template></ListRow>
                <span class="bubble-actions"><BaseButton small variant="primary" @click="shell.open('invite')">Answer</BaseButton></span>
              </div>
            </ListRows>
            <SectionTitle v-if="lines.length">Earlier</SectionTitle>
          </template>
          <ListRows v-if="lines.length" label="Updates">
            <div v-for="line in lines" :key="line.key" class="messages-update" :class="{ 'is-unread': line.fresh }">
              <RowMark round><GameIcon :kind="line.kind" :id="line.id" /></RowMark>
              <span class="messages-update-body"><b><GlyphText :text="line.text" /></b><small>{{ formatClock(line.at) }}{{ line.fresh ? ' · New' : '' }}</small></span>
              <BaseButton v-if="line.player" small @click="shell.open('person', { player: line.player })">Say hello</BaseButton>
              <span v-if="line.conv" class="bubble-actions"><BaseButton small @click="openConversation(line.conv); ui.tab = 'chats'">Open</BaseButton><BaseButton v-if="line.leave" small variant="danger" @click="leaveFromUpdate(line.conv)">Leave</BaseButton></span>
            </div>
          </ListRows>
          <EmptyState v-else-if="!(me.requests.in.length || me.baeRequests.length || me.house.knocks.length)" icon="bell" title="Nothing yet" :text="`Friend requests, knocks at your door, gifts, rent and loan notices, promotions, illness and news from the ${civicTitle(view.cityId)} appear here.`" />
        </div>
        <LinkButton v-if="growth.channel.value" :href="growth.channel.value" block class="messages-channel">Follow Allworld on WhatsApp</LinkButton>
      </template>
    </template>
    <Lightbox v-if="lightbox?.image" :id="lightbox.image.id" :caption="lightbox.body" :from="lightbox.from?.name ?? ''" :mine="lightbox.from?.id === me?.me.id" @close="lightbox = null" @report="reportPicture" />
  </div>
</template>

<style scoped>
.messages-name { display: block; max-width: 100%; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.messages-presence { font-weight: 700; color: var(--c-muted); }
.messages-presence::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: currentColor; vertical-align: 1px; }
.messages-presence.is-online { color: var(--c-green-dark); }
.messages-note { margin: 6px 2px; font-size: 12px; line-height: 1.45; color: var(--c-muted); }
.messages-note.is-warn { color: var(--c-red); }
.messages-note.is-inset { margin: 6px 14px; }
.messages-link { min-height: 32px; padding: 0 4px; border: 0; background: none; color: var(--c-green-dark); font: 600 12px var(--font); text-decoration: underline; cursor: pointer; }
.messages-why { display: block; margin-top: 2px; font-size: 12px; line-height: 1.4; color: var(--c-red); }
.messages-badge { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--c-badge); color: #fff; font-size: 11px; font-weight: 700; line-height: 1; }
.messages-tabs { display: flex; gap: 2px; margin: 0 0 var(--s-3); padding: 3px; border-radius: var(--r-sm); background: var(--c-fill-2); }
.messages-tabs button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--tap); padding: 0 10px; border: 0; border-radius: 9px; background: none; font: 600 13px var(--font); color: var(--c-ink-2); cursor: pointer; white-space: nowrap; }
.messages-tabs button[aria-selected='true'] { background: #fff; color: var(--c-ink); box-shadow: var(--e-1); }
.messages-tabs button:focus-visible, .messages-back:focus-visible, .messages-link:focus-visible, .messages-compose button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.messages-form { display: flex; gap: 6px; margin: 8px 0; }
.messages-form input, .messages-field { flex: 1; min-width: 0; min-height: var(--tap); box-sizing: border-box; padding: 10px 14px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); background: #fff; font: inherit; font-size: 14px; }
.messages-form.is-search { margin: 0 0 var(--s-2); }
.messages-form.is-search input { border-radius: var(--r-pill); border-color: transparent; background: #fff; box-shadow: var(--ring); }
.messages-field { width: 100%; margin: 4px 0; }
.messages-manage { display: grid; gap: 6px; margin: 0 0 var(--s-2); padding: var(--s-3) var(--s-4); border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; font-size: 13px; }
.messages-chat .messages-manage { margin: 8px 12px; }
.messages-manage ul { display: flex; flex-wrap: wrap; gap: 2px 12px; margin: 0; padding: 0; list-style: none; }
.messages-add { display: flex; flex-wrap: wrap; gap: 6px; }
.messages-checks { display: grid; gap: 2px; max-height: 150px; overflow-y: auto; margin: 6px 0; }
.messages-checks label { display: flex; align-items: center; gap: 8px; min-height: 36px; font-weight: 500; }
.messages-channel { margin-top: var(--s-3); }
.messages-when { display: grid; justify-items: end; gap: 3px; }
.messages-when small { font-size: 11px; font-weight: 500; color: var(--c-muted); }
.messages-ask { border-bottom: 1px solid var(--c-line); padding-bottom: 10px; }
.messages-ask:last-child { border-bottom: 0; }
.messages-ask > .bubble-actions { padding: 0 14px 0 64px; justify-content: stretch; }
.messages-ask > .bubble-actions > * { flex: 1; }
.messages-update { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; min-height: 56px; padding: 9px 14px; border-bottom: 1px solid var(--c-line); }
.messages-update:last-child { border-bottom: 0; }
.messages-update.is-unread { background: #f3faf5; }
.messages-update-body { flex: 1; min-width: 0; display: grid; gap: 1px; }
.messages-update-body > b { font-size: 14px; font-weight: 500; line-height: 1.3; }
.messages-update.is-unread .messages-update-body > b { font-weight: 700; }
.messages-update-body > small { font-size: 12px; line-height: 1.35; color: var(--c-muted); }

.messages-chat { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.messages-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 6px; background: #fff; border-bottom: 1px solid var(--c-line); }
/* !important because the sheet's own heading rule outranks a scoped class until that sheet is converted. */
.messages-head h3 { flex: 1; min-width: 0; margin: 0 !important; font-size: 15px !important; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.messages-head h3 small { display: block; font-size: 11px; font-weight: 500; color: var(--c-muted); }
.messages-back { flex: none; display: grid; place-items: center; width: var(--tap); height: var(--tap); border: 0; border-radius: 50%; background: none; color: var(--c-ink); cursor: pointer; }
.messages-thread { flex: 1; display: flex; flex-direction: column; gap: 6px; min-height: 120px; overflow-y: auto; padding: 12px; overscroll-behavior: contain; }
.bubble { align-self: flex-start; max-width: 80%; padding: 8px 12px 6px; border-radius: 18px 18px 18px 5px; background: #fff; box-shadow: var(--ring); font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; white-space: pre-wrap; }
.bubble > b { display: block; font-size: 11px; color: var(--app-tint, var(--c-green-dark)); }
.bubble small { display: block; margin-top: 2px; font-size: 10px; color: var(--c-muted); text-align: right; }
.bubble.is-mine { align-self: flex-end; border-radius: 18px 18px 5px 18px; background: var(--app-tint, var(--c-green-dark)); color: #fff; box-shadow: none; }
.bubble.is-mine small { color: #ffffffcc; }
.bubble.is-pending { opacity: .6; }
.bubble.is-failed { background: var(--c-red-soft); color: var(--c-ink); box-shadow: inset 0 0 0 1.5px #e3a995; }
.bubble.is-failed small { color: var(--c-red-dark); font-weight: 700; font-size: 11px; }
.bubble.is-sys { align-self: center; padding: 2px; background: none; box-shadow: none; color: var(--c-muted); font-size: 11px; }
.bubble-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin-top: 6px; }
.bubble-actions.is-start { justify-content: flex-start; }
.messages-foot { flex: none; padding: 8px 10px 22px; background: #fff; border-top: 1px solid var(--c-line); }
.messages-compose { display: flex; gap: 8px; margin: 0; }
.messages-compose input { flex: 1; min-width: 0; min-height: var(--tap); padding: 10px 16px; border: 1px solid transparent; border-radius: var(--r-pill); background: var(--c-fill); font: 400 15px var(--font); }
.messages-compose button { flex: none; display: grid; place-items: center; width: var(--tap); height: var(--tap); border: 0; border-radius: 50%; background: var(--app-tint, var(--c-green-dark)); color: #fff; cursor: pointer; }
.messages-compose button:disabled { opacity: .45; cursor: not-allowed; }
@media (max-width: 540px) { .bubble { max-width: 86%; } }
.messages-body { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; }
.messages-body .messages-thread { flex: 1; }
.messages-day { align-self: center; margin: 6px 0 2px; }
.messages-day span { padding: 3px 12px; border-radius: 12px; background: var(--c-fill-2); color: var(--c-muted); font-size: 11px; font-weight: 600; }
.messages-latest { position: absolute; right: 14px; bottom: 12px; display: inline-flex; align-items: center; gap: 6px; min-width: var(--tap); min-height: 40px; padding: 0 12px; border: 0; border-radius: 20px; background: #fff; box-shadow: var(--e-1), var(--ring); font: 700 16px var(--font); cursor: pointer; }
.messages-quoted { margin: 0 12px 4px; padding: 6px 10px; border-left: 3px solid var(--c-line); border-radius: 6px; background: var(--c-fill); font-size: 12px; overflow-wrap: anywhere; }
.messages-filter { box-sizing: border-box; width: 100%; min-height: 40px; margin: 0 0 var(--s-2); padding: 6px 14px; border: 1px solid #cfd5d1; border-radius: var(--r-pill); font: inherit; font-size: 14px; }
.messages-at { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--c-green-dark); color: #fff; font-size: 11px; font-weight: 700; }
.messages-update > .bubble-actions { flex-basis: 100%; justify-content: flex-start; margin: -4px 0 2px; padding-left: 50px; }
.messages-badge.is-quiet { background: var(--c-muted); }
.messages-ask-notify { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0 12px 6px; padding: 8px 12px; border-radius: var(--r-md); background: #eef8f1; font-size: 13px; }
.messages-ask-notify span { flex: 1 1 200px; }
.messages-kebab { flex: none; min-width: 36px; min-height: 36px; border: 0; border-radius: 50%; background: none; font-size: 20px; cursor: pointer; }
.messages-switch { display: flex; align-items: center; gap: 8px; min-height: 36px; font-weight: 500; }
.messages-settings-toggle { margin-top: var(--s-3); }
:deep(.bubble-wrap.is-flash .bubble) { box-shadow: 0 0 0 3px #e8a643; transition: box-shadow .3s; }
</style>
