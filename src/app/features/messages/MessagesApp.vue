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
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { formatClock } from '../../../game/clock.ts'
import type { Conversation, Message, MoneyRequestView, SearchResult, ThreadItem } from '../../../types/social.ts'
import type { PlayerRef } from '../../../types/protocol.ts'
import { call, cityId as socialCityId, discard, newClientId, onCallFrame, onSocketOpen, openThread, perform, refreshLife, reconnect as reconnectSocial, retry, send, social, start as startSocial, sync, threadView } from '../social/useSocial.ts'
import BaseButton from '../../ui/BaseButton.vue'
import BaseSheet from '../../ui/BaseSheet.vue'
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
const VisitButton = defineAsyncComponent(() => import('../visit/VisitButton.vue'))
// The social glue (docs/SOCIAL-GLUE.md), one lazy chunk: here the strip of close friends who are somewhere now, above the chats.
const GluePart = defineAsyncComponent(() => import('../glue/GluePart.vue'))
import { pingInstead } from '../ping/pingModel.ts'
import { personUi } from '../social/socialState.ts'
import FounderTag from '../social/FounderTag.vue'
import AiTag from '../social/AiTag.vue'
import { SCAM_REPORT_REASON, scamReportText } from '../trust/scamNotice.ts'
import ResidentBadge from '../locate/ResidentBadge.vue'
import CompanionPin from '../companion/CompanionPin.vue'
import { noticeMarks, resetMessageUi, showConversation, takeDraft, ui } from './messagesState.ts'
import LazyList from '../../ui/LazyList.vue'
import { chunkStart, chunkedView, moreShown } from '../../ui/lazyList.ts'
import { loadMoreChats, loadOlder } from '../social/socialPages.ts'
import { unreadChats, updatesCount } from './messagesModel.ts'
import { announceLines, announceUi } from '../announce/announceStore.ts'
import type { UpdateLine } from './messagesThread.ts'
import { isOutbox, lastLine, partnerOf, provisionalKey, readOnlyReason, targetOf, threadKind, threadTitle, updateLines } from './messagesThread.ts'
import { romanceState } from './romanceCard.ts'
import { filterChats, friendsToStart, onlyUnread, listTime, previewOf, sortChats, threadRows } from './messagesText.ts'
import Composer from './Composer.vue'
import MessageAction from './MessageAction.vue'
import MessageBubble from './MessageBubble.vue'
import PinnedMessages from './PinnedMessages.vue'
import { canPinMessage, createMessagePins } from './messagePins.ts'
import { createMoneyRequests } from './moneyRequests.ts'
import { canAskFor } from './moneyRequestModel.ts'
import type { RequestOp } from './moneyRequestModel.ts'
import { mergeMessages } from '../../../game/social-model.ts'
import { isMessagePinsFrame } from './messagePinsFrame.ts'
import FriendPicker from './FriendPicker.vue'
import GroupManage from './GroupManage.vue'
/** A group's room (features/places): its code is fetched when the button is pressed. */
const openRoom = (id: string): void => { void import('../places/placesStore.ts').then((module) => module.enterRoom(id)) }
import ChatSettings from './ChatSettings.vue'
import ChatMenu from './ChatMenu.vue'
import AttachSheet from './AttachSheet.vue'
// Spray packets are fetched only when a group member opens one (docs/SMALLER-FEATURES.md).
const SprayPacket = defineAsyncComponent(() => import('./SprayPacket.vue'))
import type { AttachChoice } from './AttachSheet.vue'
import Lightbox from './Lightbox.vue'
import { askedAboutNotifications, noteAskedAboutNotifications } from './notifyAsk.ts'
// The chats with AI characters are kept on this phone (features/agents/agentContacts.ts), listed among the chats by time, and open their own screen ('agent-chat').
import { agentBook, filterAgentChats, recentChats, withAiChats } from '../agents/agentContacts.ts'
import type { AiChatRow } from '../agents/agentContacts.ts'

