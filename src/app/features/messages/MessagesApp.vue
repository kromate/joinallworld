<script setup lang="ts">
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
import type { Conversation, GroupUpdateBody, SearchResult } from '../../../types/social.ts'
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
import { noticeMarks, showConversation, takeDraft, ui } from './messagesState.ts'
import { isOutbox, lastLine, provisionalKey, readOnlyReason, targetOf, threadKind, threadTitle, unreadChats, updateLines, updatesCount } from './messagesModel.ts'

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
  if (key) void nextTick(() => draftField.value?.focus())
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
const readOnly = computed(() => (ui.open && me.value ? readOnlyReason(ui.open, me.value, connected.value ? null : linkWords(view.value)?.cannot('send messages') ?? 'Not connected.') : null))
const isGroup = computed(() => Boolean(conv.value) && conv.value?.kind !== 'dm')
const addable = computed(() => (me.value?.friends ?? []).filter((friend) => !conv.value?.members.some((member) => member.id === friend.id)))
const threadBox = ref<HTMLElement | null>(null)
const draftField = ref<HTMLInputElement | null>(null)
// A new line, or a line changing from sending to sent: keep the newest in view.
watch(items, () => { void nextTick(() => { const box = threadBox.value; if (box) box.scrollTop = box.scrollHeight }) }, { flush: 'post' })

