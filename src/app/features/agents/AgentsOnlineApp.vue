<script setup lang="ts">
// AI agents ('ai-agents', a People app, and "See AI agents" in the online sheet): every AI agent online now, listed as chats are listed in Messages: a
// row with the avatar, the name and where they are; a tap opens the chat with them (Call, Go to them and their card are in its header). Your chats with
// them and the ones you keep as contacts come first, then those in your city, then the other cities with how many are in each (a tap lists them).
// Search by name across the world. Read from GET /api/agents/online (server/agents/contact.ts); refreshed every 30 seconds while open.
import '../../../ui/controls.css'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { cityName } from '../../../game/cities/registry.ts'
import { formatClock } from '../../../game/clock.ts'
import type { OnlineAgent } from '../../../types/agents-http.ts'
import ListRow from '../../ui/ListRow.vue'
import ListRows from '../../ui/ListRows.vue'
import RowMark from '../../ui/RowMark.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import EmptyState from '../../ui/EmptyState.vue'
import { listTime } from '../messages/messagesText.ts'
import { agentBook, recentChats, whereLine } from './agentContacts.ts'
import { fetchAgents, openChat } from './agentMoves.ts'

defineProps<{ params?: unknown }>()
/** Your landlord, boss and rival, and Spot the AI (docs/AI-RESIDENTS.md): its own chunk, loaded on the first tap. */
const AiLifePanel = defineAsyncComponent(() => import('./AiLifePanel.vue'))
const lifeOpen = ref(false)
const { game } = useApp()
const here = computed(() => game.view.value.cityId)
const state = reactive({ total: null as number | null, agents: [] as OnlineAgent[], cities: {} as Record<string, number>, error: false, loading: false })
const other = reactive({ city: '' as string, agents: [] as OnlineAgent[], loading: false })
const q = ref('')
const found = ref<OnlineAgent[] | null>(null)
const online = computed(() => new Map([...state.agents, ...other.agents, ...(found.value ?? [])].map((agent) => [agent.id, agent])))

async function load(): Promise<void> {
  if (state.loading) return
  state.loading = true
  try {
    const answer = await fetchAgents({ city: here.value })
    Object.assign(state, { total: answer.total ?? 0, agents: answer.agents ?? [], cities: answer.cities ?? {}, error: false })
    if (other.city) await openCity(other.city, true)
  } catch { state.error = true } finally { state.loading = false }
}
async function openCity(city: string, again = false): Promise<void> {
  if (!again && other.city === city) { other.city = ''; other.agents = []; return }
  other.city = city; other.loading = true
  try { const answer = await fetchAgents({ city }); if (other.city === city) other.agents = answer.agents ?? [] } catch { other.agents = [] } finally { other.loading = false }
}
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, (value) => {
  clearTimeout(searchTimer)
  if (value.trim().length < 2) { found.value = null; return }
  searchTimer = setTimeout(() => { void fetchAgents({ q: value.trim() }).then((answer) => { found.value = answer.agents ?? [] }, () => { found.value = [] }) }, 300)
})
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void load(); timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30000) })
onBeforeUnmount(() => { clearInterval(timer); clearTimeout(searchTimer) })
watch(here, () => { void load() })