const finding = ref(false)
const props = defineProps<{ params?: unknown }>()
const { game, shell, api, menu } = useApp()
const growth = useGrowth()
const pins = createMessagePins({ fetchJson: game.fetchJson, newId: () => game.newId(), actor: () => game.session.value?.id ?? null, connected: () => game.connected.value })
const pinPreview = ref<number | null>(null)
/** The sheets over a chat: the pinned messages and the "+" of the message box. */
const pinsOpen = ref(false), attachOpen = ref(false), sprayOpen = ref(false)
/** The friends of mine in this group: the people a packet can reach. */
const sprayFriends = computed(() => (conv.value?.kind === 'group' ? conv.value.members.filter((member) => member.id !== me.value?.me.id && me.value?.friends.some((friend) => friend.id === member.id)).length : 0))
const previewedPin = computed(() => pins.state.view?.items.find((entry) => entry.message.seq === pinPreview.value)?.message ?? null)
const isPinned = (item: ThreadItem): boolean => !isOutbox(item) && Boolean(pins.state.view?.items.some((entry) => entry.message.seq === item.seq))

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
/** Opened for a new group (the guide's "create a group"): the form opens as soon as the chats are there to pick friends from. */
const wantGroup = ref(false)
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
/** A lost connection does not take away what is already on screen: with the overview loaded, the chat stays (read-only, the box says why) under a note. */
const blocked = computed(() => Boolean(gate.value && !(gate.value.link && me.value)))
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
watch([() => game.session.value?.id ?? null, () => ui.open, () => conv.value?.owner ?? null, () => conv.value?.members.map((member) => member.id).join(',') ?? ''], () => {
  pinPreview.value = null; pinsOpen.value = false
  pins.setContext(game.session.value?.id ?? null, conv.value)
}, { immediate: true, flush: 'sync' })
const thread = computed(() => { void tick.value; const now = ui.open ? social.threads.get(ui.open) : undefined; return now ? { loaded: now.loaded, error: now.error } : null })
const items = computed(() => { void tick.value; return ui.open ? threadView(ui.open) : [] })
/** The other player of the direct chat on screen, also before its first message (messagesThread.ts partnerOf). */
const partner = computed(() => partnerOf(ui.open, conv.value))
/** The other player of a direct chat, as the server names them (it carries the AI-played mark). */
const partnerRef = computed(() => (conv.value?.kind === 'dm' && partner.value ? conv.value.members.find((member) => member.id === partner.value) ?? null : null))
const title = computed(() => (ui.open ? threadTitle(ui.open, conv.value, me.value?.friends.find(friend => friend.id === partner.value)?.name ?? ui.openName) : ''))
/** A direct chat with the founder: the server marked that member. */
const withFounder = computed(() => conv.value?.kind === 'dm' && conv.value.members.some((member) => member.id === conv.value?.with && member.founder === true))
const readOnly = computed(() => (ui.open && me.value ? readOnlyReason(ui.open, me.value, connected.value ? null : linkWords(view.value)?.cannot('send messages') ?? 'Not connected.') : null))
const isGroup = computed(() => Boolean(conv.value) && conv.value?.kind !== 'dm')
const threadBox = ref<HTMLElement | null>(null)
const composer = ref<InstanceType<typeof Composer> | null>(null)
/** The message being answered, until it is sent or cancelled. */
const replying = ref<Message | null>(null)
const messageAction = ref<{ kind: 'edit' | 'delete' | 'forward'; item: Message } | null>(null)
watch(() => ui.open, () => { messageAction.value = null; attachOpen.value = false; sprayOpen.value = false })
let actorTurn = 0
// Of a long conversation only the newest lines are drawn; earlier ones are drawn as the reader scrolls up, and read from the server
// when the kept lines run out (chunked rendering: a line's height is not known, so there is no fixed window).
const FIRST_SHOWN = 60, SHOWN_STEP = 40
const shown = ref(FIRST_SHOWN)
const exhausted = reactive(new Set<string>())
const earlier = reactive({ busy: false, error: '' })
const hiddenLocal = computed(() => chunkStart(items.value.length, shown.value))
const olderKept = computed(() => { void tick.value; const first = ui.open ? social.threads.get(ui.open)?.messages[0]?.seq : undefined; return Boolean(ui.open && first && first > 1 && !exhausted.has(ui.open)) })
const hasEarlier = computed(() => hiddenLocal.value > 0 || olderKept.value)
const rows = computed(() => threadRows(items.value.slice(hiddenLocal.value), Date.now()))
const olderMark = ref<HTMLElement | null>(null)
/** Draw earlier lines, from what is held or, when that has run out, from the server; the reader stays on the line they were reading. */
async function showEarlier(): Promise<void> {
  const box = threadBox.value, key = ui.open, turn = actorTurn
  if (!box || !key || earlier.busy || !hasEarlier.value) return
  earlier.busy = true; earlier.error = ''
  const height = box.scrollHeight, top = box.scrollTop
  if (hiddenLocal.value > 0) shown.value = moreShown(shown.value, items.value.length, SHOWN_STEP)
  else {
    const got = await loadOlder(key)
    if (turn !== actorTurn) return
    if (ui.open !== key) { earlier.busy = false; return }
    if (!got) earlier.error = 'Couldn’t load earlier messages.'
    else { shown.value += got.added; if (!got.more || !got.added) exhausted.add(key); shell.bump() }
  }
  await nextTick()
  if (turn !== actorTurn) return
  box.scrollTop = top + (box.scrollHeight - height)
  earlier.busy = false
  // Still near the top (a short page): keep going.
  if (box.scrollTop < box.clientHeight * 1.5) void showEarlier()
}
let earlierWatch: IntersectionObserver | null = null
watch(olderMark, (mark) => {
  earlierWatch?.disconnect(); earlierWatch = null
  const box = threadBox.value
  if (!mark || !box || typeof IntersectionObserver === 'undefined') return
  earlierWatch = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void showEarlier() }, { root: box, rootMargin: `${Math.round(box.clientHeight * 1.5)}px 0px 0px 0px` })
  earlierWatch.observe(mark)
})
onBeforeUnmount(() => earlierWatch?.disconnect())
// A line that arrives while the reader is up the thread must not push the lines they are reading out of the drawn part.
watch(() => items.value.length, (now, was) => { if (now > was && was > 0) shown.value += now - was })
watch(() => ui.open, () => { shown.value = FIRST_SHOWN; earlier.error = '' })
const chatsMore = ref(false)
async function moreChats(): Promise<void> { if (chatsMore.value) return; chatsMore.value = true; try { await loadMoreChats() } finally { chatsMore.value = false }; shell.bump() }
/** Scrolled up to read earlier lines: new ones count on the jump button instead of pulling the view down. */
const atBottom = ref(true)
const fresh = ref(0)
const quoted = ref<{ from: string; text: string } | null>(null)
// Below the refs it clears: this watch runs at once, and setOpen() writes `replying`, `fresh` and `quoted` (a watch above them hit "Cannot access ... before initialization").
// Opened from a person card, a contact or a notification: { to, name } | { conv } | { tab }.
watch(() => props.params, (params) => {
  const asked = (params ?? null) as { tab?: string; conv?: string; to?: string; name?: string; new?: string } | null
  if (!asked) return
  if (asked.tab === 'updates' || asked.tab === 'chats' || asked.tab === 'groups') { setOpen(null); ui.tab = asked.tab }
  else if (asked.new === 'group') { setOpen(null); ui.tab = 'chats'; wantGroup.value = true }
  else if (asked.conv) { setOpen(asked.conv); void openThread(asked.conv) }
  else if (asked.to) {
    const existing = social.me?.conversations.find((conv) => conv.with === asked.to)
    setOpen(existing ? existing.id : provisionalKey(asked.to)); ui.openName = asked.name ?? null; ui.tab = 'chats'
    if (existing) void openThread(existing.id)
  }
}, { immediate: true })
const nearBottom = (box: HTMLElement): boolean => box.scrollHeight - box.scrollTop - box.clientHeight < 80
function onScroll(): void { const box = threadBox.value; if (!box) return; atBottom.value = nearBottom(box); if (atBottom.value) fresh.value = 0; if (box.scrollTop < box.clientHeight * 1.5 && hasEarlier.value) void showEarlier() }
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
  const turn = actorTurn, text = find.text.trim()
  if (text.length < 2) { find.results = null; find.error = 'Type at least two letters of their name.'; return }
  find.busy = true; find.error = null
  const result = await call<{ results: SearchResult[] }>(`/api/social/search?q=${encodeURIComponent(text)}`)
  if (turn !== actorTurn) return
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
  const turn = actorTurn
  shell.open('person', { player, name })
  // The card clears its forms when it first shows a player, so the form is opened once the card has taken this player.
  for (let tries = 0; tries < 40 && personUi.player !== player; tries += 1) await new Promise((done) => setTimeout(done, 50))
  if (turn === actorTurn && personUi.player === player) { personUi.form = 'money'; personUi.clientId = newClientId() }
}
/** Requests for money: asking from the chat options, and answering a card in the thread. A card is redrawn from the server's answer (and from the live frame both players get). */
// The server's clock as this device has measured it, so a wrong device clock does not hide a card that can still be paid (or show one that cannot).
const now = ref(game.serverNow())
// Started on mount, not in setup: setup also runs when the markup is rendered on a server, which never unmounts and so never clears it.
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { now.value = game.serverNow() }, 15000) })
onBeforeUnmount(() => clearInterval(clock))
const requests = createMoneyRequests({
  call: async (path, body) => { const result = await call<{ request: MoneyRequestView; message?: Message }>(path, body); void sync(); return result },
  newClientId,
  cityId: socialCityId,
  apply(message, request) {
    const key = message?.conv ?? ui.open
    if (!key) return
    // The first request in a chat with nobody written to yet makes the chat: the screen moves from "to:<player>" to it and reads it.
    if (message && ui.open?.startsWith('to:')) { showConversation(key); social.openConv = key; void openThread(key); return }
    const thread = social.threads.get(key)
    if (!thread) return
    const line = message ?? thread.messages.find((item) => item.request?.id === request.id)
    if (line) thread.messages = mergeMessages(thread.messages, [{ ...line, request }])
  },
  toast: (text, kind) => game.toast(text, kind),
  refreshLife,
})
function answerCard(item: ThreadItem, id: string, op: RequestOp): void {
  if (!isOutbox(item) && item.request) void requests.answer(id, op, item.from?.name ?? 'them', item.request.amount)
}
const requestForm = ref<HTMLFormElement | null>(null)
/** Asking is offered only where it can succeed: a current friend, nobody blocked. It goes the moment a block or an unfriend arrives. */
const canRequest = computed(() => canAskFor(partner.value, me.value?.friends ?? [], me.value?.blocked ?? []))
watch(canRequest, (can) => { if (!can) requests.closeForm() })
// The form is brought into view when it opens, whatever the screen's height (the options panel scrolls inside the chat).
watch(() => requests.ask.open, (open) => { if (open) void nextTick(() => requestForm.value?.scrollIntoView?.({ block: 'nearest' })) }, { flush: 'post' })
async function sendRequest(): Promise<void> {
  if (partner.value && await requests.submit(partner.value, transferLimits.value)) ui.manage = false
}
const transferLimits = computed(() => { const transfer = game.view.value.social?.transfer; return transfer ? { min: transfer.min, max: transfer.maxPerTransfer } : {} })
function newGroup(): void { Object.assign(group, { open: true, name: '', members: [], clientId: newClientId() }) }
// Opened for a new group (the guide's "create a group"): the form opens as soon as the chats are there to pick friends from.
watch([wantGroup, me], () => { if (wantGroup.value && me.value) { wantGroup.value = false; newGroup() } }, { immediate: true })
async function createGroup(): Promise<void> {
  if (group.busy) return
  const turn = actorTurn
  group.busy = true
  // One client id per group form, reused on a retry, so a retry cannot create it twice.
  const result = await perform<{ conv: Conversation }>('/api/social/groups', { name: group.name, members: group.members.map((person) => person.id), clientId: group.clientId }, 'Group created')
  if (turn !== actorTurn) return
  group.busy = false
  if (result.ok) { group.open = false; openConversation(result.conv.id) }
}
function groupLeft(): void { const key = ui.open; if (key) social.threads.delete(key); setOpen(null) }
/** Remove a chat from my list only: the other person keeps theirs, and it comes back with a new message. */
async function hideChat(): Promise<void> {
  const key = ui.open, turn = actorTurn
  if (!key) return
  const result = await perform(`/api/social/conversations/${encodeURIComponent(key)}/prefs`, { hide: true })
  if (turn === actorTurn && result.ok && ui.open === key) groupLeft()
}
async function pinChat(on: boolean): Promise<void> { const key = ui.open; if (key) await perform(`/api/social/conversations/${encodeURIComponent(key)}/prefs`, { pin: on }) }
function pickAttachment(choice: AttachChoice): void {
  attachOpen.value = false
  void nextTick(() => {
    if (choice === 'picture') composer.value?.pickPicture()
    else if (choice === 'voice') composer.value?.startVoice()
    else if (choice === 'send-money' && partner.value) void sendMoneyTo(partner.value, title.value)
    else if (choice === 'request-money') requests.openForm()
    else if (choice === 'spray') sprayOpen.value = true
  })
}
/** The menu was dismissed (not used): the keyboard goes back to the button that opened it. */
function closeMenu(): void { ui.manage = false; void nextTick(() => rootBox.value?.querySelector<HTMLElement>('.messages-kebab')?.focus()) }
/** The floating button opens the player search and puts the cursor in it (the search sits at the top of the list). */
function toggleFind(): void { finding.value = !finding.value; if (finding.value) void nextTick(() => rootBox.value?.querySelector<HTMLInputElement>('#message-player-search')?.focus()) }
const pinCount = computed(() => pins.state.view?.items.length ?? 0)
const pinText = computed(() => { const line = pins.state.view?.items[0]?.message; return line ? line.body.trim() || (line.image ? 'Picture' : line.voice ? 'Voice message' : 'Message') : '' })
const listMode = ref<'all' | 'unread'>('all')
const chatFilter = ref('')
const chatList = computed(() => sortChats(filterChats((ui.tab === 'chats' && listMode.value === 'unread' ? onlyUnread(me.value?.conversations ?? []) : me.value?.conversations ?? []).filter((item) => ui.tab !== 'groups' || item.kind === 'group'), chatFilter.value)))
const groupCount = computed(() => me.value?.conversations.filter((item) => item.kind === 'group').length ?? 0)
/** Friends not yet written to: a tap starts the chat, so the list is never a dead end for someone who has friends. */
const toStart = computed(() => (ui.tab === 'chats' && listMode.value === 'all' && !chatFilter.value && me.value ? friendsToStart(me.value.friends, me.value.conversations) : []))
function startWith(friend: { id: string; name: string }): void { setOpen(provisionalKey(friend.id)); ui.openName = friend.name }
const unreadTotal = computed(() => onlyUnread(me.value?.conversations ?? []).length)
/** The chats with AI characters, in the same list by time like any chat (pinned chats stay first), searched with the same box. */
const aiChats = computed(() => (ui.tab === 'chats' && listMode.value === 'all' ? filterAgentChats(recentChats(agentBook.chats), chatFilter.value) : []))
const listRows = computed<(Conversation | AiChatRow)[]>(() => (aiChats.value.length ? withAiChats(chatList.value, aiChats.value) : chatList.value))
const aiLast = (lines: readonly { me: boolean; text: string }[]): string => { const line = lines.at(-1); return line ? `${line.me ? 'You: ' : ''}${line.text}` : '' }
function openAiChat(item: { id: string; name: string; city: string }): void { shell.open('agent-chat', { id: item.id, name: item.name, city: item.city }) }
const clockNow = computed(() => { void now.value; return game.serverNow() })
const showSettings = ref(false)
const lightbox = ref<Message | null>(null)
/** The picture button shows where pictures are switched on and the chat takes them: a direct chat with a friend, or a group. */
const voiceAllowed = computed(() => Boolean(me.value?.limits.voice?.on && ui.open && !ui.open.startsWith('h.') && (conv.value?.kind === 'group' || Boolean(partner.value && me.value?.friends.some(friend => friend.id === partner.value)))))
/** The scam banner's Report: the sender is reported as a scam with the line as the note; the server keeps the last messages as evidence. */
async function reportScam(line: Message): Promise<void> { if (line.from) await perform('/api/social/reports', { id: line.from.id, reason: SCAM_REPORT_REASON, text: scamReportText(line.body, me.value?.limits.reportText) }, 'Report received. A moderator will look at it.') }
async function reportVoice(line: Message): Promise<void> { if (line.voice && ui.open) await perform('/api/social/reports', { conv: ui.open, voice: line.voice.id, reason: 'other' }, 'Voice note reported and hidden for you.') }
const pictureAllowed = computed(() => Boolean(me.value?.limits.pictures.on && ui.open && !ui.open.startsWith('h.') && (conv.value?.kind === 'group' || Boolean(partner.value && me.value?.friends.some((friend) => friend.id === partner.value))) && !readOnly.value))
async function pictureSent(result: { conv: Pick<Conversation, 'id'> }): Promise<void> {
  const real = result.conv.id
  if (ui.open !== real) setOpen(real)
  await openThread(real)
}
async function reportPicture(): Promise<void> {
  const line = lightbox.value, key = ui.open, turn = actorTurn
  if (!line?.image || !key) return
  lightbox.value = null
  await perform('/api/social/reports', { conv: key, image: line.image.id, reason: 'other' }, 'Report received. The picture is hidden for you.')
  if (turn === actorTurn) void openThread(key)
}
/** After the player's own message in a chat, once: "Get a notification when Joy replies?" (never on arrival; the browser's own question comes only after Yes). */
/** A message's actions menu is open: the notification question waits so the menu has the room. */
const menuUp = ref(false)
const askNotify = computed(() => Boolean(ui.open && conv.value && items.value.some((item) => isOutbox(item) || (!isOutbox(item) && item.from?.id === me.value?.me.id)) && !askedAboutNotifications() && growth.state.hello?.consent?.push !== true && growth.state.hello?.consent?.age !== 'minor'))
const askedNow = ref(0)
function answerNotify(yes: boolean): void { noteAskedAboutNotifications(); askedNow.value += 1; if (yes) shell.open('touch') }

