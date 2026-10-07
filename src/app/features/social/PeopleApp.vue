<script setup lang="ts">
// People: the tab of the Sim sheet (also the E shortcut, and an app on the Phone). Who is in this
// venue right now — real players (from the server's live presence, marked "Real player") and the
// venue's NPC regulars (each carries the NPC badge; a real player carries none) — then friends with their presence, friend
// requests, and every relationship with its closeness meter. A tap on a person opens the card.
// Every disabled control says why. All names are rendered as text.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, defineAsyncComponent, watch } from 'vue'
import { roomSummary, presenceText } from '../../../game/social-lines.ts'
import { cityName } from '../../../game/cities/registry.ts'
import type { PeopleListing } from '../../../types/social.ts'
import { linkWords } from '../../../ui/link.ts'
import BaseButton from '../../ui/BaseButton.vue'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import NpcBadge from '../../ui/NpcBadge.vue'
import ClosenessMeter from './ClosenessMeter.vue'
import FounderTag from './FounderTag.vue'
import ResidentBadge from '../locate/ResidentBadge.vue'
import GateNote from './GateNote.vue'
import PlayerAvatar from './PlayerAvatar.vue'
// The founder's view of every player: its own chunk, read only when it is shown.
const PlayersList = defineAsyncComponent(() => import('./PlayersList.vue'))
import { closenessText, presenceClass, STALE_MS, staleSteps, venueNameOf } from './socialWords.ts'
import { peopleUi } from './socialState.ts'
import { useSocialScreen } from './useSocialScreen.ts'

defineProps<{ params?: unknown }>()
const { app, game, shell, client, state, view, gate, action, runAction, retryLoad } = useSocialScreen()
const life = game.state
const social = computed(() => view.value.social)
const venue = computed(() => venueNameOf(view.value.venues, life.value.location))
const here = computed(() => social.value.here)
/** The listing, once it is for this city and this venue. */
const listing = computed<PeopleListing | null>(() => {
  const people = state.people
  return people && !('error' in people) && people.venue === life.value.location && people.cityId === view.value.cityId ? people : null
})
const summary = computed(() => {
  if (!view.value.connected) return `${linkWords(view.value)?.why ?? 'Not connected.'} The list of players cannot be checked right now.`
  if (state.people && 'error' in state.people) return `Could not check who is here: ${state.people.error}`
  return roomSummary(listing.value, venue.value)
})
// One string: a space at the start of a conditional template child is trimmed by the compiler, which glued the two sentences together.
const summaryLine = computed(() => {
  const count = here.value.length
  return count ? `${summary.value} ${count} NPC${count === 1 ? '' : 's'} (game characters) ${count === 1 ? 'is' : 'are'} around.` : summary.value
})
const venueName = (id: string): string => venueNameOf(view.value.venues, id)
/** A friend in another city reads "in <city>": the reader's own city is what that is judged against. */
const place = computed(() => ({ cityId: view.value.cityId, cityName: (id: string) => cityName(id) ?? id }))
const presence = (friend: { status?: string; seenAt?: number; venue?: string; cityId?: string; going?: string; journey?: string }): string => presenceText(friend, venueName, view.value.now, place.value)

// The listing is read when the place or the action changes, and again when it is 20 seconds old.
// Server time moves with every poll, so nothing here needs a timer.
const loadKey = computed(() => `${view.value.cityId}:${life.value.location}:${Boolean(life.value.activeAction)}`)
watch([loadKey, () => staleSteps(view.value.now, state.peopleAt), () => view.value.connected], () => {
  if (view.value.connected && (loadKey.value !== peopleUi.loadedFor || view.value.now - state.peopleAt >= STALE_MS)) { peopleUi.loadedFor = loadKey.value; void client.loadPeople() }
}, { immediate: true })

const answer = async (from: string, accept: boolean): Promise<void> => {
  await client.perform('/api/social/friends/answer', { from, accept, cityId: client.cityId() }, accept ? 'You are now friends' : null)
  client.refreshLife()
}
const unblock = (id: string): Promise<unknown> => client.perform('/api/social/unblock', { id }, 'Unblocked')
function openVenueChat(): void { shell.close(); app.community.toggle(true) }
</script>

