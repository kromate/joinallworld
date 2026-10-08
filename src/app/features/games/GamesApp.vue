<script setup lang="ts">
// Games: the Phone app for playing on your own, anywhere. Oro is the word of the day (the same for
// everybody, judged by the server) with unlimited practice words; chess and word tiles open a Phone
// table against the computer (the Tables app, with no venue needed). Friends: sit at a table in a
// park or lounge and play for real; "Tables near you" lists the tables of the city the player is in.
// Opened by an address too: /games (this hub) and /games/oro (params { play: 'oro' }: today's word at once).
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
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
import { useSection } from '../kit/section.ts'
import { partition, rowSub, tableTitle } from '../tables/tablesModel.ts'
import { useTables } from '../tables/useTables.ts'

const props = defineProps<{ params?: unknown }>()
const OroGame = defineAsyncComponent(() => import('./OroGame.vue'))
const { game, shell, goTo } = useApp()
const tables = useTables()
const growth = useGrowth()
const view = game.view
const why = computed(() => linkWords(view.value)?.why ?? '')
const asked = (props.params && typeof props.params === 'object' ? (props.params as { play?: unknown }).play : null) === 'oro'
const screen = ref<'hub' | 'daily' | 'practice'>(asked ? 'daily' : 'hub')
const today = ref<OroView | null>(null)

async function loadToday(): Promise<void> {
  if (!view.value.connected) return
  const result = await growth.call<OroView>('/api/growth/oro/state', {})
  if (result.ok && 'rows' in result) today.value = result
}
onMounted(() => {
  void loadToday()
  // Opened from inside the game: its address (/games) is shown so it can be copied, and Back closes it.
  void import('../paths/arrive.ts').then(({ enterGames }) => { enterGames() })
})
// Opened for one game ({ game: 'oro' | 'chess' | 'weave' } or, from an address, { play: 'oro' }): Oro opens on today's word, the others are brought into view.
const wanted = (): string => { const p = props.params as { game?: unknown; play?: unknown } | null | undefined; const game = p?.game ?? p?.play; return typeof game === 'string' ? game : '' }
watch(() => props.params, () => { if (wanted() === 'oro') screen.value = 'daily' }, { immediate: true })
useSection(() => (wanted() === 'chess' || wanted() === 'weave' ? { section: wanted() } : null))
function back(): void { screen.value = 'hub'; void loadToday() }
function onState(next: OroView): void { today.value = next }
const openTable = (table: 'phone-chess' | 'phone-weave' | 'phone-whot' | 'phone-penalty'): void => { shell.open('tables', { table }) }
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
  <div v-else class="gm">
    <button class="gm-back" type="button" @click="back">‹ All games</button>
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
.gm-back { justify-self: start; background: none; border: 0; color: var(--c-muted); font: inherit; font-size: 12px; text-decoration: underline; min-height: var(--tap, 44px); cursor: pointer; }
.gm-daily { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 16px; align-items: center; padding: 14px; background: #e2f2e9; border-radius: 16px; }
.gm-daily h3 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.025em; }
.gm-daily p { font-size: 13px; margin: 0 0 10px; color: #294e3c; }
.gm-daily .base-button { padding: 10px; width: 100%; }
.gm-daily-links { grid-column: 1 / -1; display: flex; gap: 12px; justify-content: space-between; border-top: 1px solid #bdd9c9; padding-top: 4px; }
.gm-daily-links button, .gm-share { border: 0; background: none; min-height: 44px; padding: 6px 0; font: 600 13px var(--font); color: #22543d; text-align: left; cursor: pointer; }
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
