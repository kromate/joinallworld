<script setup lang="ts">
// Missions: the Phone app. Three daily and three weekly missions with their progress, what each
// pays, a Go button, the weekly stamp card and the count of days lived. Rules and numbers live in
// src/game/systems/missions.ts and content/missions.js; this only shows them.
//
// Collect and Swap are 'missions.claim' and 'missions.reroll': the pressed control says so until
// the server answers, and the answer — not the press — changes the numbers.
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import MissionItem from './MissionItem.vue'
import { daysTail, setLine, stampCells, stampsNote } from './missionsModel.ts'
import { until } from './growthModel.ts'
import { useGrowth } from './useGrowth.ts'
import type { MissionRow } from '../../../types/view.ts'

defineProps<{ params?: unknown }>()
const { game, shell, goTo } = useApp()
const growth = useGrowth()
const view = game.view
const m = computed(() => view.value.missions)
const collectWhy = computed(() => (view.value.connected ? null : linkWords(view.value)?.cannot('collect') ?? null))
const noteWhy = computed(() => linkWords(view.value)?.why ?? '')
const stamps = computed(() => (m.value ? stampCells(m.value.stamps) : []))
const resetsIn = computed(() => (m.value ? until(m.value.resetAt, view.value.now) : ''))
const weekIn = computed(() => (m.value ? until(m.value.weekResetAt, view.value.now) : ''))
const noMissions = computed(() => Boolean(m.value) && !m.value?.daily.length && !m.value?.weekly.length)
const rules = computed(() => [
  'Three missions a day and three a week: one about your life, one about the city, one about people.',
  `A daily mission pays ${money(m.value?.daily[0]?.cash ?? 250)} and a weekly one ${money(m.value?.weekly[0]?.cash ?? 1000)}, once, when you collect it. All three of a set add stars.`,
  'Unfinished missions are replaced at midnight (weekly ones on Monday), Nigerian time. Nothing is taken from you for missing them.',
  'You can swap one unfinished daily mission a day.',
  'Your count of days only ever goes up. There is no streak to lose.',
])

onMounted(() => { void growth.load() })

/** Which control is on its way to the server: one at a time. */
const working = ref<{ id: string; what: 'claim' | 'swap' } | null>(null)
const pendingOf = (mission: MissionRow): 'claim' | 'swap' | null => (working.value?.id === mission.id ? working.value.what : null)
async function claim(mission: MissionRow): Promise<void> {
  if (working.value) return
  working.value = { id: mission.id, what: 'claim' }
  try {
    const result = await game.command('missions.claim', { id: mission.id })
    if (result.ok) {
      game.toast(game.state.value.message || 'Mission collected.', 'earn')
      const now = view.value.missions
      growth.track('mission_completed', { kind: now?.daily.concat(now.weekly).find((item) => item.id === mission.id)?.kind ?? 'unknown' })
    }
  } finally { working.value = null }
}
async function swap(mission: MissionRow): Promise<void> {
  if (working.value) return
  working.value = { id: mission.id, what: 'swap' }
  try {
    const result = await game.command('missions.reroll', { id: mission.id })
    if (result.ok) game.toast(game.state.value.message || 'Swapped.', 'info')
  } finally { working.value = null }
}
function go(mission: MissionRow): void {
  if (mission.go) { const [venue, spot] = mission.go; if (venue) { shell.close(); void goTo(venue, spot) } } else if (mission.open) shell.open(mission.open)
}
</script>