// ---- updates -------------------------------------------------------------------------------
const chats = computed(() => unreadChats(me.value))
const updates = computed(() => { void tick.value; return me.value ? updatesCount(me.value, noticeMarks.fresh(view.value.session?.id ?? null, view.value.cityId, notices.value)) : 0 })
/** The mark from before the tab was opened: what was new stays marked "New" while it is read. */
const seenBefore = ref<number | null>(null)
const lines = computed(() => [...updateLines(me.value?.updates ?? [], notices.value, seenBefore.value ?? noticeMarks.seen(view.value.session?.id ?? null, view.value.cityId)), ...announceLines(announceUi.items, announceUi.seen)].sort((a, b) => b.at - a.at))
const openStoryHelp = (storyHelp: string): boolean => shell.open('passport', { tab: 'story', storyHelp })
// Updates are drawn thirty at a time as the reader goes down (the server keeps at most fifty of its own).
const shownLines = chunkedView(() => lines.value, 30)
function readUpdates(): void {
  if (ui.tab !== 'updates' || ui.open || !me.value) { seenBefore.value = null; return }
  seenBefore.value ??= noticeMarks.seen(view.value.session?.id ?? null, view.value.cityId)
  if (noticeMarks.mark(view.value.session?.id ?? null, view.value.cityId, notices.value)) shell.bump()
}
function showTab(tab: 'chats' | 'groups' | 'updates'): void {
  ui.tab = tab
  if (tab === 'updates' && (me.value?.updates ?? []).some((update) => !update.read)) void call('/api/social/updates/read', {}).then(sync)
}
watch([() => ui.tab, () => ui.open, me, notices], readUpdates, { immediate: true })
/** The notice that put the player in a group offers one tap to leave it. */
async function leaveFromUpdate(key: string): Promise<void> { const turn = actorTurn; await perform(`/api/social/groups/${encodeURIComponent(key)}`, { op: 'leave' }, 'You left the group.'); if (turn === actorTurn) social.threads.delete(key) }
const answerFriend = (from: string, accept: boolean): Promise<unknown> => perform('/api/social/friends/answer', { from, accept, cityId: socialCityId() }, accept ? 'You are now friends' : null)
const answerRomance = (agent: string, accept: boolean): Promise<unknown> => perform('/api/social/romance/answer', { with: agent, accept }, accept ? 'Yes, saved. You can change it on their profile.' : 'No, saved.')
const answerBae = (from: string, accept: boolean): Promise<unknown> => perform('/api/social/bae/answer', { from, accept, cityId: socialCityId() })

