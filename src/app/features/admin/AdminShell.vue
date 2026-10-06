<script setup lang="ts">
// The admin screens' frame, the same on the game's Phone and on the admin address: a navigation rail on a wide screen and tabs along the
// bottom of a phone, a title and breadcrumbs, a search box that finds a player from anywhere, keyboard shortcuts, toasts for what a change
// did and a drawer of what this visit has done (with Undo where a change can be reversed). Every number and action is the server's.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { admin, useAdmin } from './useAdmin.ts'
import type { Account } from '../account/accountStore.ts'
import { VIEWS, hashOf, loadRecent, parseRoute, ui, undo } from './adminUi.ts'
import type { ViewId } from './adminUi.ts'
import { absolute, relative } from './adminModel.ts'
import type { PlayersPage } from '../../../types/admin.ts'
import DashboardView from './DashboardView.vue'
import PlayersView from './PlayersView.vue'
import AnnounceView from './AnnounceView.vue'
import WorldView from './WorldView.vue'
import ModerationView from './ModerationView.vue'
import AuditView from './AuditView.vue'
import './admin.css'

const props = withDefaults(defineProps<{ mode: 'game' | 'page'; account?: Account | null; gameUrl?: string }>(), { account: null, gameUrl: '/' })
const emit = defineEmits<{ close: [] }>()
const api = useAdmin()
const page = computed(() => props.mode === 'page')

// ---- where we are ------------------------------------------------------------------------------------------------
function enter(route = ui.route): void { if (route.player !== ui.route.player) ui.crumb = ''; ui.route = route; if (page.value && globalThis.location.hash !== hashOf(route)) globalThis.history.replaceState(null, '', hashOf(route)) }
function go(view: ViewId, player: string | null = null, tab: string | null = null): void { enter({ view, player, tab }) }
const title = computed(() => (ui.route.player ? 'Player' : VIEWS.find((item) => item.id === ui.route.view)?.title ?? 'Admin'))
const crumbs = computed(() => {
  const view = VIEWS.find((item) => item.id === ui.route.view)
  const list: { text: string; to?: () => void }[] = [{ text: 'Admin', to: () => go('dashboard') }]
  if (view && view.id !== 'dashboard') list.push(ui.route.player ? { text: view.label, to: () => go(view.id) } : { text: view.label })
  if (ui.route.player) list.push({ text: ui.crumb || 'Player' })
  return list
})
function onHash(): void { if (page.value) ui.route = parseRoute(globalThis.location.hash) }

// ---- search ------------------------------------------------------------------------------------------------------
const q = ref(''), results = ref<PlayersPage['rows']>([]), open = ref(false), picked = ref(0), searching = ref(false), field = ref<HTMLInputElement | null>(null)
let wait: ReturnType<typeof setTimeout> | undefined, seq = 0
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
watch(q, (text) => {
  clearTimeout(wait); picked.value = 0
  const clean = text.trim()
  if (clean.length < 2) { results.value = []; open.value = false; return }
  wait = setTimeout(async () => {
    const mine = ++seq
    searching.value = true
    const reply = await api.get<PlayersPage>('/api/admin/players', { q: clean, size: 15 })
    if (mine !== seq) return
    searching.value = false
    results.value = reply.ok ? reply.data.rows : []; open.value = true
  }, 250)
})
function choose(id: string): void { open.value = false; q.value = ''; results.value = []; go('players', id) }
function searchKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') { picked.value = Math.min(results.value.length - 1, picked.value + 1); event.preventDefault() }
  else if (event.key === 'ArrowUp') { picked.value = Math.max(0, picked.value - 1); event.preventDefault() }
  else if (event.key === 'Enter') { const clean = q.value.trim(); if (UUID.test(clean)) choose(clean.toLowerCase()); else if (results.value[picked.value]) choose(results.value[picked.value]!.id); event.preventDefault() }
  else if (event.key === 'Escape') { open.value = false; field.value?.blur() }
}

// ---- shortcuts ----------------------------------------------------------------------------------------------------
let chord = 0
function typing(event: KeyboardEvent): boolean { const t = event.target as HTMLElement | null; return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) }
function keys(event: KeyboardEvent): void {
  if (event.key === 'Escape') { if (ui.help) { ui.help = false; return } if (ui.drawer) { ui.drawer = false; return } return }
  if (event.ctrlKey || event.metaKey || event.altKey || typing(event)) return
  const take = (): void => { event.preventDefault(); event.stopImmediatePropagation() }
  if (event.key === '/') { take(); void nextTick(() => field.value?.focus()); return }
  if (event.key === '?') { take(); ui.help = !ui.help; return }
  if (event.key === 'g') { take(); chord = Date.now(); return }
  if (Date.now() - chord < 1200) { const view = VIEWS.find((item) => item.key === event.key); if (view) { take(); chord = 0; go(view.id) } }
}
onMounted(() => {
  loadRecent()
  if (page.value) { ui.route = parseRoute(globalThis.location.hash); window.addEventListener('hashchange', onHash) }
  window.addEventListener('keydown', keys, true)
})
onBeforeUnmount(() => { window.removeEventListener('keydown', keys, true); window.removeEventListener('hashchange', onHash); clearTimeout(wait) })
async function leave(): Promise<void> { if (props.account) { await props.account.signOut() } else emit('close') }
const done = computed(() => ui.done)
const blurSoon = (): void => { setTimeout(() => { open.value = false }, 150) }
</script>