function openConversation(key: string): void { setOpen(key); void openThread(key) }
const rootBox = ref<HTMLElement | null>(null)
/** Back to the list. The keyboard goes to the conversation that was open, so it is never left on nothing. */
function back(): void {
  const was = ui.open
  setOpen(null); void sync()
  void nextTick(() => { const list = rootBox.value; (Array.from(list?.querySelectorAll<HTMLElement>('[data-conv]') ?? []).find((row) => row.dataset.conv === was) ?? list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus() })
}
function reloadThread(): void { const current = ui.open ? social.threads.get(ui.open) : undefined; if (current && ui.open) { current.error = null; void openThread(ui.open) } }
function submitDraft(): void {
  const key = ui.open
  if (!key || readOnly.value) return
  const body = takeDraft()
  if (!body) return
  // Shows at once as "Sending…"; the outbox turns it into sent, or failed with a Retry.
  send(key, targetOf(key), body)
  draftField.value?.focus()
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
const group = reactive<{ open: boolean; name: string; members: string[]; clientId: string; busy: boolean }>({ open: false, name: '', members: [], clientId: '', busy: false })
function newGroup(): void { Object.assign(group, { open: true, name: '', members: [], clientId: newClientId() }) }
async function createGroup(): Promise<void> {
  if (group.busy) return
  group.busy = true
  // One client id per group form, reused on a retry, so a retry cannot create it twice.
  const result = await perform<{ conv: Conversation }>('/api/social/groups', { name: group.name, members: group.members, clientId: group.clientId }, 'Group created')
  group.busy = false
  if (result.ok) { group.open = false; openConversation(result.conv.id) }
}
const rename = ref('')
watch(() => [ui.manage, conv.value?.name] as const, () => { rename.value = conv.value?.name ?? '' }, { immediate: true })
async function updateGroup(body: GroupUpdateBody): Promise<void> {
  const key = ui.open
  if (!key) return
  const result = await perform(`/api/social/groups/${encodeURIComponent(key)}`, body)
  if (result.ok && body.op === 'leave') { social.threads.delete(key); setOpen(null) } else void openThread(key)
}

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
          <RowMark v-if="conv?.kind === 'group'" round>👥</RowMark>
          <RowMark v-else-if="ui.open.startsWith('h.')" round>🏠</RowMark>
          <RowMark v-else :name="title" :seed="conv?.with ?? ui.open" />
          <h3>{{ title }}<small>{{ threadKind(conv) }}</small></h3>
          <BaseButton v-if="conv?.kind === 'group'" small :aria-expanded="ui.manage" @click="ui.manage = !ui.manage">{{ ui.manage ? 'Done' : 'Members' }}</BaseButton>
        </header>
        <div v-if="conv?.kind === 'house'" class="messages-note is-inset">House chat: only the host and the guests inside can read this.</div>

        <section v-if="conv?.kind === 'group' && ui.manage" class="messages-manage" aria-label="Group members">
          <ul>
            <li v-for="member in conv.members" :key="member.id">
              {{ member.name }}<template v-if="member.id === conv.owner"> (runs the group)</template>
              <button v-if="conv.owner === me.me.id && member.id !== me.me.id" class="messages-link" type="button" @click="updateGroup({ op: 'remove', id: member.id })">Remove</button>
            </li>
          </ul>
          <template v-if="conv.owner === me.me.id">
            <form class="messages-form" @submit.prevent="updateGroup({ op: 'rename', name: rename })">
              <input v-model="rename" name="name" :maxlength="me.limits.groupName" aria-label="Group name" required>
              <BaseButton small type="submit">Rename</BaseButton>
            </form>
            <div v-if="addable.length && conv.members.length < me.limits.groupSize" class="messages-add">
              <BaseButton v-for="friend in addable" :key="friend.id" small @click="updateGroup({ op: 'add', id: friend.id })">+ {{ friend.name }}</BaseButton>
            </div>
            <div v-else class="messages-note">{{ conv.members.length >= me.limits.groupSize ? `This group is full (${me.limits.groupSize} people).` : 'Only your friends can be added, and all of them are already here.' }}</div>
          </template>
          <div v-else class="messages-note">Only the person who runs the group can rename it or change members.</div>
          <BaseButton small variant="danger" @click="updateGroup({ op: 'leave' })">Leave group</BaseButton>
        </section>

        <div ref="threadBox" class="messages-thread" aria-live="polite">
          <template v-if="conv && !thread?.loaded">
            <div v-if="thread?.error" class="messages-note is-warn">{{ thread.error }} <button class="messages-link" type="button" @click="reloadThread">Retry</button></div>
            <div v-else class="messages-note">Loading messages…</div>
          </template>
          <div v-else-if="!items.length" class="messages-note">No messages yet. Say something.</div>
          <template v-for="item in items" v-else :key="isOutbox(item) ? `o:${item.clientId}` : `m:${item.seq}`">
            <div v-if="isOutbox(item)" class="bubble is-mine" :class="item.status === 'failed' ? 'is-failed' : 'is-pending'">
              <span>{{ item.body }}</span>
              <small>{{ item.status === 'failed' ? `Not sent · ${item.reason}` : 'Sending…' }}</small>
              <span v-if="item.status === 'failed'" class="bubble-actions">
                <BaseButton small variant="primary" @click="retry(item.clientId)">Retry</BaseButton>
                <BaseButton small @click="discard(item.clientId)">Delete</BaseButton>
              </span>
            </div>
            <div v-else-if="item.sys" class="bubble is-sys">{{ item.body }}</div>
            <div v-else class="bubble" :class="{ 'is-mine': item.from?.id === me.me.id }">
              <b v-if="isGroup && item.from?.id !== me.me.id">{{ item.from?.name }}</b>
              <span>{{ item.body }}</span>
              <small>{{ time(item.at) }}<template v-if="item.from?.id === me.me.id"> · Sent</template></small>
            </div>
          </template>
        </div>

        <footer class="messages-foot">
          <span v-if="readOnly" class="messages-why">{{ readOnly }}</span>
          <form class="messages-compose" @submit.prevent="submitDraft">
            <input ref="draftField" v-model="ui.draft" name="body" :maxlength="me.limits.body" autocomplete="off" placeholder="Message" aria-label="Message" :disabled="Boolean(readOnly)">
            <button type="submit" aria-label="Send" title="Send" :disabled="Boolean(readOnly) || !ui.draft.trim()"><GameIcon name="earn" :size="22" /></button>
          </form>
        </footer>
      </div>

      <!-- The lists -->
      <template v-else>
        <div class="messages-tabs" role="tablist">
          <button role="tab" type="button" :aria-selected="ui.tab === 'chats'" @click="showTab('chats')">Chats<span v-if="chats" class="messages-badge">{{ chats }}</span></button>
          <button role="tab" type="button" :aria-selected="ui.tab === 'updates'" @click="showTab('updates')">Updates<span v-if="updates" class="messages-badge">{{ updates }}</span></button>
        </div>

        <div v-if="ui.tab === 'chats'" role="tabpanel">
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
            <div v-if="me.friends.length" class="messages-checks">
              <label v-for="friend in me.friends" :key="friend.id"><input v-model="group.members" type="checkbox" name="member" :value="friend.id"> {{ friend.name }}</label>
            </div>
            <div v-else class="messages-note">Groups are for friends. Add a friend first, then create a group.</div>
            <div class="messages-note">Up to {{ me.limits.groupSize }} people including you.</div>
            <span class="bubble-actions is-start">
              <BaseButton small variant="primary" type="submit" :disabled="group.busy" :reason="me.friends.length ? null : 'You need at least one friend to create a group.'">{{ group.busy ? 'Creating…' : 'Create group' }}</BaseButton>
              <BaseButton small @click="group.open = false">Cancel</BaseButton>
            </span>
            <span v-if="!me.friends.length" class="messages-why">You need at least one friend to create a group.</span>
          </form>

          <ListRows v-if="me.conversations.length" label="Chats">
            <ListRow v-for="item in me.conversations" :key="item.id" as="button" :data-conv="item.id" :title="item.name" :sub="lastLine(item, me.me.id)" :unread="item.unread > 0" @click="openConversation(item.id)">
              <template #icon>
                <RowMark v-if="item.kind === 'group'" round>👥</RowMark>
                <RowMark v-else-if="item.kind === 'house'" round>🏠</RowMark>
                <RowMark v-else :name="item.name" :seed="item.with ?? item.id" />
              </template>
              <template #end>
                <span class="messages-when"><small v-if="item.last?.at">{{ time(item.last.at) }}</small><span v-if="item.unread" class="messages-badge" :aria-label="`${item.unread} unread`">{{ item.unread }}</span></span>
              </template>
            </ListRow>
          </ListRows>
          <EmptyState v-else icon="messages" title="No chats yet" text="Find a player by name above, or tap someone at a venue and press Chat.">
            <BaseButton @click="shell.open('people')">See who is here</BaseButton>
          </EmptyState>
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
            </div>
          </ListRows>
          <EmptyState v-else-if="!(me.requests.in.length || me.baeRequests.length || me.house.knocks.length)" icon="bell" title="Nothing yet" text="Friend requests, knocks at your door, gifts, rent and loan notices, promotions, illness and news from the Governor appear here." />
        </div>
        <LinkButton v-if="growth.channel.value" :href="growth.channel.value" block class="messages-channel">Follow Allworld on WhatsApp</LinkButton>
      </template>
    </template>
  </div>
</template>

<style scoped>
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
.messages-update { display: flex; align-items: flex-start; gap: 12px; min-height: 56px; padding: 9px 14px; border-bottom: 1px solid var(--c-line); }
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
</style>