watch(() => game.session.value?.id ?? null, () => {
  actorTurn++
  resetMessageUi(); social.openConv = null
  messageAction.value = null; replying.value = null; quoted.value = null; lightbox.value = null
  wantGroup.value = false; finding.value = false; chatFilter.value = ''; showSettings.value = false; listMode.value = 'all'; pinsOpen.value = false; attachOpen.value = false
  Object.assign(find, { text: '', busy: false, results: null, error: null })
  Object.assign(group, { open: false, name: '', members: [], clientId: '', busy: false })
  earlier.busy = false; earlier.error = ''; exhausted.clear(); shown.value = FIRST_SHOWN
  fresh.value = 0; atBottom.value = true; seenBefore.value = null
}, { flush: 'sync' })

onMounted(() => {
  void growth.load() // the footer's WhatsApp link comes with the growth hello (asked for at most every five minutes)
  startSocial(api)
  // The thread that was on screen when the app was closed is on screen again: say so, and catch up.
  if (ui.open) { social.openConv = ui.open; if (!ui.open.startsWith('to:')) void openThread(ui.open) }
})
// Off screen, no conversation is "open": a message that arrives then is unread, with its toast and its badge.
const stopPinFrames = onCallFrame((frame) => {
  if (isMessagePinsFrame(frame)) pins.receive(frame)
})
const stopPinReconnect = onSocketOpen(() => pins.reconnect())
onBeforeUnmount(() => { social.openConv = null; stopPinFrames(); stopPinReconnect(); pins.dispose() })

defineExpose({
  /** Esc inside a conversation: the open options panel (with its request form) closes first and focus returns to the control that opened it; then the next Esc goes back to the list, and the one after leaves the app. */
  keys(action: string): boolean {
    if (action !== 'cancel' || !ui.open) return false
    // What is laid over the chat (the menu, the request form, pins, the attach sheet) closes first, and focus returns to the control that opened the menu; one Escape never leaves the chat with a sheet open.
    if (pinsOpen.value || attachOpen.value || requests.ask.open || ui.manage) { const menu = ui.manage; pinsOpen.value = false; attachOpen.value = false; pinPreview.value = null; if (requests.ask.open) requests.closeForm(); ui.manage = false; if (menu) closeMenu(); return true }
    back()
    return true
  },
})
</script>

