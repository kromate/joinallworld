<script setup lang="ts">
// Games: the Phone app for playing on your own, anywhere. Oro is the word of the day (the same for
// everybody, judged by the server) with unlimited practice words; chess and word tiles open a Phone
// table against the computer (the Tables app, with no venue needed). Friends: sit at a table in a
// park or lounge and play for real; "Tables near you" lists the tables of the city the player is in.
// Opened by an address too: /games (this hub) and /games/oro (params { play: 'oro' }: today's word at once).
import { computed, defineAsyncComponent, markRaw, onMounted, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'
import { isDeparting } from '../../../life.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import GameCover from './GameCover.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { useGrowth } from '../growth/useGrowth.ts'
import type { OroView } from '../../../types/growth.ts'
import { dailyLine } from './oroModel.ts'
import { ARENA_CATALOG, catalogEntry, playersLine } from '../../../arena/catalog.ts'
import type { ArenaCatalogEntry, ArenaIntent } from '../../../arena/catalog.ts'
import { gameOfRoom, roomFromText } from '../../../arena/code.ts'
import { pendingTable } from '../../../quick-start/entry.ts'
import { useSection } from '../kit/section.ts'
import { partition, rowSub, tableTitle } from '../tables/tablesModel.ts'
import { useTables } from '../tables/useTables.ts'

const props = defineProps<{ params?: unknown }>()
const OroGame = defineAsyncComponent(() => import('./OroGame.vue'))
const ClansScreen = defineAsyncComponent(() => import('./ClansScreen.vue'))
const { game, shell, goTo } = useApp()
const tables = useTables()
const growth = useGrowth()
const view = game.view
const why = computed(() => linkWords(view.value)?.why ?? '')
const asked = (props.params && typeof props.params === 'object' ? (props.params as { play?: unknown }).play : null) === 'oro'
// An invite link (/?table=g-<game>-xxxxxx) opens this app with { room }: straight into that game's screen.
const roomParam = (): string => { const r = (props.params as { room?: unknown } | null | undefined)?.room; return typeof r === 'string' && gameOfRoom(r) ? r : '' }
// A clan invite (/?table=clan-xxxxxx, the landing) opens this app with { clan }: the Clans screen with that clan found.
const clanParam = (): string => { const c = (props.params as { clan?: unknown } | null | undefined)?.clan; return typeof c === 'string' && /^[A-Z]{6}$/.test(c) ? c : '' }
const screen = ref<'hub' | 'daily' | 'practice' | 'live' | 'clans'>(roomParam() ? 'live' : clanParam() ? 'clans' : asked ? 'daily' : 'hub')
// The live game on screen: its catalog entry, the intent it opens with (create, practice or join a room), and a key that remounts it.
const live = shallowRef<{ entry: ArenaCatalogEntry; intent: ArenaIntent } | null>(null)
const liveKey = ref(0)
const liveScreen = shallowRef<Component | null>(null)
const code = ref('')
// Each game's player count starts at its smallest table, so the picker shows a choice instead of a blank box.
const practiceSeats = ref<Record<string, number>>(Object.fromEntries(ARENA_CATALOG.map((entry) => [entry.id, entry.min])))
const codeBox = ref<HTMLInputElement | null>(null)
async function openLive(entry: ArenaCatalogEntry | null, intent: ArenaIntent): Promise<void> {
  if (!entry) { game.toast('That game is not available.', 'error'); return }
  liveScreen.value = markRaw(defineAsyncComponent(entry.screen))
  live.value = { entry, intent }; liveKey.value += 1; screen.value = 'live'
}
const openRoom = (room: string): Promise<void> => openLive(catalogEntry(gameOfRoom(room)), { kind: 'join', room })
function joinByCode(): void { const room = roomFromText(code.value); if (room) void openRoom(room); else game.toast('Paste the link or code your friend sent.', 'error') }
function watchHint(): void { codeBox.value?.focus(); game.toast('Paste the link a friend sent. If the game is full you will watch.') }
const today = ref<OroView | null>(null)
// Today's Fight challenge against the computer (src/arena/daily.ts), shown on the Fight card.
const fightDaily = ref<{ goal: string; done: boolean; streak: number } | null>(null)
async function loadDaily(): Promise<void> {
  const r = await growth.call<{ ok: boolean; goal: string; done: boolean; streak: number }>('/api/arena/daily?game=fight')
  if (r.ok && 'goal' in r) fightDaily.value = { goal: r.goal, done: r.done, streak: r.streak }
}

async function loadToday(): Promise<void> {
  if (!view.value.connected) return
  const result = await growth.call<OroView>('/api/growth/oro/state', {})
  if (result.ok && 'rows' in result) today.value = result
}
onMounted(() => {
  // An invitation the landing kept (a reload or a second open of this app lost its room): go to that room.
  const kept = pendingTable()
  if (kept && !roomParam() && screen.value === 'hub' && gameOfRoom(kept)) void openRoom(kept)
  void loadToday()
  void loadDaily()
  // Opened from inside the game: its address (/games) is shown so it can be copied, and Back closes it.
  void import('../paths/arrive.ts').then(({ enterGames }) => { enterGames() })
  // Warm the Fight, Race and Football 3D pieces so the screen opens at once (src/arena/preload.ts: never on Save-Data or 2G); again when the browser is idle, in case the first try failed.
  void import('../../../arena/preload.ts').then(({ warmFight, warmRace, warmFootball, whenIdle }) => { void warmFight(); void warmRace(); void warmFootball(); whenIdle(() => { void warmFight(); void warmRace(); void warmFootball() }) })
})
// Opened for one game ({ game: 'oro' | 'chess' | 'weave' } or, from an address, { play: 'oro' }): Oro opens on today's word, the others are brought into view.
const wanted = (): string => { const p = props.params as { game?: unknown; play?: unknown } | null | undefined; const game = p?.game ?? p?.play; return typeof game === 'string' ? game : '' }
watch(() => props.params, () => {
  if (roomParam()) void openRoom(roomParam())
  else if (clanParam()) screen.value = 'clans'
  else if (wanted() === 'oro') screen.value = 'daily'
  else {
    const entry = catalogEntry(wanted())
    if (entry?.practice) void openLive(entry, { kind: 'practice', seats: entry.min })
  }
}, { immediate: true })
useSection(() => (wanted() === 'chess' || wanted() === 'weave' ? { section: wanted() } : null))
function back(): void { screen.value = 'hub'; void loadToday(); void loadDaily() }
function onState(next: OroView): void { today.value = next }
const openTable = (table: 'phone-chess' | 'phone-weave' | 'phone-whot' | 'phone-penalty' | 'phone-ayo'): void => { shell.open('tables', { table }) }
/** Where the Sim is, or null while it travels. */
const hereVenue = computed(() => (isDeparting(game.state.value) ? null : game.state.value.location))
/** The tables of the city the player is in: where they stand first, then the rest, a few of them. */
const near = computed(() => {
  const list = tables.t.value.list
  if (!list) return null
  const { mine, other } = partition(list, hereVenue.value)
  return [...mine, ...other].slice(0, 4)
})
function toTable(row: { id: string; venue: string }): void { if (row.venue === hereVenue.value) shell.open('tables', { table: row.id }); else void goTo(row.venue) }
async function share(path: string, line: string): Promise<void> { const { shareAddress } = await import('../paths/share.ts'); await shareAddress(path, line, (text, kind) => { game.toast(text, kind) }) }
const dailyCta = computed(() => (today.value?.status === 'playing' || !today.value ? (today.value?.rows.length ? 'Carry on' : 'Play today’s word') : 'See your result'))
</script>

<template>
  <p v-if="!view.connected" class="gm-note">{{ why }}</p>
  <div v-else-if="screen === 'hub'" class="gm">
    <header class="gm-library"><h3>Your next game</h3><p>Play a quick round, or find a table with friends.</p><span v-if="today?.stats.streak" class="gm-streak">{{ today.stats.streak }} day streak</span></header>
    <section class="gm-daily" aria-labelledby="gm-oro">
      <GameCover game="oro" />
      <div><h3 id="gm-oro">Oro</h3><p>{{ dailyLine(today) }}</p><BaseButton variant="primary" @click="screen = 'daily'">{{ dailyCta }}</BaseButton></div>
      <div class="gm-daily-links"><button type="button" @click="screen = 'practice'">Practice words</button><button type="button" @click="share('/games/oro', 'Today’s word on Allworld:')">Share today’s puzzle</button></div>
    </section>
    <SectionTitle>Play live with friends</SectionTitle>
    <section v-for="g in ARENA_CATALOG" :key="g.id" class="gm-live" :data-section="g.id" :style="g.tint ? { background: g.tint.bg, color: g.tint.fg } : undefined" :aria-labelledby="'gm-live-' + g.id">
      <div><h3 :id="'gm-live-' + g.id"><span aria-hidden="true">{{ g.icon }}</span> {{ g.title }}</h3><p>{{ g.blurb }} <small>{{ playersLine(g) }}</small></p>
        <p v-if="g.id === 'fight' && fightDaily" class="gm-challenge" data-testid="fight-daily"><b>Today:</b> {{ fightDaily.goal }}. {{ fightDaily.done ? 'Done ✓' : 'Practice vs bot to try.' }}<template v-if="fightDaily.streak > 1"> · {{ fightDaily.streak }} days in a row</template></p></div>
      <BaseButton variant="primary" @click="openLive(g, { kind: 'create' })">Play with a friend</BaseButton>
      <div class="gm-live-row"><select v-if="g.practice && g.max > g.min" v-model.number="practiceSeats[g.id]" class="gm-seats" :aria-label="g.title + ' practice players'"><option v-for="n in g.max - g.min + 1" :key="n" :value="g.min + n - 1">{{ g.min + n - 1 }} players</option></select><BaseButton v-if="g.practice" @click="openLive(g, { kind: 'practice', seats: practiceSeats[g.id] ?? g.min })">Practice vs bot</BaseButton><BaseButton @click="watchHint">Watch</BaseButton></div>
    </section>
    <section class="gm-live gm-clans" data-section="clans" aria-labelledby="gm-clans">
      <div><h3 id="gm-clans"><span aria-hidden="true">&#x1F6E1;</span> Clans and ladders</h3><p>Play with up to 25 friends under one name and colour. Climb your city’s ladder, win the week for your city.</p></div>
      <BaseButton variant="primary" @click="screen = 'clans'">Open clans</BaseButton>
    </section>
    <section class="gm-live gm-build" data-section="build" aria-labelledby="gm-build">
      <div><h3 id="gm-build"><span aria-hidden="true">&#x1F6E0;</span> Make your own game</h3><p>Allworld is open source. Build a live game for everyone here: the guide, a sample game and how to send it in.</p></div>
      <a class="gm-build-link" href="https://github.com/kromate/joinallworld/blob/main/docs/CARTRIDGES.md" target="_blank" rel="noopener">Read the guide</a>
    </section>
    <div class="gm-code"><input ref="codeBox" v-model="code" placeholder="Paste a game link or code" aria-label="Game link or code" @keydown.enter="joinByCode"><BaseButton @click="joinByCode">Join / Watch</BaseButton></div>
    <SectionTitle>Play your way</SectionTitle>
    <div class="gm-grid">
      <section class="gm-game" data-section="chess">
        <button type="button" class="gm-launch" aria-label="Play chess" @click="openTable('phone-chess')"><GameCover game="chess" /><strong>Chess</strong><span>Easy, medium or hard</span></button>
        <button type="button" class="gm-share" @click="share('/games/chess', 'Play chess on Allworld:')">Share chess</button>
      </section>
      <section class="gm-game" data-section="weave">
        <button type="button" class="gm-launch" aria-label="Play Weave" @click="openTable('phone-weave')"><GameCover game="weave" /><strong>Weave</strong><span>Seven tiles. Find your word.</span></button>
        <button type="button" class="gm-share" @click="share('/games/weave', 'Play Weave on Allworld:')">Share Weave</button>
      </section>
      <section class="gm-game"><button type="button" class="gm-launch" aria-label="Play Whot" @click="openTable('phone-whot')"><GameCover game="whot" /><strong>Whot</strong><span>The classic card game</span></button></section>
      <section class="gm-game"><button type="button" class="gm-launch" aria-label="Play penalties" @click="openTable('phone-penalty')"><GameCover game="penalty" /><strong>Penalties</strong><span>Pick your spot. Take the shot.</span></button></section>
      <section class="gm-game" data-section="ayo">
        <button type="button" class="gm-launch" aria-label="Play Ayo" @click="openTable('phone-ayo')"><GameCover game="ayo" /><strong>Ayo</strong><span>Sow and capture · Oware rules</span></button>
        <button type="button" class="gm-share" @click="share('/games/ayo', 'Play Ayo on Allworld:')">Share Ayo</button>
      </section>
    </div>
    <p class="gm-note">Play these games against the computer. For a match with friends, find a table below.</p>
    <SectionTitle>Tables near you</SectionTitle>
    <p v-if="!near" class="gm-note">Looking for tables…</p>
    <ul v-else-if="near.length" class="ui-rows">
      <li v-for="row in near" :key="row.id" class="ui-row">
        <span class="ui-row-icon" aria-hidden="true"><GameIcon name="tables" inline /></span>
        <span class="ui-row-body"><b>{{ tableTitle(row) }}</b><small>{{ rowSub(row) }}</small></span>
        <span class="ui-row-end"><BaseButton :variant="row.venue === hereVenue ? 'primary' : 'default'" @click="toTable(row)">{{ row.venue === hereVenue ? 'Sit' : 'Go there' }}</BaseButton></span>
      </li>
    </ul>
    <p v-else class="gm-note">No tables in this city yet.</p>
    <BaseButton block @click="shell.open('tables')">All game tables</BaseButton>
    <BaseButton block @click="share('/games', 'Play chess, today’s word and more on Allworld:')">Share Games</BaseButton>
    <p class="gm-note">A win against a real player is paid by the game; games against the computer and Oro pay nothing, but they count for your missions.</p>
  </div>
  <div v-else-if="screen === 'clans'" class="gm">
    <ClansScreen :code="clanParam() || undefined" @back="screen = 'hub'" />
  </div>
  <div v-else-if="screen === 'live' && live && liveScreen" class="gm">
    <component :is="liveScreen" :key="liveKey" :intent="live.intent" @close="back" />
  </div>
  <div v-else class="gm">
    <OroGame :key="screen" :mode="screen === 'daily' ? 'daily' : 'practice'" @close="back" @state="onState" />
  </div>
</template>

<style scoped>
.gm { display: grid; gap: 16px; }
.gm-library { padding: 4px 2px 12px; }
.gm-library h3 { margin: 0; font-size: 26px; letter-spacing: -.025em; }
.gm-library p { font-size: 14px; line-height: 1.5; color: var(--c-muted); margin: 8px 0 0; }
.gm-streak { display: inline-block; margin-top: 10px; color: #8a4b0a; background: #fff0d1; padding: 5px 8px; border-radius: 6px; font-weight: 650; }
.gm-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gm-daily { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 16px; align-items: center; padding: 14px; background: #e2f2e9; border-radius: 16px; }
.gm-daily h3 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.025em; }
.gm-daily p { font-size: 13px; margin: 0 0 10px; color: #294e3c; }
.gm-daily .base-button { padding: 10px; width: 100%; }
.gm-daily-links { grid-column: 1 / -1; display: flex; gap: 12px; justify-content: space-between; border-top: 1px solid #bdd9c9; padding-top: 4px; }
.gm-daily-links button, .gm-share { border: 0; background: none; min-height: 44px; padding: 6px 0; font: 600 14px var(--font); color: #22543d; text-align: left; cursor: pointer; }
.gm-live { display: grid; gap: 10px; padding: 14px; border-radius: 16px; }
.gm-clans { background: #3a2c55; color: #fff; }
.gm-build { background: #1f3b4d; color: #fff; }
.gm-build-link { display: flex; align-items: center; justify-content: center; min-height: 44px; border-radius: 10px; background: #fff; color: #1f3b4d; font: 650 14px var(--font); text-decoration: none; }
.gm-challenge { margin: 6px 0 0; padding: 6px 10px; border-radius: 10px; background: rgba(255,255,255,.12); font-size: 13px; }
.gm-live h3 { margin: 0 0 2px; font-size: 24px; letter-spacing: -.025em; }
.gm-live p { margin: 0; font-size: 13px; opacity: .85; } .gm-live small { opacity: .8; }
.gm-seats { min-height: var(--tap, 44px); padding: 0 8px; border-radius: 10px; border: 0; background: #fff; color: var(--c-ink); font: 600 14px var(--font); }
.gm-live-row { display: flex; gap: 8px; } .gm-live-row > * { flex: 1 1 0; min-width: 0; }
.gm .ui-row-body > b, .gm .ui-row-body > small { overflow: visible; overflow-wrap: anywhere; text-overflow: clip; white-space: normal; }
.gm-live-row > .gm-seats { flex: 1.35 1 0; padding: 0 4px 0 10px; }
.gm-code { display: flex; gap: 8px; } .gm-code input { flex: 1; min-width: 0; min-height: var(--tap, 44px); padding: 0 12px; border-radius: 10px; border: 1px solid var(--c-line); background: #fff; font: 16px var(--font); }
.gm-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 14px; }
.gm-game { min-width: 0; }
.gm-launch { display: grid; gap: 6px; width: 100%; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; border-radius: 14px; color: var(--c-ink); }
.gm-launch strong { font-size: 18px; margin-top: 4px; letter-spacing: -.02em; }
.gm-launch > span:not(.game-cover) { font-size: 13px; line-height: 1.4; color: var(--c-muted); }
.gm-launch:hover .game-cover { filter: brightness(.96); }
.gm-share { color: var(--c-muted); font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
.ph.is-wide .gm-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ph.is-wide .gm-daily { grid-template-columns: 112px 1fr auto; }
.ph.is-wide .gm-daily-links { grid-column: auto; border: 0; flex-direction: column; }
</style>
