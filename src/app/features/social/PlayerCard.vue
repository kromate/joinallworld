<script setup lang="ts">
// A real player's card: Chat, Add friend, the interactions you can have when you are in the same
// venue, Ask to be my Bae, Send money, Block and Report. Every disabled control says why, and
// every write goes through the social client (which re-reads the overview and this card after).
// A money gift carries one client id from the moment its form opens, so a double tap or a retry
// cannot send it twice.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, onMounted, watch } from 'vue'
import { presenceText } from '../../../game/social-model.ts'
import { cityName } from '../../../game/cities/registry.ts'
import type { PersonCard } from '../../../types/social.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { NUDGE_SENTENCE, nudgeControl } from '../growth/comebackModel.ts'
import { useGrowth } from '../growth/useGrowth.ts'
import ClosenessMeter from './ClosenessMeter.vue'
import FounderTag from './FounderTag.vue'
import GateNote from './GateNote.vue'
import PlayerAvatar from './PlayerAvatar.vue'
import PersonCallButton from '../calls/PersonCallButton.vue'
import type { SocialResult } from './socialClient.ts'
import { baeReason, friendControl, interactReason, moneyCeiling, moneyReason } from './personModel.ts'
import { closenessText, presenceClass, reasonLabel, STRANGER_TEXT, tagLabel, venueNameOf } from './socialModel.ts'
import { personUi } from './socialState.ts'
import { useSocialScreen } from './useSocialScreen.ts'

const props = defineProps<{ id: string }>()
const { game, shell, client, state, view, gate, action, runAction, retryLoad } = useSocialScreen()
const cityId = (): string => client.cityId()
const growth = useGrowth()
onMounted(() => { void growth.load() })

/** Opening the card for another player starts clean; the same player keeps an open form. */
watch([() => props.id, () => view.value.connected], ([id, connected]) => {
  if (!connected) return
  if (personUi.player !== id) {
    personUi.player = id; personUi.form = null; personUi.amount = ''; personUi.text = ''
    state.profiles.delete(id); void client.loadProfile(id); void client.loadPeople()
  }
}, { immediate: true })
// A card that is not here (never read, or dropped when a friendship changed) is read again.
watch([() => props.id, () => state.profiles.has(props.id), () => view.value.connected], ([id, has, connected]) => {
  if (connected && !has && personUi.player === id) void client.loadProfile(id)
}, { immediate: true })

const profile = computed(() => state.profiles.get(props.id) ?? null)
const card = computed<PersonCard | null>(() => (profile.value && !('error' in profile.value) ? profile.value : null))
const profileError = computed(() => (profile.value && 'error' in profile.value ? profile.value.error : null))
const social = computed(() => view.value.social)
const rel = computed(() => social.value.relationships.find((item) => item.id === props.id))
const points = computed(() => Math.floor(rel.value?.points ?? 0))
const listing = computed(() => (state.people && !('error' in state.people) ? state.people : null))
const together = computed(() => Boolean(listing.value?.players.some((player) => player.id === props.id)) && listing.value?.venue === game.state.value.location && game.state.value.location !== 'home')
const left = computed(() => (rel.value ? rel.value.left : social.value.dailyInteractions))
const venueName = (id: string): string => venueNameOf(view.value.venues, id)
/** A friend in another city reads "in <city>": the reader's own city is what that is judged against. */
const place = computed(() => ({ cityId: view.value.cityId, cityName: (id: string) => cityName(id) ?? id }))
const whyAct = computed(() => (card.value ? interactReason({ card: card.value, together: together.value, left: left.value, daily: social.value.dailyInteractions, busy: personUi.busy }) : null))
const whyBae = computed(() => (card.value ? baeReason({ card: card.value, social: social.value, meBae: Boolean(state.me?.bae), points: points.value }) : null))
const whyMoney = computed(() => (card.value ? moneyReason(card.value, social.value.transfer) : null))
const friend = computed(() => (card.value ? friendControl(card.value) : 'none'))
const t = computed(() => social.value.transfer)
const nudge = computed(() => (card.value ? nudgeControl({ self: card.value.self, friend: card.value.friend, blocked: card.value.blocked, name: card.value.name, status: card.value.status, seenAt: card.value.seenAt, now: view.value.now,
  nudgedAt: growth.state.hello?.contact.comeback.nudged[props.id] ?? null, busy: personUi.busy }) : null))
/** Ask an away friend to come back. The answer is the same sentence whether or not they have an address. */
async function sendNudge(): Promise<void> {
  if (personUi.busy) return
  personUi.busy = true
  const result = await growth.call<{ ok: boolean; reason?: string }>('/api/growth/nudge', { to: props.id })
  personUi.busy = false
  game.toast(result.ok ? NUDGE_SENTENCE : ('reason' in result && result.reason) || 'That could not be sent.', result.ok ? 'good' : 'error')
  await growth.load({ force: true })
}

