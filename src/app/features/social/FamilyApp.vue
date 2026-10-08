<script setup lang="ts">
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { FamilyId } from '../../../types/life.ts'
import type { PlayerRef } from '../../../types/protocol.ts'
import BaseButton from '../../ui/BaseButton.vue'
import TextField from '../../ui/TextField.vue'
import CallButton from './CallButton.vue'
import PlayerAvatar from './PlayerAvatar.vue'
import { useSocialScreen } from './useSocialScreen.ts'
import { useFamily } from './useFamily.ts'
const PersonCallButton = defineAsyncComponent(() => import('../calls/PersonCallButton.vue'))
defineProps<{ params?: unknown }>()
const { view, client, state, shell, cannot } = useSocialScreen()
const { data, error, loading, pending, canRetry, load, send, retrySend } = useFamily(client)
const members = computed(() => view.value.social.family.map(member => ({ ...member, link: data.value?.slots.find(link => link.slot === member.id) })))
const called = computed(() => members.value.filter(member => member.link?.state !== 'accepted' && member.calledToday).length)
const npcCount = computed(() => members.value.filter(member => member.link?.state !== 'accepted').length)
const choosing = ref<FamilyId | null>(null), query = ref(''), picked = ref('')
const searching = ref(false), searchError = ref<string | null>(null), results = ref<PlayerRef[] | null>(null)
const choices = computed(() => results.value ?? state.me?.friends ?? [])
const removal = ref<string | null>(null)
const picker = ref<HTMLElement | null>(null), confirmation = ref<HTMLElement | null>(null)
watch(choosing, async (slot) => { if (slot) { await nextTick(); picker.value?.scrollIntoView({ block: 'nearest' }); picker.value?.querySelector('input')?.focus() } })
watch(removal, async (id) => { if (id) { await nextTick(); confirmation.value?.scrollIntoView({ block: 'nearest' }); confirmation.value?.querySelector('button')?.focus() } })
let searchVersion = 0
onBeforeUnmount(() => { searchVersion += 1 })
watch(() => state.me?.me.id, () => { searchVersion += 1; choosing.value = null; removal.value = null; results.value = null; picked.value = ''; searching.value = false; searchError.value = null })
const presence = (id: string): string | undefined => state.me?.friends.find(friend => friend.id === id)?.status
const reason = computed(() => cannot('change your family') || (!data.value ? 'Load your family first.' : null))
function choose(slot: FamilyId): void { searchVersion += 1; searching.value = false; choosing.value = slot; query.value = ''; picked.value = ''; results.value = null; searchError.value = null }
async function find(): Promise<void> {
  const q = query.value.trim()
  if (q.length < 2 || q.length > 36) { searchError.value = 'Enter between 2 and 36 characters.'; return }
  const version = ++searchVersion
  searching.value = true; searchError.value = null
  const result = await client.call<{ results: PlayerRef[] }>(`/api/social/friends/search?q=${encodeURIComponent(q)}`)
  if (version !== searchVersion) return
  searching.value = false
  if (result.ok) { results.value = result.results; picked.value = '' }
  else searchError.value = result.reason
}
async function invite(): Promise<void> {
  if (choosing.value && picked.value && await send({ op: 'invite', slot: choosing.value, player: picked.value })) choosing.value = null
}
async function unlink(): Promise<void> {
  if (removal.value && await send({ op: 'remove', id: removal.value })) removal.value = null
}
const role = (slot: FamilyId): string => view.value.social.family.find(member => member.id === slot)?.relation ?? 'Family'
</script>