<template>
  <div class="adm" :class="`is-${mode}`" role="application" aria-label="Admin">
    <aside class="adm-side" aria-label="Admin sections">
      <b class="adm-brand">Allworld admin</b>
      <nav>
        <button v-for="item in VIEWS" :key="item.id" type="button" :class="{ on: ui.route.view === item.id }" :aria-current="ui.route.view === item.id ? 'page' : undefined" @click="go(item.id)">{{ item.label }}<kbd aria-hidden="true">g {{ item.key }}</kbd></button>
      </nav>
      <div class="adm-who">{{ admin.me ? `${admin.me.name} · ${admin.me.level}` : '' }}</div>
      <a v-if="page" class="adm-side-link" :href="gameUrl">Open the game</a>
      <button type="button" class="adm-side-link" @click="leave">{{ page ? 'Sign out' : 'Close admin' }}</button>
    </aside>
    <div class="adm-body">
      <header class="adm-top">
        <div class="adm-titles">
          <nav class="adm-crumbs" aria-label="Breadcrumb"><template v-for="(crumb, index) in crumbs" :key="index"><button v-if="crumb.to" type="button" @click="crumb.to()">{{ crumb.text }}</button><span v-else aria-current="page">{{ crumb.text }}</span><i v-if="index < crumbs.length - 1" aria-hidden="true">›</i></template></nav>
          <h1>{{ title }}</h1>
        </div>
        <div class="adm-search">
          <label class="adm-sr" for="adm-q">Find a player by name or id</label>
          <input id="adm-q" ref="field" v-model="q" type="search" placeholder="Find a player ( / )" autocomplete="off" role="combobox" :aria-expanded="open" aria-controls="adm-results" aria-autocomplete="list" @keydown="searchKey" @focus="open = results.length > 0" @blur="blurSoon">
          <ul v-if="open" id="adm-results" class="adm-results" role="listbox">
            <li v-for="(row, index) in results" :key="row.id" role="option" :aria-selected="index === picked" :class="{ on: index === picked }" @mousedown.prevent="choose(row.id)"><b>{{ row.name }}</b><span>{{ row.kind }} · {{ row.city ?? '-' }}{{ row.online ? ' · online' : '' }}</span></li>
            <li v-if="!results.length" class="adm-muted">{{ searching ? 'Searching…' : 'Nobody matches.' }}</li>
          </ul>
        </div>
        <div class="adm-tools">
          <button type="button" class="adm-iconbtn" :aria-expanded="ui.drawer" aria-label="What just happened" title="What just happened" @click="ui.drawer = !ui.drawer">Log<i v-if="done.length" class="adm-dot">{{ done.length }}</i></button>
          <button type="button" class="adm-iconbtn" aria-label="Keyboard shortcuts" title="Shortcuts ( ? )" @click="ui.help = !ui.help">?</button>
          <button v-if="!page" type="button" class="adm-iconbtn adm-close" aria-label="Close admin" @click="emit('close')">Close</button>
        </div>
      </header>
      <main class="adm-main" tabindex="-1">
        <DashboardView v-if="ui.route.view === 'dashboard'" @player="go('players', $event)" />
        <PlayersView v-else-if="ui.route.view === 'players'" :player="ui.route.player" :tab="ui.route.tab" @open="go('players', $event)" @back="go('players')" @tab="go('players', ui.route.player, $event)" />
        <AnnounceView v-else-if="ui.route.view === 'announce'" />
        <WorldView v-else-if="ui.route.view === 'world'" />
        <ModerationView v-else-if="ui.route.view === 'moderation'" @player="go('players', $event)" />
        <AuditView v-else-if="ui.route.view === 'audit'" @player="go('players', $event)" />
      </main>
    </div>
    <nav class="adm-tabs" aria-label="Admin sections">
      <button v-for="item in VIEWS" :key="item.id" type="button" :class="{ on: ui.route.view === item.id }" :aria-current="ui.route.view === item.id ? 'page' : undefined" @click="go(item.id)">{{ item.short }}</button>
    </nav>

    <div class="adm-toasts" role="status" aria-live="polite"><p v-for="item in ui.toasts" :key="item.id" :class="`is-${item.kind}`">{{ item.text }}</p></div>
    <aside v-if="ui.drawer" class="adm-drawer" aria-label="What just happened">
      <header><b>What just happened</b><button type="button" class="adm-iconbtn" aria-label="Close this list" @click="ui.drawer = false">×</button></header>
      <p v-if="!done.length" class="adm-muted">Nothing yet in this visit. Changes you make are listed here, with Undo where one can be reversed.</p>
      <ol><li v-for="entry in done" :key="entry.id" :class="{ off: !entry.ok || entry.undone }"><span>{{ entry.text }}</span><small>{{ relative(entry.at, Date.now()) }} · {{ absolute(entry.at) }}{{ entry.undone ? ' · undone' : '' }}</small>
        <button v-if="entry.undo && !entry.undone && entry.ok" type="button" class="adm-btn" @click="undo(entry)">{{ entry.undo.label }}</button></li></ol>
    </aside>
    <div v-if="ui.help" class="adm-help" role="dialog" aria-label="Keyboard shortcuts" @click.self="ui.help = false">
      <div class="adm-card"><h3>Keyboard shortcuts</h3>
        <p class="adm-line"><span>Find a player</span><kbd>/</kbd></p>
        <p v-for="item in VIEWS" :key="item.id" class="adm-line"><span>Go to {{ item.label }}</span><kbd>g then {{ item.key }}</kbd></p>
        <p class="adm-line"><span>This list</span><kbd>?</kbd></p><p class="adm-line"><span>Close a list</span><kbd>Esc</kbd></p>
        <p class="adm-sub">In a queue: j and k move, a acts on the first choice, d dismisses.</p><button class="adm-btn" @click="ui.help = false">Close</button></div>
    </div>
  </div>
</template>
