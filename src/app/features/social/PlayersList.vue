<script setup lang="ts">
// The Players view: every player, for the founder (server/social/pages.ts). Search by name, sort, a count, and a row each with what
// the friends list shows, the chat that exists with them, and Message, Call, Send money and View card. Rows come in pages as the
// list is read (LazyList); nothing is loaded for everyone at once. Up to 20 players can be picked and sent the same message.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { presenceText } from '../../../game/social-lines.ts'
import { cityName } from '../../../game/cities/registry.ts'
import { registeredCityIds } from '../../../game/cities/registry.ts'
import type { PlayerRow, PlayerSort } from '../../../types/social.ts'
import LazyList from '../../ui/LazyList.vue'
import { createLazyList, keptList } from '../../ui/lazyList.ts'
import PersonCallButton from '../calls/PersonCallButton.vue'
import FounderTag from './FounderTag.vue'
import PlayerAvatar from './PlayerAvatar.vue'
import { personUi } from './socialState.ts'
import { fetchPlayers, openChatWith, sendToMany } from './socialPages.ts'
import type { PlayersCounts } from './socialPages.ts'
import { presenceClass, venueNameOf } from './socialWords.ts'
import { useSocialScreen } from './useSocialScreen.ts'

/** The most players one message can go to at once (the server's limit). */
const PICK_MAX = 20
/** Height of one row, for the window the list is drawn through once it is long: taller on a phone, where the four buttons take two lines. */
const ROW_HEIGHT = typeof window !== 'undefined' && window.innerWidth < 520 ? 124 : 96
const { game, shell, client, view } = useSocialScreen()
const query = reactive<{ q: string; sort: PlayerSort; city: string }>({ q: '', sort: 'newest', city: registeredCityIds()[0] ?? 'lagos' })
const counts = ref<PlayersCounts>({ online: null, gone: 0 })
const list = keptList('players', () => createLazyList<PlayerRow>({ key: (row) => row.id, label: 'players', fetchPage: (cursor) => fetchPlayers(query, cursor, (next) => { counts.value = next }) }))
const cities = registeredCityIds()

let timer: ReturnType<typeof setTimeout> | undefined
watch(() => query.q, () => { clearTimeout(timer); timer = setTimeout(() => { void list.reset() }, 300) })
watch(() => [query.sort, query.city], () => { clearTimeout(timer); void list.reset() })
onBeforeUnmount(() => clearTimeout(timer))
if (!list.items.value.length && !list.loading.value) void list.reset()

const venueName = (id: string): string => venueNameOf(view.value.venues, id)
const place = computed(() => ({ cityId: view.value.cityId, cityName: (id: string) => cityName(id) ?? id }))
const when = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const chatWords = (row: PlayerRow): string => (!row.chat ? 'No chat yet' : row.chat.unread ? `${row.chat.unread} unread` : row.chat.listed ? 'Chat open' : 'Chat not in your list')
const line = (row: PlayerRow): string => `${presenceText(row, venueName, view.value.now, place.value)} · Joined ${when(row.joined)} · ${chatWords(row)}`
const totalWords = computed(() => {
  const total = query.q.trim() ? list.items.value.length : list.total.value
  if (total === null) return ''
  const online = query.sort === 'newest' || query.sort === 'name' ? counts.value.online : null
  if (query.q.trim()) return `${total}${list.hasMore.value ? '+' : ''} match${total === 1 ? '' : 'es'}`
  if (query.sort === 'online' || query.sort === 'city') return `${total.toLocaleString('en-NG')} online${query.sort === 'city' ? ` in ${cityName(query.city) ?? query.city}` : ''}`
  return `${total.toLocaleString('en-NG')} players${online !== null ? ` · ${online.toLocaleString('en-NG')} online now` : ''}`
})

async function message(row: PlayerRow): Promise<void> {
  const conv = await openChatWith(row.id)
  shell.open('messages', conv ? { conv: conv.id } : { to: row.id, name: row.name })
}
async function money(row: PlayerRow): Promise<void> {
  shell.open('person', { player: row.id, name: row.name })
  // The card clears its forms when it first shows a player: the money form is opened once it has taken this one.
  for (let tries = 0; tries < 40 && personUi.player !== row.id; tries += 1) await new Promise((done) => setTimeout(done, 50))
  if (personUi.player === row.id) { personUi.form = 'money'; personUi.clientId = client.newClientId() }
}

// ---- pick some and send them the same words ------------------------------------------------
const picked = reactive(new Set<string>())
const many = reactive({ open: false, text: '', busy: false, clientId: '', note: '' })
const toggle = (row: PlayerRow, on: boolean): void => { if (on && picked.size < PICK_MAX) picked.add(row.id); else picked.delete(row.id) }
function openMany(): void { Object.assign(many, { open: true, note: '', clientId: client.newClientId() }) }
async function sendMany(): Promise<void> {
  const body = many.text.trim()
  if (!body || many.busy || !picked.size) return
  many.busy = true
  const result = await sendToMany([...picked], body, many.clientId)
  many.busy = false
  if (!result.ok) { many.note = result.reason; return }
  const failed = result.results.filter((item) => !item.ok).length
  many.note = `Sent to ${result.sent} of ${result.results.length}.${failed ? ` ${failed} could not be messaged.` : ''}`
  game.toast(many.note, failed ? 'error' : 'good')
  if (!failed) { many.text = ''; picked.clear(); many.open = false; many.clientId = '' }
  else many.clientId = client.newClientId()
}
</script>