<template>
  <div class="family-app">
    <header class="family-intro">
      <small>YOUR CIRCLE</small><h2>Make yourself at home.</h2>
      <p>Keep your game family, or invite friends into your family roles. Each person chooses whether to join.</p>
    </header>
    <p v-if="loading && !data" role="status">Loading your family…</p>
    <div v-if="error" class="family-notice" role="alert"><p>{{ error }}</p><BaseButton :disabled="pending" @click="canRetry ? retrySend() : load()">Try again</BaseButton></div>
    <section v-if="data?.incoming.length" aria-label="Family invitations and roles" class="family-section">
      <h3>Invitations &amp; your roles</h3>
      <article v-for="link in data.incoming" :key="link.id" class="family-card">
        <h4>{{ link.other.name }}’s {{ role(link.slot).toLowerCase() }}</h4>
        <p>{{ link.state === 'pending' ? 'You have been invited to this in-game role. It does not change your own family or give access to your home.' : 'You accepted this in-game role. You can leave at any time.' }}</p>
        <div class="family-actions" v-if="link.state === 'pending'">
          <BaseButton variant="primary" :disabled="pending" :reason="reason" @click="send({ op: 'answer', id: link.id, accept: true })">Accept</BaseButton>
          <BaseButton :disabled="pending" :reason="reason" @click="send({ op: 'answer', id: link.id, accept: false })">Decline</BaseButton>
        </div>
        <BaseButton v-else :disabled="pending" :reason="reason" @click="removal = link.id">Leave role</BaseButton>
      </article>
    </section>
    <section aria-label="Your family" class="family-section">
      <h3>Your family</h3>
      <article v-for="member in members" :key="member.id" class="family-card">
        <div class="family-person"><PlayerAvatar :name="member.link?.state === 'accepted' ? member.link.other.name : member.name" :seed="member.link?.state === 'accepted' ? member.link.player : member.id" /><div><small>{{ member.relation }}</small><h4>{{ member.link?.state === 'accepted' ? member.link.other.name : member.name }}</h4><p>{{ member.link?.state === 'accepted' ? 'Real player · accepted' : `Game character${member.calledToday ? ' · checked in today' : ''}` }}</p></div></div>
        <div v-if="member.link?.state === 'accepted'" class="family-actions">
          <BaseButton :reason="cannot('message')" @click="shell.open('messages', { to: member.link.player, name: member.link.other.name })">Message</BaseButton>
          <PersonCallButton :id="member.link.player" :name="member.link.other.name" :status="presence(member.link.player)" compact />
          <BaseButton :disabled="pending" :reason="reason" @click="removal = member.link.id">Restore game character</BaseButton>
        </div>
        <template v-else>
          <p>{{ member.line }}</p>
          <div class="family-actions"><CallButton :member="member" :disabled="!data || pending" /><BaseButton v-if="!member.link" :disabled="pending" :reason="reason" @click="choose(member.id)">Invite a friend</BaseButton></div>
          <div v-if="member.link" class="family-invitation"><p>Waiting for {{ member.link.other.name }} to accept. {{ member.name }} stays until then.</p><BaseButton :disabled="pending" :reason="reason" @click="send({ op: 'remove', id: member.link.id })">Cancel invitation</BaseButton></div>
        </template>
      </article>
    </section>
    <section v-if="choosing" ref="picker" class="family-card" aria-label="Choose a family member">
      <h3>Invite a friend as {{ role(choosing).toLowerCase() }}</h3>
      <form @submit.prevent="find"><TextField id="family-search" v-model="query" label="Find a friend" type="search" :error="searchError ?? undefined" /><BaseButton type="submit" :disabled="searching || pending">{{ searching ? 'Searching…' : 'Search friends' }}</BaseButton></form>
      <label for="family-friend">Friend</label><select id="family-friend" v-model="picked" :disabled="pending"><option value="">Choose a friend</option><option v-for="friend in choices" :key="friend.id" :value="friend.id">{{ friend.name }}</option></select>
      <p v-if="!choices.length">No matching friends. Add someone through Contacts first.</p>
      <div class="family-actions"><BaseButton variant="primary" :disabled="pending || !picked" :reason="reason" @click="invite">Send invitation</BaseButton><BaseButton :disabled="pending" @click="choosing = null">Cancel</BaseButton></div>
    </section>
    <section v-if="removal" ref="confirmation" class="family-notice" aria-label="Confirm leaving family role"><p>End this role? The original game character returns. Your friendship and chat stay unchanged.</p><div class="family-actions"><BaseButton variant="danger" :disabled="pending" :reason="reason" @click="unlink">End role</BaseButton><BaseButton :disabled="pending" @click="removal = null">Keep role</BaseButton></div></section>
    <footer><p v-if="npcCount">{{ called }} of {{ npcCount }} game characters checked in today. Game-family streak: {{ view.social.streak }} days. A game-character call takes {{ view.social.familyCall.duration }} seconds. Their first daily call gives +{{ view.social.familyCall.social }} Social and +{{ view.social.familyCall.mood }} mood.</p><p>Real-player calls ring the person and follow their call settings. Invitations and unanswered calls earn no check-in rewards.</p></footer>
  </div>
</template>

<style scoped>
.family-app{display:grid;gap:20px;min-width:0;color:#25372f}
.family-intro{background:#fff0db;padding:20px;border-radius:18px}
.family-intro small{font-size:11px;font-weight:800;letter-spacing:.12em;color:#775a2e}
.family-intro h2{font-size:26px;line-height:1.1;letter-spacing:-.04em;margin:10px 0}
.family-app p{font-size:14px;line-height:1.5;margin:6px 0;overflow-wrap:anywhere}
.family-section{display:grid;gap:10px}.family-app h3{font-size:16px;margin:0 0 4px}.family-app h4{font-size:17px;margin:2px 0}
.family-card{display:grid;gap:10px;background:#fff;padding:16px;border:1px solid #dce4df;border-radius:16px;min-width:0}
.family-person{display:flex;gap:12px;align-items:center}.family-person>div{min-width:0}.family-person h4{overflow-wrap:anywhere}.family-person small{font-size:12px;color:#52665c}.family-person p{font-size:12px;color:#52665c}
.family-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.family-actions>*{max-width:100%}
.family-invitation,.family-notice{padding:12px;background:#fff4d7;border-radius:12px}
.family-card form{display:grid;gap:8px}.family-card select{width:100%;min-height:44px;font:inherit;padding:10px;border:1px solid #9daa9f;border-radius:8px;background:#fff;color:#25372f}
.family-card label{font-weight:700;font-size:13px}.family-app footer p{font-size:12px;color:#52665c}
</style>
