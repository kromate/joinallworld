<script setup lang="ts">
// Contacts: Mummy (who can always be called), the saved contacts — the NPCs you have met and your
// friends — and Find a player. All names are rendered as text.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed } from 'vue'
import { presenceText } from '../../../game/social-model.ts'
import { cityName } from '../../../game/cities/registry.ts'
import type { SearchResult } from '../../../types/social.ts'
import BaseButton from '../../ui/BaseButton.vue'
import EmptyState from '../../ui/EmptyState.vue'
import CallButton from './CallButton.vue'
import FounderTag from './FounderTag.vue'
import GateNote from './GateNote.vue'
import PlayerAvatar from './PlayerAvatar.vue'
import { callNote, presenceClass, venueNameOf } from './socialModel.ts'
import { contactsUi } from './socialState.ts'
import { useSocialScreen } from './useSocialScreen.ts'

defineProps<{ params?: unknown }>()
const { game, shell, client, state, view, gate, action, runAction, retryLoad, cannot } = useSocialScreen()
const social = computed(() => view.value.social)
// The earlier panel read `mummy.name` unchecked, so a life whose family list had no contact threw and showed its
// error line. Here the card is left out instead (tested in socialComponents.test.ts).
const mummy = computed(() => social.value.family.find((member) => member.contact) ?? null)
const met = computed(() => social.value.relationships.filter((rel) => rel.npc))
const note = computed(() => callNote({ connected: view.value.connected, cannot: cannot('call'), busy: Boolean(game.state.value.activeAction) }))
const venueName = (id: string): string => venueNameOf(view.value.venues, id)
/** A friend in another city reads "in <city>": the reader's own city is what that is judged against. */
const place = computed(() => ({ cityId: view.value.cityId, cityName: (id: string) => cityName(id) ?? id }))
const results = computed<SearchResult[] | null>(() => (contactsUi.results && !('error' in contactsUi.results) ? contactsUi.results : null))
const resultError = computed(() => (contactsUi.results && 'error' in contactsUi.results ? contactsUi.results.error : null))

async function find(): Promise<void> {
  contactsUi.find = contactsUi.find.trim()
  if (contactsUi.find.length < 2) { contactsUi.results = { error: 'Type at least two letters of their name.' }; return }
  contactsUi.finding = true
  const result = await client.call<{ results: SearchResult[] }>(`/api/social/search?q=${encodeURIComponent(contactsUi.find)}`)
  contactsUi.finding = false
  contactsUi.results = result.ok ? result.results : { error: result.reason }
}
</script>

<template>
  <div class="contacts">
    <div v-if="mummy" class="social-list contacts-fav">
      <div class="social-row">
        <span class="social-avatar is-big" aria-hidden="true"><PlayerAvatar :name="mummy.name" :seed="mummy.id" /></span>
        <div><strong>{{ mummy.name }}</strong><small>{{ mummy.line }}{{ mummy.calledToday ? ' · checked in today' : '' }}</small></div>
        <span class="social-actions"><CallButton :member="mummy" /></span>
      </div>
    </div>
    <p v-if="note" class="ui-why">{{ note }}</p>

    <h3 class="ui-section">Find a player</h3>
    <form class="social-form is-search" @submit.prevent="find">
      <input v-model="contactsUi.find" name="q" maxlength="36" placeholder="Player name" aria-label="Find a player by name" autocomplete="off" :disabled="!view.connected">
      <button type="submit" class="social-btn" :disabled="!view.connected || contactsUi.finding">Find</button>
    </form>
    <span v-if="!view.connected" class="social-why">{{ cannot('search') }}</span>
    <div v-if="contactsUi.finding || resultError !== null || contactsUi.results" class="social-list">
      <p v-if="contactsUi.finding" class="social-note" role="status">Searching…</p>
      <p v-else-if="resultError !== null" class="social-note is-warn" role="alert">{{ resultError }}</p>
      <template v-else-if="results?.length">
        <div v-for="player in results" :key="player.id" class="social-row">
          <PlayerAvatar :name="player.name" :seed="player.id" />
          <div><strong>{{ player.name }}<FounderTag v-if="player.founder" /></strong><small>Real player{{ player.friend ? ' · Friend' : '' }} · #{{ player.id.slice(0, 6) }}</small></div>
          <span class="social-actions"><button type="button" class="social-btn" @click="shell.open('person', { player: player.id, name: player.name })">View</button></span>
        </div>
      </template>
      <p v-else class="social-note">Nobody found with that name.</p>
    </div>

    <h3 class="ui-section">Saved contacts</h3>
    <GateNote v-if="gate" :gate="gate" :action="action?.label ?? null" @action="runAction" @retry="retryLoad" />
    <div v-if="(!gate && state.me?.friends.length) || met.length" class="social-list">
      <template v-if="!gate && state.me">
        <div v-for="friend in state.me.friends" :key="`f${friend.id}`" class="social-row">
          <PlayerAvatar :name="friend.name" :seed="friend.id" :status="friend.status" />
          <div><strong>{{ friend.name }}<FounderTag v-if="friend.founder" /></strong><small class="social-presence" :class="`is-${presenceClass(friend.status)}`">Friend · {{ presenceText(friend, venueName, view.now, place) }}</small></div>
          <span class="social-actions"><button type="button" class="social-btn is-primary" @click="shell.open('messages', { to: friend.id, name: friend.name })">Chat</button></span>
        </div>
      </template>
      <div v-for="rel in met" :key="`n${rel.id}`" class="social-row">
        <span class="social-avatar" aria-hidden="true"><PlayerAvatar :name="rel.name" :seed="rel.id" /></span>
        <div><strong>{{ rel.name }}</strong><small>{{ rel.role }} · NPC · {{ rel.tierLabel }}</small></div>
        <span class="social-actions"><button type="button" class="social-btn" @click="shell.open('person', { npc: rel.id })">View</button></span>
      </div>
    </div>
    <EmptyState v-if="!met.length && !state.me?.friends.length" icon="contacts" title="No saved contacts yet" text="Meet people around town to save their numbers.">
      <BaseButton @click="shell.open('map')">Open the map</BaseButton>
    </EmptyState>
    <p class="preview-note">Names are not unique: check the short code after # when two players share a name.</p>
  </div>
</template>