<template>
  <div class="people">
    <div class="social-head"><h3>Here at {{ venue }}</h3><button type="button" class="social-btn" :disabled="!view.connected" @click="client.loadPeople()">Refresh</button></div>
    <p class="social-note">{{ summaryLine }}</p>
    <div v-if="listing?.players.length || here.length" class="social-cards">
      <button v-for="player in listing?.players ?? []" :key="`p${player.id}`" type="button" class="social-card" @click="shell.open('person', { player: player.id, name: player.name })">
        <PlayerAvatar :name="player.name" :seed="player.id" status="online" /><strong>{{ player.name }}<FounderTag v-if="player.founder" /><ResidentBadge :id="player.id" /></strong><small class="is-player">Real player{{ player.friend ? ' · Friend' : '' }}</small>
      </button>
      <button v-for="npc in here" :key="`n${npc.id}`" type="button" class="social-card" @click="shell.open('person', { npc: npc.id })">
        <span class="social-avatar" aria-hidden="true"><PlayerAvatar :name="npc.name" :seed="npc.id" /></span><strong>{{ npc.name }}</strong><small><NpcBadge lead />{{ npc.role }}</small>
      </button>
    </div>
    <button v-for="npc in social.away" :key="`a${npc.id}`" type="button" class="social-btn is-away" @click="shell.open('person', { npc: npc.id })">{{ npc.name }} · {{ npc.where }}</button>
    <button v-if="life.location !== 'home' && view.connected" type="button" class="social-btn" @click="openVenueChat">Open venue chat</button>

    <h3 class="ui-section">Friends</h3>
    <GateNote v-if="gate" :gate="gate" :action="action?.label ?? null" @action="runAction" @retry="retryLoad" />
    <template v-else-if="state.me">
      <div v-if="state.me.requests.in.length || state.me.friends.length" class="social-list">
        <div v-for="request in state.me.requests.in" :key="`r${request.id}`" class="social-row is-ask">
          <PlayerAvatar :name="request.name" :seed="request.id" />
          <div><strong>{{ request.name }}</strong><small>wants to be friends</small></div>
          <span class="social-actions"><button type="button" class="social-btn is-primary" @click="answer(request.id, true)">Accept</button><button type="button" class="social-btn" @click="answer(request.id, false)">Decline</button></span>
        </div>
        <div v-for="friend in state.me.friends" :key="`f${friend.id}`" class="social-row">
          <PlayerAvatar :name="friend.name" :seed="friend.id" :status="friend.status" />
          <div>
            <strong>{{ friend.name }}<FounderTag v-if="friend.founder" /><ResidentBadge :id="friend.id" /><template v-if="friend.bae"> <GameIcon name="heart" inline /><span class="sr-only">your Bae</span></template></strong>
            <small class="social-presence" :class="`is-${presenceClass(friend.status)}`">{{ presence(friend) }}</small>
          </div>
          <span class="social-actions"><button type="button" class="social-btn is-primary" @click="shell.open('messages', { to: friend.id, name: friend.name })">Chat</button><button type="button" class="social-btn" @click="shell.open('person', { player: friend.id, name: friend.name })">View</button></span>
        </div>
      </div>
      <template v-if="state.me.friendsMore">
        <h3 class="ui-section">Players</h3>
        <PlayersList />
      </template>
      <EmptyState v-if="!state.me.friends.length && !state.me.friendsMore" icon="hand" title="No friends yet" text="Go to places around town, greet people, and add the players you meet.">
        <BaseButton @click="shell.open('map')">Find somewhere to go</BaseButton>
      </EmptyState>
      <p v-if="state.me.requests.out.length" class="social-note">Waiting for an answer from: {{ state.me.requests.out.map((request) => request.name).join(', ') }}</p>
      <template v-if="state.me.blocked.length">
        <h3>Blocked</h3>
        <div v-for="player in state.me.blocked" :key="player.id" class="social-row">
          <div><strong>{{ player.name }}</strong><small>Cannot message, invite or see you</small></div>
          <span class="social-actions"><button type="button" class="social-btn" @click="unblock(player.id)">Unblock</button></span>
        </div>
      </template>
    </template>

    <h3 class="ui-section">Relationships</h3>
    <div v-if="social.relationships.length" class="social-list">
      <div v-for="rel in social.relationships" :key="rel.id" class="social-row">
        <span class="social-avatar" aria-hidden="true"><PlayerAvatar :name="rel.name" :seed="rel.id" /></span>
        <div>
          <strong>{{ rel.name }}</strong><small><NpcBadge v-if="rel.npc" lead />{{ rel.role }} · {{ closenessText(rel, social.maxCloseness) }}<template v-if="rel.where"> · {{ rel.where }}</template></small>
          <ClosenessMeter :points="rel.points" :max="rel.next ? rel.next.min : social.maxCloseness" :label="`Closeness with ${rel.name}`" />
        </div>
      </div>
    </div>
    <EmptyState v-else icon="handshake" title="Nobody yet" text="Say hello to an NPC at a venue to start." />
    <p class="preview-note">Closeness tiers (Acquaintance 5, Friend 20, Paddy Mi 40) and points are original beta values. {{ social.paddyCount }} Paddy Mi so far.</p>
  </div>
</template>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