<template>
  <div class="missions">
    <p v-if="!m">Missions are not available right now.</p>
    <!-- A guest of the quick start follows the starter goals first: one line of guidance at a time. -->
    <template v-else-if="m.locked">
      <HeroCard label="Missions" figure="Settle in first" class="gr-hero"><p class="gr-lock">{{ m.locked }}</p></HeroCard>
      <BaseButton variant="primary" block @click="shell.open('onboarding')">Settle in</BaseButton>
    </template>
    <p v-else-if="noMissions" class="gr-note">{{ view.connected ? 'Today’s missions are being dealt…' : noteWhy }}</p>
    <template v-else>
      <HeroCard :label="`Today in ${view.city.name}`" :figure="`${m.dailySet.done} of ${m.dailySet.total} missions done`" class="gr-hero">
        <div class="gr-dots" aria-hidden="true"><i v-for="mission in m.daily" :key="mission.id" :class="{ 'is-on': mission.done }" /></div>
        <p>New missions in {{ resetsIn }}. Missing a day costs you nothing.</p>
      </HeroCard>
      <ul class="gr-list" aria-label="Today’s missions">
        <MissionItem v-for="mission in m.daily" :key="mission.id" :mission="mission" scope="daily" :rerolls-left="m.rerollsLeft" :why="collectWhy" :pending="pendingOf(mission)" @claim="claim(mission)" @swap="swap(mission)" @go="go(mission)" />
      </ul>
      <p v-if="setLine(m.dailySet, 'today')" class="gr-set">{{ setLine(m.dailySet, 'today') }}</p>
      <BaseButton v-if="m.dailySet.done" block :disabled="growth.state.busy !== null" @click="growth.share('missions')">{{ growth.state.busy === 'missions' ? 'Preparing…' : 'Share today’s result' }}</BaseButton>

      <SectionTitle :note="`resets in ${weekIn}`">This week</SectionTitle>
      <ul class="gr-list" aria-label="This week’s missions">
        <MissionItem v-for="mission in m.weekly" :key="mission.id" :mission="mission" scope="weekly" :rerolls-left="0" :why="collectWhy" :pending="pendingOf(mission)" @claim="claim(mission)" @swap="swap(mission)" @go="go(mission)" />
      </ul>
      <p v-if="setLine(m.weeklySet, 'this week')" class="gr-set">{{ setLine(m.weeklySet, 'this week') }}</p>

      <SectionTitle>Your week</SectionTitle>
      <div class="gr-card">
        <h3>{{ m.stamps.days }} of 7 days played</h3>
        <div class="gr-stamps" aria-hidden="true"><i v-for="(cell, index) in stamps" :key="index" :class="{ 'is-on': cell === 'stamped', 'is-goal': cell === 'goal' }"><GameIcon v-if="cell === 'stamped'" name="good" :size="18" /></i></div>
        <p>{{ stampsNote(m.stamps) }}</p>
        <p><b>{{ m.activeDays }}</b> {{ daysTail(m, view.city.name) }}</p>
        <BaseButton :disabled="growth.state.busy !== null" @click="growth.share('week')">{{ growth.state.busy === 'week' ? 'Preparing…' : 'Share my week' }}</BaseButton>
      </div>
      <HowItWorks id="missions-rules" :rules="rules" />
    </template>
  </div>
</template>

<style scoped>
.gr-hero :deep(.hero-card-note) { display: grid; gap: 4px; }
.gr-hero p { margin: 0; }
.gr-lock { font-size: 14px; line-height: 1.5; }
.gr-dots { display: flex; gap: 6px; margin-top: 6px; }
.gr-dots i { width: 22px; height: 22px; border-radius: 7px; background: rgba(255, 255, 255, .28); display: block; }
.gr-dots i.is-on { background: #fff; }
.gr-list { list-style: none; margin: 0 0 var(--s-3); padding: 0; display: grid; gap: var(--s-2); }
:global(.ph.is-wide) .gr-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.gr-set { font-size: 12px; color: var(--c-muted); margin: calc(var(--s-2) * -1) 2px var(--s-3); }
.gr-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gr-stamps { display: flex; gap: 6px; margin: 6px 0; }
.gr-stamps i { width: 30px; height: 30px; border-radius: 50%; border: 2px dashed var(--c-line); display: grid; place-items: center; color: #fff; }
.gr-stamps i.is-on { border: 0; background: var(--c-green); }
.gr-stamps i.is-goal { border-color: var(--c-amber); }
.gr-card { background: #fff; border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 14px; margin: 0 0 var(--s-3); }
.gr-card h3 { margin: 0 0 4px; font-size: 15px; }
.gr-card p { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--c-ink-2); }
</style>
