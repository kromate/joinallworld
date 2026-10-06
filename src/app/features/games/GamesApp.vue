<script setup lang="ts">
// Games: the Phone app for playing on your own, anywhere. Oro is the word of the day (the same for
// everybody, judged by the server) with unlimited practice words; chess and word tiles open a Phone
// table against the computer (the Tables app, with no venue needed). Friends: sit at a table in a
// park or lounge and play for real; "Tables near you" lists the tables of the city the player is in.
// Opened by an address too: /games (this hub) and /games/oro (params { play: 'oro' }: today's word at once).
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { isDeparting } from '../../../life.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { useGrowth } from '../growth/useGrowth.ts'
import type { OroView } from '../../../types/growth.ts'
import { dailyLine } from './oroModel.ts'
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
    <HeroCard label="Games" :figure="today?.stats.streak ? `${today.stats.streak} day streak` : 'Pick a game'">Play on your own, anywhere. Sit at a table in a park or lounge to play with friends.</HeroCard>
    <section class="gm-card" aria-labelledby="gm-oro">
      <div class="gm-icon" aria-hidden="true"><GameIcon name="note" inline /></div>
      <div class="gm-body">
        <h3 id="gm-oro">Oro <small>a word a day</small></h3>
        <p>{{ dailyLine(today) }}</p>
        <div class="gm-actions">
          <BaseButton variant="primary" @click="screen = 'daily'">{{ dailyCta }}</BaseButton>
          <BaseButton @click="screen = 'practice'">Practice words</BaseButton>
          <BaseButton @click="share('/games/oro', 'Today’s word on Allworld:')">Share</BaseButton>
        </div>
      </div>
    </section>
    <section class="gm-card" aria-labelledby="gm-chess">
      <div class="gm-icon" aria-hidden="true"><GameIcon name="crown" inline /></div>
      <div class="gm-body">
        <h3 id="gm-chess">Chess <small>against the computer</small></h3>
        <p>Easy, medium or hard. Or sit at a chess table in a park and play a friend.</p>
        <div class="gm-actions"><BaseButton variant="primary" @click="openTable('phone-chess')">Play chess</BaseButton><BaseButton @click="share('/games/chess', 'Play chess on Allworld:')">Share this game</BaseButton></div>
      </div>
    </section>
    <section class="gm-card" aria-labelledby="gm-weave">
      <div class="gm-icon" aria-hidden="true"><GameIcon name="game" inline /></div>
      <div class="gm-body">
        <h3 id="gm-weave">Weave <small>word tiles</small></h3>
        <p>Weave words across the cloth with your seven tiles, against one to three computer players.</p>
        <div class="gm-actions"><BaseButton variant="primary" @click="openTable('phone-weave')">Play Weave</BaseButton><BaseButton @click="share('/games/weave', 'Play Weave on Allworld:')">Share this game</BaseButton></div>
      </div>
    </section>
    <section class="gm-card" aria-labelledby="gm-whot">
      <div class="gm-icon" aria-hidden="true"><GameIcon name="tables" inline /></div>
      <div class="gm-body">
        <h3 id="gm-whot">Whot and Penalties <small>against the computer</small></h3>
        <p>The card game and the shootout, on your own.</p>
        <div class="gm-actions">
          <BaseButton variant="primary" @click="openTable('phone-whot')">Play Whot</BaseButton>
          <BaseButton variant="primary" @click="openTable('phone-penalty')">Play penalties</BaseButton>
        </div>
      </div>
    </section>
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
.gm { display: grid; gap: var(--s-3); }
.gm-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gm-back { justify-self: start; background: none; border: 0; color: var(--c-muted); font: inherit; font-size: 12px; text-decoration: underline; min-height: var(--tap, 44px); cursor: pointer; }
.gm-card { display: grid; grid-template-columns: 40px 1fr; gap: 12px; background: #fff; border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 14px; }
.gm-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: color-mix(in srgb, var(--app-tint, #7a4fb0) 14%, #fff); color: var(--app-tint, #7a4fb0); }
.gm-body h3 { margin: 0 0 2px; font-size: 15px; }
.gm-body h3 small { font-weight: 400; font-size: 12px; color: var(--c-muted); margin-left: 4px; }
.gm-body p { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--c-ink-2); }
.gm-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.gm-actions .base-button { min-height: var(--tap, 44px); }
</style>