const elsewhere = computed(() => Object.entries(state.cities).filter(([city]) => city !== here.value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
const placeOfCity = (city: string): string => (city === 'world' ? 'The Square' : cityName(city) ?? city)
const chats = computed(() => recentChats(agentBook.chats).slice(0, 8))
/** The contacts not already shown among the chats. */
const contacts = computed(() => agentBook.contacts.filter((contact) => !chats.value.some((chat) => chat.id === contact.id)))
/** The agents of this city not already shown above. */
const hereList = computed(() => state.agents.filter((agent) => !chats.value.some((chat) => chat.id === agent.id) && !contacts.value.some((contact) => contact.id === agent.id)))
const lastLine = (id: string): string => { const line = agentBook.chats[id]?.lines.at(-1); return line ? `${line.me ? 'You: ' : ''}${line.text}` : '' }
const time = (at: number): string => formatClock(at).split('· ')[1] ?? ''
/** A saved contact or a chat, as the list knows it now (standing somewhere) or as it was kept. */
const known = (item: { id: string; name: string; city: string }): OnlineAgent => online.value.get(item.id) ?? { id: item.id, name: item.name, kind: item.id.startsWith('house.') ? 'house' : 'resident', city: item.city, cityName: placeOfCity(item.city), venue: null, place: null, doing: null, look: null }
const subOf = (item: { id: string; name: string; city: string }): string => (online.value.has(item.id) ? whereLine(known(item)) : `${placeOfCity(item.city)} · not out now`)
</script>

<template>
  <div class="ai-agents" data-ai-agents>
    <button type="button" class="ai-agents-life" :aria-expanded="lifeOpen" data-ai-life-open @click="lifeOpen = !lifeOpen">{{ lifeOpen ? 'Hide' : 'Your landlord, boss and rival · Spot the AI' }}</button>
    <AiLifePanel v-if="lifeOpen" />
    <input v-model="q" class="ai-agents-filter" type="search" name="agent-search" maxlength="40" placeholder="Search AI agents by name" aria-label="Search AI agents by name" autocomplete="off">
    <p class="ai-agents-note">
      <template v-if="state.total">{{ state.total.toLocaleString('en-US') }} AI {{ state.total === 1 ? 'character is' : 'characters are' }} out in the world now. </template>
      Tap one to chat; call them or go to them from the chat.
    </p>

    <template v-if="found">
      <SectionTitle>Found</SectionTitle>
      <p v-if="!found.length" class="ai-agents-note">Nobody online has a name like that.</p>
      <ListRows v-else label="Found">
        <ListRow v-for="agent in found" :key="`f${agent.id}`" as="button" :data-agent-row="agent.id" :title="agent.name" :sub="whereLine(agent)" @click="openChat(agent)">
          <template #icon><span class="ai-agents-avatar is-online"><RowMark :name="agent.name" :seed="agent.id" /></span></template>
          <template #end><span class="ai-tag">AI</span></template>
        </ListRow>
      </ListRows>
    </template>

    <template v-else>
      <template v-if="chats.length">
        <SectionTitle>Your chats</SectionTitle>
        <ListRows label="Your chats with AI characters">
          <ListRow v-for="item in chats" :key="`c${item.id}`" as="button" :data-agent-row="item.id" :title="item.name" :sub="lastLine(item.id)" @click="openChat(known(item))">
            <template #icon><span class="ai-agents-avatar" :class="{ 'is-online': online.has(item.id) }"><RowMark :name="item.name" :seed="item.id" /></span></template>
            <template #end><span class="ai-agents-when"><small>{{ listTime(item.at, Date.now(), time) }}</small><span class="ai-tag">AI</span></span></template>
          </ListRow>
        </ListRows>
      </template>

      <template v-if="contacts.length">
        <SectionTitle>Contacts</SectionTitle>
        <ListRows label="AI characters in your contacts">
          <ListRow v-for="item in contacts" :key="`k${item.id}`" as="button" :data-agent-row="item.id" :title="item.name" :sub="subOf(item)" @click="openChat(known(item))">
            <template #icon><span class="ai-agents-avatar" :class="{ 'is-online': online.has(item.id) }"><RowMark :name="item.name" :seed="item.id" /></span></template>
            <template #end><span class="ai-tag">AI</span></template>
          </ListRow>
        </ListRows>
      </template>

      <SectionTitle :note="state.agents.length ? String(state.agents.length) : ''">In {{ placeOfCity(here) }}</SectionTitle>
      <p v-if="state.error" class="ai-agents-note is-warn">This could not be loaded. <button type="button" class="ai-agents-link" @click="load()">Try again</button></p>
      <p v-else-if="state.total === null" class="ai-agents-note">Looking…</p>
      <p v-else-if="!state.agents.length" class="ai-agents-note">No AI character is out in {{ placeOfCity(here) }} right now. They keep their own hours{{ elsewhere.length ? ': try another city below' : '' }}.</p>
      <ListRows v-else-if="hereList.length" label="AI characters in this city">
        <ListRow v-for="agent in hereList" :key="`h${agent.id}`" as="button" :data-agent-row="agent.id" :title="agent.name" :sub="whereLine(agent)" @click="openChat(agent)">
          <template #icon><span class="ai-agents-avatar is-online"><RowMark :name="agent.name" :seed="agent.id" /></span></template>
          <template #end><span class="ai-tag">AI</span></template>
        </ListRow>
      </ListRows>
      <p v-else class="ai-agents-note">All of them are in your chats or contacts above.</p>

      <template v-if="elsewhere.length">
        <SectionTitle>Elsewhere in the world</SectionTitle>
        <div class="ai-agents-chips" role="group" aria-label="Other cities">
          <button v-for="[city, count] in elsewhere" :key="city" type="button" :aria-pressed="other.city === city" @click="openCity(city)">{{ placeOfCity(city) }}<span class="ai-agents-badge">{{ count }}</span></button>
        </div>
        <template v-if="other.city">
          <p v-if="other.loading" class="ai-agents-note">Looking in {{ placeOfCity(other.city) }}…</p>
          <ListRows v-else-if="other.agents.length" :label="`AI characters in ${placeOfCity(other.city)}`">
            <ListRow v-for="agent in other.agents" :key="`o${agent.id}`" as="button" :data-agent-row="agent.id" :title="agent.name" :sub="whereLine(agent)" @click="openChat(agent)">
              <template #icon><span class="ai-agents-avatar is-online"><RowMark :name="agent.name" :seed="agent.id" /></span></template>
              <template #end><span class="ai-tag">AI</span></template>
            </ListRow>
          </ListRows>
        </template>
      </template>
      <EmptyState v-if="state.total === 0 && !chats.length && !contacts.length" icon="people" title="Nobody out just now" text="AI characters keep their own hours. Come back a little later." />
    </template>
  </div>
</template>

<style scoped>
.ai-agents { display: grid; gap: 4px; align-content: start; }
.ai-agents-life { min-height: 44px; margin: 0 0 var(--s-2); padding: 0 12px; border: 1px solid #c7d2fe; border-radius: var(--r-sm); background: #eef2ff; color: #3730a3; font: 600 13px var(--font); text-align: left; cursor: pointer; }
.ai-agents-life:focus-visible { outline: var(--focus); outline-offset: 2px; }
.ai-agents-filter { box-sizing: border-box; width: 100%; min-height: 44px; margin: 0 0 var(--s-2); padding: 6px 14px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); font: inherit; font-size: 16px; }
.ai-agents-note { margin: 2px 4px 8px; font-size: 13px; line-height: 1.45; color: var(--c-muted); }
.ai-agents-note.is-warn { color: var(--c-red); }
.ai-agents-link { min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--c-green-dark); font: 600 12px var(--font); text-decoration: underline; cursor: pointer; }
.ai-agents-avatar { position: relative; display: inline-grid; }
.ai-agents-avatar.is-online::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border: 2px solid #fff; border-radius: 50%; background: var(--c-green-dark); }
.ai-agents-when { display: grid; justify-items: end; gap: 3px; }
.ai-agents-when small { font-size: 12px; font-weight: 500; color: var(--c-muted); }
.ai-tag { display: inline-block; padding: 1px 6px; border-radius: 999px; background: #4338ca; color: #fff; font-size: 11px; font-weight: 700; line-height: 1.5; letter-spacing: .02em; }
.ai-agents-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 var(--s-2); }
.ai-agents-chips button { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px solid var(--c-line); border-radius: 22px; background: #fff; font: 600 13px var(--font); color: var(--c-ink-2); cursor: pointer; }
.ai-agents-chips button[aria-pressed='true'] { border-color: var(--c-green-dark); background: #eef8f1; color: var(--c-green-dark); }
.ai-agents-chips button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.ai-agents-badge { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--c-fill-2); color: var(--c-ink-2); font-size: 11px; font-weight: 700; line-height: 1; }
</style>