/** One write: the card says "Working…" meanwhile, and is read again after. */
async function run<T = Record<string, unknown>>(path: string, body: unknown, good: string | ((done: { ok: true } & T) => string)): Promise<SocialResult<T>> {
  personUi.busy = true
  const result = await client.perform<T>(path, body, good)
  personUi.busy = false
  await client.loadProfile(props.id)
  return result
}
const name = (): string => (card.value ? card.value.name : 'this player')
async function interact(actionId: string): Promise<void> {
  const result = await run<{ message: string }>(`/api/social/players/${encodeURIComponent(props.id)}/interact`, { action: actionId, cityId: cityId(), clientId: client.newClientId() }, (done) => done.message)
  if (result.ok) client.refreshLife(); else void client.loadPeople()
}
function openForm(form: 'money' | 'report' | null): void { personUi.form = form; personUi.clientId = client.newClientId() }
const actions: Record<string, () => Promise<unknown>> = {
  friend: () => run<{ code: string }>('/api/social/friends/request', { to: props.id, cityId: cityId() }, (done) => (done.code === 'accepted' ? 'You are now friends' : 'Friend request sent')),
  accept: () => run('/api/social/friends/answer', { from: props.id, accept: true, cityId: cityId() }, 'You are now friends'),
  unfriend: () => run('/api/social/friends/remove', { id: props.id, cityId: cityId() }, 'Removed from friends'),
  block: () => run('/api/social/block', { id: props.id, cityId: cityId() }, `Blocked ${name()}`),
  unblock: () => run('/api/social/unblock', { id: props.id }, 'Unblocked'),
  bae: () => run('/api/social/bae/ask', { id: props.id, cityId: cityId() }, 'Asked. They will see it in Updates.'),
  'bae-end': () => run('/api/social/bae/end', { cityId: cityId() }, 'Ended'),
}
async function doAction(key: string): Promise<void> {
  if (personUi.busy) return
  await actions[key]?.()
  client.refreshLife()
}
async function sendMoney(): Promise<void> {
  if (personUi.busy) return
  const amount = Number(personUi.amount)
  if (!Number.isSafeInteger(amount) || amount <= 0) { game.toast('Enter a whole amount in naira.', 'error'); return }
  // The client id is fixed when the form opens, so a double tap or a retry cannot send twice.
  const result = await run<{ amount: number; to: { name: string }; duplicate?: boolean }>('/api/social/transfers', { to: props.id, amount, cityId: cityId(), clientId: personUi.clientId }, (done) => `Sent ${money(done.amount)} to ${done.to.name}${done.duplicate ? ' (already sent)' : ''}`)
  if (result.ok || !result.transport) { personUi.form = result.ok ? null : personUi.form; personUi.clientId = client.newClientId(); if (result.ok) personUi.amount = '' }
  client.refreshLife()
}
async function sendReport(): Promise<void> {
  if (personUi.busy) return
  const result = await run<{ receipt: { id: string } }>('/api/social/reports', { id: props.id, reason: personUi.reason, text: personUi.text.trim() }, (done) => `Report ${done.receipt.id} received`)
  if (result.ok) { personUi.form = null; personUi.text = '' }
}
</script>