<template>
  <section class="players" aria-label="Players">
    <div class="players-head">
      <strong class="players-count" role="status">{{ totalWords }}</strong>
      <span v-if="counts.gone" class="players-gone">{{ counts.gone.toLocaleString('en-NG') }} no longer friends</span>
    </div>
    <div class="players-tools">
      <input v-model="query.q" type="search" name="player-search" maxlength="36" placeholder="Search players by name" aria-label="Search players by name" autocomplete="off">
      <select v-model="query.sort" aria-label="Sort players">
        <option value="newest">Newest first</option><option value="online">Online first</option><option value="name">Name A to Z</option><option value="city">Online in a city</option>
      </select>
      <select v-if="query.sort === 'city'" v-model="query.city" aria-label="City">
        <option v-for="id in cities" :key="id" :value="id">{{ cityName(id) ?? id }}</option>
      </select>
    </div>
    <div v-if="picked.size" class="players-pick">
      <span>{{ picked.size }} selected</span>
      <button type="button" class="social-btn is-primary" @click="openMany">Message selected</button>
      <button type="button" class="social-btn" @click="picked.clear()">Clear</button>
    </div>
    <form v-if="many.open && picked.size" class="players-many" @submit.prevent="sendMany">
      <textarea v-model="many.text" maxlength="500" rows="3" placeholder="One message, sent to each person on their own" aria-label="Message to the selected players" />
      <button type="submit" class="social-btn is-primary" :disabled="many.busy || !many.text.trim()">Send to {{ picked.size }}</button>
      <p v-if="many.note" class="social-note" role="status">{{ many.note }}</p>
    </form>
    <div class="social-list">
      <LazyList :items="list.items.value" :item-key="(row: PlayerRow) => row.id" :has-more="list.hasMore.value" :loading="list.loading.value" :error="list.error.value" :announcement="list.announcement.value"
        :row-height="ROW_HEIGHT" label="players" memory="players" @more="list.loadMore()" @retry="list.retry()">
        <template #row="{ item }">
          <div class="players-row" :style="{ height: `${ROW_HEIGHT}px` }">
            <label class="players-pickbox"><input type="checkbox" :checked="picked.has(item.id)" :disabled="!picked.has(item.id) && picked.size >= PICK_MAX" :aria-label="`Select ${item.name}`" @change="toggle(item, ($event.target as HTMLInputElement).checked)"></label>
            <PlayerAvatar :name="item.name" :seed="item.id" :status="item.status" />
            <div class="players-body">
              <strong>{{ item.name }}<FounderTag v-if="item.founder" /></strong>
              <small class="social-presence" :class="`is-${presenceClass(item.status)}`">{{ line(item) }}</small>
              <span class="social-actions">
                <button type="button" class="social-btn is-primary" @click="message(item)">Message</button>
                <PersonCallButton v-if="item.status === 'online'" :id="item.id" :name="item.name" :status="item.status" compact />
                <button type="button" class="social-btn" @click="money(item)">Send money</button>
                <button type="button" class="social-btn" @click="shell.open('person', { player: item.id, name: item.name })">View card</button>
              </span>
            </div>
          </div>
        </template>
        <template #empty><p class="social-note">{{ query.q.trim() ? 'Nobody has a name like that.' : 'No players yet.' }}</p></template>
      </LazyList>
    </div>
  </section>
</template>

<style scoped>
.players-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 4px 0 8px; }
.players-count { font-size: 15px; }
.players-gone { font-size: 12px; color: var(--c-muted); }
.players-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.players-tools input { flex: 1 1 180px; min-width: 0; min-height: var(--tap); padding: 0 12px; border: 1px solid var(--c-line); border-radius: var(--r-pill); font: inherit; }
.players-tools select { min-height: var(--tap); padding: 0 10px; border: 1px solid var(--c-line); border-radius: var(--r-pill); background: #fff; font: inherit; }
.players-pick { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; }
.players-many { display: grid; gap: 8px; margin-bottom: 8px; }
.players-many textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--c-line); border-radius: var(--r-md); font: inherit; }
.players-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--c-line); box-sizing: border-box; min-width: 0; }
.players-pickbox { display: grid; place-items: center; min-width: 28px; min-height: 40px; }
.players-body { flex: 1; min-width: 0; display: grid; gap: 2px; }
.players-body strong, .players-body small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.players-body strong { font-size: 14px; font-weight: 600; }
.players-body small { font-size: 12px; color: var(--c-muted); }
.players-body .social-actions { gap: 6px; flex-wrap: wrap; overflow: hidden; margin-top: 2px; }
.players-body .social-btn { padding: 4px 10px; min-height: 30px; font-size: 12px; white-space: nowrap; }
</style>