<template>
  <div ref="rootBox" class="messages" :class="{ 'panel-fill': Boolean(ui.open) && !gate }">
    <div v-if="gate && blocked" class="messages-note" :class="{ 'is-warn': gate.warn }" role="status">
      {{ gate.text }} <button v-if="gate.link && linkAction" class="messages-link" type="button" @click="runLinkAction">{{ linkAction.label }}</button><button v-if="gate.retry" class="messages-link" type="button" @click="social.error = null; sync()">Retry</button>
    </div>
    <template v-else-if="me">
      <div v-if="gate" class="messages-note" :class="{ 'is-warn': gate.warn, 'is-inset': ui.open }" role="status">
        {{ gate.text }} <button v-if="gate.link && linkAction" class="messages-link" type="button" @click="runLinkAction">{{ linkAction.label }}</button>
      </div>
      <div v-if="socket !== 'open'" class="messages-note" :class="{ 'is-warn': socket === 'offline', 'is-inset': ui.open }" role="status">
        <template v-if="socket === 'offline'">Live updates are off. <button class="messages-link" type="button" @click="reconnectSocial()">Reconnect</button></template>
        <template v-else>Connecting live updates… new messages still load when you open a chat.</template>
      </div>

      <!-- A conversation -->
      <div v-if="ui.open" class="messages-chat" :class="{ 'is-managing': ui.manage }">
        <header class="messages-head">
          <button class="messages-back" type="button" aria-label="Back to chats" @click="back"><GameIcon name="back" :size="22" /></button>
          <RowMark v-if="conv?.kind === 'group'" :name="title" :seed="conv.id" />
          <RowMark v-else-if="ui.open.startsWith('h.')" round>🏠</RowMark>
          <RowMark v-else :name="title" :seed="conv?.with ?? ui.open" />
          <h3 v-if="withFounder"><button type="button" class="messages-name" :aria-label="`${title}: open profile`" @click="conv?.with && shell.open('person', { player: conv.with, name: title })">{{ title }}</button><FounderTag /><ResidentBadge v-if="conv?.kind === 'dm' && conv.with" :id="conv.with" /><small :class="presenceOf(conv?.with) ? `messages-presence is-${presenceOf(conv?.with)}` : undefined">{{ (conv?.kind === 'dm' && presenceWord(conv.with)) || threadKind(conv) }}</small></h3>
          <h3 v-else><button v-if="partner" type="button" class="messages-name" :aria-label="`${title}: open profile`" @click="shell.open('person', { player: partner, name: title })">{{ title }}</button><template v-else>{{ title }}</template><small :class="partner && presenceOf(partner) ? `messages-presence is-${presenceOf(partner)}` : undefined">{{ (partner && presenceWord(partner)) || threadKind(conv) }}</small></h3>
          <AiTag v-if="partnerRef" :who="partnerRef" />
          <BaseButton v-if="conv?.kind === 'group'" small data-group-room title="Step into this group’s room: furnish it together and talk by voice" @click="openRoom(conv.id)">Room</BaseButton>
          <BaseButton v-if="conv?.kind === 'group'" small :aria-expanded="ui.manage" aria-haspopup="dialog" @click="ui.manage = true">Group</BaseButton>
          <template v-else-if="partner">
            <!-- A friend who is not in the game cannot be rung: Ping takes Call's place, so the header never holds a fourth control. -->
            <PingButton v-if="pingFor(partner)" compact :id="partner" :name="title" />
            <PersonCallButton v-else compact :id="partner" :name="title" :status="presenceOf(partner) ?? undefined" />
            <button type="button" class="messages-kebab" aria-label="Chat options" aria-haspopup="menu" :aria-expanded="ui.manage" @click="ui.manage = !ui.manage">⋯</button>
          </template>
        </header>
        <PingStrip v-if="partner && pingFor(partner)" inset :id="partner" :name="title" />
        <div v-if="partner && conv?.kind === 'dm'" class="messages-visit"><VisitButton compact :id="partner" :name="title" /></div>
        <div v-if="conv?.kind === 'house'" class="messages-note is-inset">House chat: only the host and the guests inside can read this.</div>

        <button v-if="conv && pinCount" type="button" class="messages-pinbar" data-chat="pinbar" :aria-label="`Pinned messages, ${pinCount}: ${pinText}. Open the list`" @click="pinsOpen = true"><span aria-hidden="true">📌</span><span class="messages-pinbar-text">{{ pinText }}</span><small v-if="pinCount > 1">{{ pinCount }}</small></button>
        <div v-else-if="conv && (pins.state.loading || pins.state.error)" class="messages-note is-inset" :class="{ 'is-warn': pins.state.error }" :role="pins.state.error ? 'alert' : 'status'">
          {{ pins.state.error || 'Loading pinned messages…' }} <button v-if="pins.state.error" type="button" class="messages-link" @click="pins.load()">Try again</button>
        </div>
        <BaseSheet v-if="conv && pins.state.view" :open="pinsOpen" label="Pinned messages" @close="pinsOpen = false; pinPreview = null">
          <div class="messages-sheet-body">
            <PinnedMessages :pins="pins.state.view" :kind="conv.kind" :loading="pins.state.loading" :pending="pins.state.pending" :retryable="pins.state.retryable" :disabled="!connected" :error="pins.state.error" @open="(message) => { pinPreview = message?.seq ?? null }" @clear="pins.change({ clearAll: true })" @retry="pins.retryChange" @dismiss="pins.dismissRetry" />
            <section v-if="previewedPin" class="messages-pin-preview" aria-label="Pinned message">
              <MessageBubble :item="previewedPin" :me-id="me.me.id" :group="isGroup" :head="true" :tail="true" :time="time(previewedPin.at)" :can-react="false" :can-actions="true" :can-pin="Boolean(pins.state.view?.canManage && canPinMessage(previewedPin))" :pinned="true" :pin-pending="pins.state.pending" :pin-blocked="pins.state.retryable" :pin-offline="!connected" preview @pin="(item, pinned) => pins.change({ message: item, pinned })" @reply="(line) => { replying = line; pinsOpen = false; composer?.focus() }" @player="openCard" @jump="(seq) => { pinsOpen = false; jump(seq) }" @report-voice="reportVoice" @report-scam="reportScam" @edit="(item) => { pinsOpen = false; messageAction = { kind: 'edit', item } }" @remove="(item) => { pinsOpen = false; messageAction = { kind: 'delete', item } }" @forward="(item) => { pinsOpen = false; messageAction = { kind: 'forward', item } }" />
              <button type="button" aria-label="Close pinned message" @click="pinPreview = null">Close</button>
            </section>
            <BaseButton class="messages-sheet-done" small @click="pinsOpen = false; pinPreview = null">Done</BaseButton>
          </div>
        </BaseSheet>

        <BaseSheet v-if="conv?.kind === 'group'" :open="ui.manage" label="Group" @close="ui.manage = false">
          <div class="messages-sheet-body"><GroupManage v-if="ui.manage" :conv="conv" :me="me" @left="groupLeft" @player="openCard" /></div>
        </BaseSheet>
        <ChatMenu v-else-if="partner && ui.manage" :pins="pinCount" :pins-shown="Boolean(conv && pins.state.view && (pinCount || pins.state.view.canManage))" :can-request="canRequest" :chat-exists="conv?.kind === 'dm'" :chat-pinned="conv?.pinned === true" :offline="!connected" @close="closeMenu" @pins="ui.manage = false; pinsOpen = true" @send-money="ui.manage = false; sendMoneyTo(partner, title)" @request-money="ui.manage = false; requests.openForm()" @pin-chat="(on) => { ui.manage = false; pinChat(on) }" @hide="ui.manage = false; hideChat()" />
        <BaseSheet v-if="partner" :open="requests.ask.open" label="Request money" @close="requests.closeForm()">
          <form v-if="requests.ask.open && canRequest" ref="requestForm" class="messages-request messages-sheet-body" aria-label="Request money" @submit.prevent="sendRequest">
            <h3>Request money</h3>
            <label for="message-request-amount">Amount to ask for (₦)</label>
            <input id="message-request-amount" v-model="requests.ask.amount" class="messages-field" name="amount" inputmode="numeric" pattern="[0-9]*" maxlength="13" required :aria-invalid="requests.ask.error ? true : undefined" aria-describedby="message-request-help">
            <label for="message-request-note">Note (optional)</label>
            <input id="message-request-note" v-model="requests.ask.note" class="messages-field" name="note" maxlength="60" placeholder="What is it for?">
            <p id="message-request-help" class="messages-note" :class="{ 'is-warn': requests.ask.error }" :role="requests.ask.error ? 'alert' : undefined">{{ requests.ask.error || `Your friend sees a card and can pay or decline it. It lasts 24 hours. Paying counts as a gift under the usual gift limits.` }}</p>
            <span class="bubble-actions is-start">
              <BaseButton small variant="primary" type="submit" :disabled="requests.ask.busy">{{ requests.ask.busy ? 'Sending…' : 'Send request' }}</BaseButton>
              <BaseButton small @click="requests.closeForm()">Cancel</BaseButton>
            </span>
          </form>
        </BaseSheet>
        <AttachSheet :open="attachOpen" :pictures="pictureAllowed" :voice="voiceAllowed && !readOnly" :money="Boolean(partner) && !readOnly" :spray="conv?.kind === 'group' && !readOnly" :offline="!connected" @close="attachOpen = false" @pick="pickAttachment" />
        <BaseSheet v-if="conv?.kind === 'group'" :open="sprayOpen" label="Spray a packet" @close="sprayOpen = false">
          <SprayPacket v-if="sprayOpen && ui.open" :conv="ui.open" :friends="sprayFriends" :offline="!connected" @done="sprayOpen = false" />
        </BaseSheet>

        <div class="messages-body">
          <div ref="threadBox" class="messages-thread" aria-live="polite" @scroll.passive="onScroll">
            <div v-if="hasEarlier && items.length" ref="olderMark" class="messages-older" role="status">
              <template v-if="earlier.error">{{ earlier.error }} <button type="button" class="messages-link" @click="showEarlier">Try again</button></template>
              <template v-else><i aria-hidden="true" /><i aria-hidden="true" /><span class="sr-only">Loading earlier messages</span></template>
            </div>
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
              <div v-else-if="row.item.romance" class="bubble is-sys is-romance" data-romance>
                <span>{{ row.item.body }}</span>
                <span v-if="row.item.romance.answerable" class="bubble-actions is-start"><BaseButton small variant="primary" :disabled="!connected" @click="answerRomance(row.item.romance.agent.id, true)">Yes</BaseButton><BaseButton small :disabled="!connected" @click="answerRomance(row.item.romance.agent.id, false)">No</BaseButton></span>
                <b v-else-if="romanceState(row.item.romance)">{{ romanceState(row.item.romance) }}</b>
              </div>
              <div v-else-if="row.item.sys" class="bubble is-sys">{{ row.item.body }}</div>
              <MessageBubble v-else @menu="menuUp = $event" :item="row.item" :me-id="me.me.id" :group="isGroup" :head="row.head" :tail="row.tail" :time="time(row.item.at)" :can-react="conv?.kind !== 'house'" :can-actions="true" :can-pin="Boolean(pins.state.view?.canManage && canPinMessage(row.item))" :pinned="isPinned(row.item)" :pin-pending="pins.state.pending" :pin-blocked="pins.state.retryable" :pin-offline="!connected" :voice-enabled="me.prefs.voiceNotes !== 'nobody'" :now="now" :partner="title" :request-busy="Boolean(row.item.request && requests.busy.has(row.item.request.id))" :request-offline="!connected" @request="(id, op) => answerCard(row.item, id, op)" @pin="(item, pinned) => pins.change({ message: item, pinned })" @reply="(line) => { replying = line; composer?.focus() }" @react="react" @player="openCard" @jump="jump" @report-voice="reportVoice" @report-scam="reportScam" @picture="(line) => { lightbox = line }" @edit="(item) => { messageAction = { kind: 'edit', item } }" @remove="(item) => { messageAction = { kind: 'delete', item } }" @forward="(item) => { messageAction = { kind: 'forward', item } }" />
            </template>
          </div>
          <button v-if="fresh > 0 || !atBottom" type="button" class="messages-latest" :aria-label="fresh ? `Jump to latest, ${fresh} new` : 'Jump to latest'" @click="toLatest">↓<span v-if="fresh" class="messages-badge">{{ fresh }}</span></button>
        </div>
        <div v-if="quoted" class="messages-quoted" role="status"><b>{{ quoted.from }}</b> {{ quoted.text }}<small> — the original is no longer kept</small> <button type="button" class="messages-link" @click="quoted = null">Close</button></div>

        <div v-if="askNotify && askedNow >= 0 && !menuUp" class="messages-ask-notify" role="group" aria-label="Notifications">
          <span>Get a notification when {{ conv?.kind === 'dm' ? title : 'someone answers here' }} replies?</span>
          <BaseButton small variant="primary" @click="answerNotify(true)">Yes</BaseButton><BaseButton small @click="answerNotify(false)">Not now</BaseButton>
        </div>
        <footer class="messages-foot">
          <span v-if="readOnly" class="messages-why">{{ readOnly }}</span>
          <MessageAction v-if="messageAction" :key="`${messageAction.kind}:${messageAction.item.id}`" :kind="messageAction.kind" :item="messageAction.item" :conversations="me.conversations" :disabled="Boolean(readOnly)" :max="me.limits.body" @close="messageAction = null" />
          <Composer ref="composer" :pictures="pictureAllowed" :voice="voiceAllowed" :target="targetOf(ui.open)" :new-id="newClientId" :conv="ui.open" :members="isGroup && conv?.kind === 'group' ? conv.members : []" :me-id="me.me.id" :admin="conv?.owner === me.me.id" :max="me.limits.body" :disabled="Boolean(readOnly)" :reply="replying" :prefill="ui.prefill" @send="sendFromComposer" @cancel-reply="replying = null" @attach="attachOpen = true" @sent-picture="pictureSent" @sent-voice="pictureSent" />
        </footer>
      </div>

      <!-- The lists -->
      <template v-else>
        <div class="messages-tabs" role="tablist">
          <button role="tab" type="button" :aria-selected="ui.tab === 'chats'" @click="showTab('chats')">Chats<span v-if="chats" class="messages-badge">{{ chats }}</span></button>
          <button role="tab" type="button" :aria-selected="ui.tab === 'groups'" @click="showTab('groups')">Groups</button>
          <button role="tab" type="button" :aria-selected="ui.tab === 'updates'" @click="showTab('updates')">Updates<span v-if="updates" class="messages-badge">{{ updates }}</span></button>
        </div>

        <div v-if="ui.tab !== 'updates'" role="tabpanel">
          <GluePart v-if="ui.tab === 'chats'" part="strip" />
          <CompanionPin />
          <label v-if="finding && ui.tab === 'chats'" class="messages-find-label" for="message-player-search">Find a player</label>
          <form v-if="finding && ui.tab === 'chats'" class="messages-form is-search" role="search" @submit.prevent="search">
            <input id="message-player-search" v-model="find.text" name="q" maxlength="36" placeholder="Find a player by name" aria-label="Find a player by name" autocomplete="off">
            <BaseButton small type="submit" :disabled="find.busy">Find</BaseButton>
          </form>
          <div v-if="ui.tab === 'chats' && find.busy" class="messages-note" role="status">Searching…</div>
          <div v-else-if="ui.tab === 'chats' && find.error" class="messages-note is-warn" role="alert">{{ find.error }}</div>
          <ListRows v-else-if="ui.tab === 'chats' && find.results?.length" label="Players found">
            <ListRow v-for="player in find.results" :key="player.id" :title="player.name" :sub="`Real player${player.friend ? ' · Friend' : ''} · #${player.id.slice(0, 6)}`">
              <template #icon><RowMark :name="player.name" :seed="player.id" /></template>
              <template #end><BaseButton small variant="primary" @click="messagePlayer(player)">Message</BaseButton></template>
            </ListRow>
          </ListRows>
          <div v-else-if="ui.tab === 'chats' && find.results" class="messages-note" role="status">Nobody found with that name. Players appear here once they have opened the game.</div>

          <SectionTitle>{{ ui.tab === 'groups' ? 'Groups' : 'Chats' }}<template #end><BaseButton v-if="!group.open" small @click="newGroup">New group</BaseButton></template></SectionTitle>
          <form v-if="group.open" class="messages-manage" @submit.prevent="createGroup">
            <label for="message-group-name">Group name</label>
            <input id="message-group-name" v-model="group.name" class="messages-field" name="name" :maxlength="me.limits.groupName" placeholder="Group name" aria-label="Group name" required>
            <FriendPicker v-model:selected="group.members" :exclude="[]" :max="me.limits.groupSize - 1" />
            <div class="messages-note">{{ me.limits.groupSize }} people at most, including you. Only friends can be added, and you will be the admin.</div>
            <span class="bubble-actions is-start">
              <BaseButton small variant="primary" type="submit" :disabled="group.busy || !group.name.trim()" :reason="group.name.trim() ? null : 'Give the group a name.'">{{ group.busy ? 'Creating…' : 'Create group' }}</BaseButton>
              <BaseButton small @click="group.open = false">Cancel</BaseButton>
            </span>
          </form>

          <input v-if="me.conversations.length > 4" v-model="chatFilter" class="messages-filter" type="search" name="chatfilter" :placeholder="ui.tab === 'groups' ? 'Search your groups' : 'Search your chats'" :aria-label="ui.tab === 'groups' ? 'Search your groups' : 'Search your chats'" autocomplete="off">
          <div v-if="ui.tab === 'chats' && (unreadTotal || listMode === 'unread')" class="messages-chips" role="group" aria-label="Show">
            <button type="button" :aria-pressed="listMode === 'all'" @click="listMode = 'all'">All</button>
            <button type="button" :aria-pressed="listMode === 'unread'" @click="listMode = 'unread'">Unread<span v-if="unreadTotal" class="messages-badge is-quiet">{{ unreadTotal }}</span></button>
          </div>
          <ListRows v-if="listRows.length" :label="ui.tab === 'groups' ? 'Groups' : 'Chats'">
            <LazyList :items="listRows" :item-key="(row: Conversation | AiChatRow) => row.id" :has-more="Boolean(me.conversationsMore?.next) && !chatFilter" :loading="chatsMore" :row-height="60" :label="ui.tab === 'groups' ? 'groups' : 'chats'" :key="ui.tab" :memory="ui.tab" @more="moreChats">
            <template #row="{ item }">
            <ListRow v-if="item.kind === 'ai'" as="button" :data-agent-conv="item.chat.id" :title="item.chat.name" :sub="aiLast(item.chat.lines)" @click="openAiChat(item.chat)">
              <template #icon><span class="messages-avatar"><RowMark :name="item.chat.name" :seed="item.chat.id" /></span></template>
              <template #end><span class="messages-when"><small>{{ listTime(item.chat.at, clockNow, time) }}</small><span class="messages-ai" title="An AI plays this character">AI</span></span></template>
            </ListRow>
            <ListRow v-else as="button" :data-conv="item.id" :title="item.name" :unread="item.unread > 0" @click="openConversation(item.id)">
              <template #icon>
                <span class="messages-avatar" :class="{ 'is-online': item.kind === 'dm' && presenceOf(item.with) === 'online' }">
                  <RowMark v-if="item.kind === 'group'" :name="item.name" :seed="item.id" />
                  <RowMark v-else-if="item.kind === 'house'" round>🏠</RowMark>
                  <RowMark v-else :name="item.name" :seed="item.with ?? item.id" />
                </span>
              </template>
              <template #sub>
                <span v-if="item.kind === 'dm' && presenceOf(item.with) === 'online'" class="sr-only">Online. </span>
                <span class="messages-preview" :class="{ 'is-unread': item.unread > 0 }"><b v-if="previewOf(item, me.me.id).who">{{ previewOf(item, me.me.id).who }}: </b><span v-if="previewOf(item, me.me.id).kind === 'picture'" aria-hidden="true">📷 </span><span v-else-if="previewOf(item, me.me.id).kind === 'voice'" aria-hidden="true">🎤 </span>{{ previewOf(item, me.me.id).text }}</span>
              </template>
              <template #end>
                <span class="messages-when"><small v-if="item.last?.at" :class="{ 'is-unread': item.unread > 0 }">{{ listTime(item.last.at, clockNow, time) }}</small><span class="messages-marks"><span v-if="item.pinned" class="messages-mark" role="img" aria-label="Pinned">📌</span><span v-if="item.muted" class="messages-mark" role="img" aria-label="Muted">🔕</span><span v-if="item.mentions" class="messages-at" aria-label="You were mentioned">@</span><span v-if="item.unread" class="messages-badge" :class="{ 'is-quiet': item.muted }" :aria-label="`${item.unread} unread`">{{ item.unread }}</span></span></span>
              </template>
            </ListRow>
            </template>
            </LazyList>
          </ListRows>
          <BaseButton v-if="!chatList.length && me.conversationsMore?.next && (!chatFilter || ui.tab === 'groups')" small :disabled="chatsMore" @click="moreChats">{{ chatsMore ? 'Loading more conversations…' : 'Load more conversations' }}</BaseButton>
          <p v-if="!chatList.length && !chatsMore && !group.open && ui.tab === 'groups' && chatFilter" class="messages-note" role="status">{{ me.conversationsMore?.next ? 'No matching groups in these conversations yet. Load more to keep searching.' : 'No matching groups. Try another search or create a group.' }}</p>
          <p v-else-if="!chatList.length && !chatsMore && !group.open && ui.tab === 'groups' && groupCount > 0" class="messages-note" role="status">No matching groups.</p>
          <p v-else-if="!listRows.length && !chatsMore && !group.open && ui.tab === 'chats' && me.conversations.length" class="messages-note" role="status">No chat has that name.</p>
          <template v-if="toStart.length">
            <SectionTitle>{{ me.conversations.length ? 'Friends to message' : 'Start a chat with a friend' }}</SectionTitle>
            <ListRows label="Friends to message">
              <ListRow v-for="friend in toStart" :key="friend.id" as="button" :data-friend="friend.id" :title="friend.name" :sub="presenceOf(friend.id) === 'online' ? 'Online now. Tap to say hello' : 'Tap to say hello'" @click="startWith(friend)">
                <template #icon><span class="messages-avatar" :class="{ 'is-online': presenceOf(friend.id) === 'online' }"><RowMark :name="friend.name" :seed="friend.id" /></span></template>
                <template #end><GameIcon name="messages" :size="20" /></template>
              </ListRow>
            </ListRows>
          </template>
          <EmptyState v-if="ui.tab === 'chats' && !group.open && !me.conversations.length && !toStart.length && !aiChats.length" icon="messages" title="No chats yet" text="Tap New message to find a player, or tap someone at a venue and press Chat. You can also make a group with your friends.">
            <BaseButton @click="shell.open('people')">See who is here</BaseButton>
          </EmptyState>
          <EmptyState v-if="ui.tab === 'groups' && !group.open && !chatFilter && !chatList.length && !chatsMore && !me.conversationsMore?.next" icon="messages" title="No groups yet" text="Create a group to start a shared conversation. You can add friends now or make it just you to begin.">
            <BaseButton variant="primary" @click="newGroup">Create a group</BaseButton>
          </EmptyState>
          <div v-if="ui.tab === 'chats'" class="messages-fab"><BaseButton class="messages-new" variant="primary" :aria-expanded="finding" @click="toggleFind"><GameIcon :name="finding ? 'close' : 'plus'" :size="18" /> {{ finding ? 'Close player search' : 'New message' }}</BaseButton></div>
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
            <LazyList :items="shownLines.visible.value" :item-key="(line: UpdateLine) => line.key" :has-more="shownLines.hasMore.value" :loading="false" label="updates" @more="shownLines.more()">
            <template #row="{ item: line }">
            <div class="messages-update" :class="{ 'is-unread': line.fresh }">
              <RowMark round><GameIcon :kind="line.kind" :id="line.id" /></RowMark>
              <span class="messages-update-body"><b><GlyphText :text="line.text" /></b><small>{{ formatClock(line.at) }}{{ line.fresh ? ' · New' : '' }}</small></span>
              <BaseButton v-if="'storyHelp' in line && line.storyHelp" small @click="openStoryHelp(line.storyHelp)">Open challenge</BaseButton>
              <BaseButton v-if="line.player" small @click="shell.open('person', { player: line.player })">Say hello</BaseButton>
              <span v-if="line.conv" class="bubble-actions"><BaseButton small @click="openConversation(line.conv); ui.tab = 'chats'">Open</BaseButton><BaseButton v-if="line.leave" small variant="danger" @click="leaveFromUpdate(line.conv)">Leave</BaseButton></span>
            </div>
            </template>
            </LazyList>
          </ListRows>
          <EmptyState v-else-if="!(me.requests.in.length || me.baeRequests.length || me.house.knocks.length)" icon="bell" title="Nothing yet" :text="`Friend requests, knocks at your door, gifts, rent and loan notices, promotions, illness and news from the ${civicTitle(view.cityId)} appear here.`" />
        </div>
        <LinkButton v-if="growth.channel.value" :href="growth.channel.value" block class="messages-channel">Follow Allworld on WhatsApp</LinkButton>
      </template>
    </template>
    <Lightbox v-if="me && lightbox?.image" :id="lightbox.image.id" :me-id="me.me.id" :caption="lightbox.body" :from="lightbox.from?.name ?? ''" :mine="lightbox.from?.id === me?.me.id" @close="lightbox = null" @report="reportPicture" />
  </div>