<template>
  <GateNote v-if="gate" :gate="gate" :action="action?.label ?? null" @action="runAction" @retry="retryLoad" />
  <p v-else-if="!profile" class="social-note">Loading player…</p>
  <template v-else-if="profileError !== null">
    <p class="social-note is-warn">{{ profileError }}</p>
    <button type="button" class="social-btn" @click="state.profiles.delete(id)">Retry</button>
  </template>
  <p v-else-if="card?.self">This is you, {{ card.name }}.</p>
  <div v-else-if="card" :data-c-player="id">
    <div class="social-head people-who"><PlayerAvatar :name="card.name" :seed="id" :status="card.status" /><h3>{{ card.name }}<FounderTag v-if="card.founder" /></h3></div>
    <p>Real player · <span class="social-presence" :class="`is-${presenceClass(card.status)}`">{{ presenceText(card, venueName, view.now, place) }}</span><template v-if="together"> · here with you</template><template v-if="card.bae"> · your Bae <GameIcon name="heart" inline /></template><template v-else-if="card.friend"> · Friend</template></p>
    <button type="button" class="ui-button is-primary is-block" :disabled="card.blocked" @click="shell.open('messages', { to: id, name: card.name })">Chat</button>
    <span v-if="card.blocked" class="social-why">Unblock this player to chat.</span>
    <PersonCallButton :id="id" :name="card.name" :status="card.status" :blocked="card.blocked" />
    <template v-if="nudge">
      <button type="button" class="ui-button is-block player-nudge" data-nudge :disabled="nudge.disabled" @click="sendNudge"><GameIcon name="heart" inline /> {{ nudge.label }}</button>
      <span class="player-nudge-note">{{ nudge.reason ?? 'Ask them to come back to Allworld.' }}</span>
    </template>
    <p>{{ rel ? closenessText(rel, social.maxCloseness) : STRANGER_TEXT }}</p>
    <ClosenessMeter :points="points" :max="social.baeUnlock" :label="`Closeness with ${card.name}`" />
    <div class="social-grid">
      <button v-for="move in social.playerActions" :key="move.id" type="button" class="social-act" :disabled="Boolean(whyAct)" @click="interact(move.id)">
        <strong><GameIcon kind="npc-action" :id="move.id" :emoji="move.icon" inline /> {{ move.label }}</strong>
        <small>{{ move.tags.map(tagLabel).join(' ') }}<template v-if="move.success"> · may flop</template></small>
      </button>
    </div>
    <span v-if="whyAct" class="social-why">{{ whyAct }}</span>
    <div class="social-grid">
      <button v-if="card.bae" type="button" class="social-act" :disabled="personUi.busy" @click="doAction('bae-end')"><strong><GameIcon name="heart-off" inline /> End things</strong><small>Stop being Bae</small></button>
      <button v-else type="button" class="social-act" :disabled="Boolean(whyBae) || personUi.busy" @click="doAction('bae')"><strong><GameIcon name="heart" inline /> Ask to be my Bae</strong><small>{{ whyBae || 'Ask them now' }}</small></button>
      <button type="button" class="social-act" :disabled="Boolean(whyMoney)" @click="openForm('money')"><strong><GameIcon name="coin" inline /> Send money</strong><small>{{ whyMoney || `Up to ${money(moneyCeiling(t))} now` }}</small></button>
    </div>
    <form v-if="personUi.form === 'money'" class="ui-card" @submit.prevent="sendMoney">
      <label>Amount to send (₦{{ t.min }}–₦{{ moneyCeiling(t) }})<input v-model="personUi.amount" class="social-field" name="amount" inputmode="numeric" pattern="[0-9]*" maxlength="5" required></label>
      <p class="social-note">Gifts are capped: {{ money(t.maxPerTransfer) }} each, {{ t.dailyCount }} a day, and never more than you have earned from work. You have {{ money(game.state.value.cash) }}.</p>
      <span class="social-actions"><button type="submit" class="social-btn is-primary" :disabled="personUi.busy">{{ personUi.busy ? 'Sending…' : 'Send' }}</button><button type="button" class="social-btn" @click="openForm(null)">Cancel</button></span>
    </form>
    <form v-else-if="personUi.form === 'report' && state.me" class="ui-card" @submit.prevent="sendReport">
      <label>What is wrong?
        <select v-model="personUi.reason" class="social-field" name="reason"><option v-for="reason in state.me.limits.reasons" :key="reason" :value="reason">{{ reasonLabel(reason) }}</option></select>
      </label>
      <label>Details (optional)<input v-model="personUi.text" class="social-field" name="text" :maxlength="state.me.limits.reportText"></label>
      <p class="social-note">A moderator reviews reports. You get a receipt in Messages → Updates.</p>
      <span class="social-actions"><button type="submit" class="social-btn is-primary" :disabled="personUi.busy">Send report</button><button type="button" class="social-btn" @click="openForm(null)">Cancel</button></span>
    </form>
    <span class="social-actions">
      <button v-if="friend === 'unfriend'" type="button" class="social-btn" :disabled="personUi.busy" @click="doAction('unfriend')">Remove friend</button>
      <button v-else-if="friend === 'accept'" type="button" class="social-btn is-primary" :disabled="personUi.busy" @click="doAction('accept')">Accept friend request</button>
      <button v-else-if="friend === 'sent'" type="button" class="social-btn" disabled>Friend request sent</button>
      <button v-else-if="friend === 'add'" type="button" class="social-btn" :disabled="personUi.busy" @click="doAction('friend')">Add friend</button>
      <button v-if="card.blocked" type="button" class="social-btn" :disabled="personUi.busy" @click="doAction('unblock')">Unblock</button>
      <button v-else type="button" class="social-btn is-danger" :disabled="personUi.busy" @click="doAction('block')">Block</button>
      <button type="button" class="social-btn is-danger" @click="openForm('report')">Report</button>
    </span>
    <p class="preview-note">Blocking removes you from each other’s lists and stops messages, invites and friend requests. Closeness numbers are original beta values.</p>
  </div>
</template>

<style scoped>
/* The third full-width button under Chat and Call, with the same gap; its line of explanation is quiet, not an error. */
.player-nudge { margin-top: 8px; }
.player-nudge-note { display: block; margin: 4px 2px 0; font-size: 12px; line-height: 1.4; color: var(--c-muted); }
</style>