</template>

<style scoped>
.messages-fab { position: sticky; bottom: 14px; z-index: 2; display: flex; justify-content: flex-end; margin: 12px 0 0; pointer-events: none; }
.messages-fab .messages-new { pointer-events: auto; min-height: 52px; padding: 0 20px; border-radius: 26px; box-shadow: var(--e-2, var(--e-1)); }
.messages-avatar { position: relative; display: inline-grid; }
.messages-avatar.is-online::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border: 2px solid #fff; border-radius: 50%; background: var(--c-green-dark); }
.messages-preview { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.messages-preview b { font-weight: 600; color: var(--c-ink-2); }
.messages-preview.is-unread { color: var(--c-ink); font-weight: 600; }
.messages-marks { display: flex; align-items: center; gap: 4px; min-height: 22px; }
.messages-mark { font-size: 13px; line-height: 1; }
.messages-when small.is-unread { color: var(--c-green-dark); font-weight: 700; }
.messages-chips { display: flex; gap: 8px; margin: 0 0 var(--s-2); }
.messages-chips button { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 16px; border: 1px solid var(--c-line); border-radius: 20px; background: #fff; font: 600 13px var(--font); color: var(--c-ink-2); cursor: pointer; }
.messages-chips button[aria-pressed='true'] { border-color: var(--c-green-dark); background: #eef8f1; color: var(--c-green-dark); }
.messages-chips button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.messages-pinbar { flex: none; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 0 14px; border: 0; border-bottom: 1px solid var(--c-line); background: #fff; font: 600 13px var(--font); text-align: left; color: var(--c-ink-2); cursor: pointer; }
.messages-pinbar-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.messages-pinbar small { color: var(--c-muted); }
.messages-pinbar:focus-visible { outline: var(--focus); outline-offset: -3px; }
.messages-sheet-body { padding: 18px 16px 16px; max-height: inherit; overflow-y: auto; overscroll-behavior: contain; }
.messages-sheet-done { margin-top: 10px; }
.messages-sheet-body h3 { margin: 0 0 6px; font-size: 16px; }
.messages-find-label { display: block; margin: 10px 0 6px; font-size: 14px; font-weight: 650; }
.messages-name { position: relative; display: block; max-width: 100%; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.messages-head :deep(.ui-button) { min-height: var(--tap); }
.messages-name::after { content: ''; position: absolute; inset: -10px -8px -22px; }
.messages-presence { font-weight: 700; color: var(--c-muted); }
.messages-presence::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: currentColor; vertical-align: 1px; }
.messages-presence.is-online { color: var(--c-green-dark); }
.messages-older { display: grid; gap: 6px; padding: 4px 0; font-size: 12px; color: var(--c-muted); text-align: center; }
.messages-older i { display: block; height: 28px; border-radius: 14px; background: var(--c-fill); width: 55%; }
.messages-older i + i { justify-self: end; width: 40%; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.messages-note { margin: 6px 2px; font-size: 12px; line-height: 1.45; color: var(--c-muted); }
.messages-note.is-warn { color: var(--c-red); }
.messages-note.is-inset { margin: 6px 14px; }
.messages-visit { display: flex; margin: 4px 14px 0; }
.messages-visit:empty { display: none; }
.messages-pin-preview { flex: none; display: flex; align-items: center; gap: 8px; margin: 8px 0 0; padding: 8px 10px 8px 34px; border-left: 3px solid var(--c-green-dark); background: var(--c-fill); font-size: 12px; }
.messages-pin-preview :deep(.bubble-wrap) { flex: 1; min-width: 0; }
.messages-pin-preview button { min-width: 44px; min-height: 44px; border: 0; background: none; color: var(--c-green-dark); font: 650 12px var(--font); cursor: pointer; }
.messages-link { min-height: 32px; padding: 0 4px; border: 0; background: none; color: var(--c-green-dark); font: 600 12px var(--font); text-decoration: underline; cursor: pointer; }
.messages-why { display: block; margin-top: 2px; font-size: 12px; line-height: 1.4; color: var(--c-red); }
.messages-badge { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--c-badge); color: #fff; font-size: 11px; font-weight: 700; line-height: 1; }
.messages-tabs { display: flex; gap: 0; margin: 0 0 16px; padding: 0; border-bottom: 1px solid var(--c-line); background: #fff; }
.messages-tabs button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--tap); padding: 0 10px; border: 0; border-radius: 0; border-bottom: 3px solid transparent; background: none; font: 650 14px var(--font); color: var(--c-ink-2); cursor: pointer; white-space: nowrap; }
.messages-tabs button[aria-selected='true'] { background: #fff; color: var(--c-green-dark); border-bottom-color: var(--c-green-dark); box-shadow: none; }
.messages-tabs button:focus-visible, .messages-back:focus-visible, .messages-link:focus-visible, .messages-compose button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.messages-form { display: flex; gap: 6px; margin: 8px 0; }
.messages-form input, .messages-field { flex: 1; min-width: 0; min-height: var(--tap); box-sizing: border-box; padding: 10px 14px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); background: #fff; font: inherit; font-size: 14px; }
.messages-form.is-search { margin: 0 0 var(--s-2); }
.messages-form.is-search input { border-radius: var(--r-sm); border-color: var(--c-line); background: #fff; box-shadow: var(--ring); }
.messages-field { width: 100%; margin: 4px 0; }
.messages-manage { display: grid; gap: 6px; margin: 0 0 var(--s-2); padding: var(--s-3) var(--s-4); border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; font-size: 13px; }
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

/* A short screen (a phone with its keyboard up): the header stays, the thread gets the room; pins stay in the menu and the notification question waits. */
@media (max-height: 560px) {
  .messages-pinbar, .messages-ask-notify, .messages-visit { display: none; }
  .messages-chat .messages-thread { min-height: 48px; }
  .messages-head { padding-top: 2px; padding-bottom: 2px; }
}
.messages-chat { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.messages-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 6px; background: #fff; border-bottom: 1px solid var(--c-line); }
/* !important because the sheet's own heading rule outranks a scoped class until that sheet is converted. */
.messages-head h3 { flex: 1; min-width: 0; margin: 0 !important; font-size: 15px !important; color: var(--c-ink); white-space: nowrap; }
.messages-head h3 small { display: block; overflow: hidden; text-overflow: ellipsis; font-size: 11px; font-weight: 500; color: var(--c-muted); }
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
.bubble.is-romance { display: grid; gap: 4px; justify-items: center; max-width: 90%; padding: 8px 12px; background: var(--c-fill-2); border-radius: 14px; font-size: 13px; text-align: center; }
.bubble-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin-top: 6px; }
.bubble-actions.is-start { justify-content: flex-start; }
.messages-foot { flex: none; padding: 8px 10px calc(14px + env(safe-area-inset-bottom, 0px)); background: #fff; border-top: 1px solid var(--c-line); }
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
.messages-filter { box-sizing: border-box; width: 100%; min-height: 40px; margin: 0 0 var(--s-2); padding: 6px 14px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); font: inherit; font-size: 16px; }
.messages-ai { display: inline-block; padding: 1px 6px; border-radius: 999px; background: #4338ca; color: #fff; font-size: 10px; font-weight: 700; line-height: 1.5; letter-spacing: .02em; }
.messages-at { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--c-green-dark); color: #fff; font-size: 11px; font-weight: 700; }
.messages-update > .bubble-actions { flex-basis: 100%; justify-content: flex-start; margin: -4px 0 2px; padding-left: 50px; }
.messages-badge.is-quiet { background: var(--c-muted); }
.messages-ask-notify { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; margin: 0 10px 6px; padding: 4px 6px 4px 12px; border-radius: var(--r-md); background: #eef8f1; font-size: 12px; line-height: 1.3; }
.messages-ask-notify span { flex: 1 1 150px; }
.messages-ask-notify :deep(.ui-button) { min-height: 40px; }
.messages-kebab { flex: none; min-width: var(--tap); min-height: var(--tap); border: 0; border-radius: 50%; background: none; font-size: 20px; cursor: pointer; }
.messages-switch { display: flex; align-items: center; gap: 8px; min-height: 36px; font-weight: 500; }
.messages-settings-toggle { margin-top: var(--s-3); }
:deep(.bubble-wrap.is-flash .bubble) { box-shadow: 0 0 0 3px #e8a643; transition: box-shadow .3s; }
</style>
