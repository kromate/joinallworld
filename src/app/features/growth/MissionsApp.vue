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
import { getDailyMilestones } from '../../../game/cadence.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import MissionItem from './MissionItem.vue'
import AgentMissionItem from './AgentMissionItem.vue'
import { agentRows } from './agentTasks.ts'
import { venueFor } from '../../../game/cities/runtime.ts'
import { daysTail, setLine, stampCells, stampsNote } from './missionsLines.ts'
import { until } from './growthModel.ts'
import { useGrowth } from './useGrowth.ts'
import { startSettling } from '../start/settleModel.ts'
import { useRetention } from '../passport/useRetention.ts'
import type { AgentMissionRow, MissionRewardView, MissionRow } from '../../../types/view.ts'

defineProps<{ params?: unknown }>()
const { game, shell, goTo } = useApp()
const growth = useGrowth()
const retention = useRetention()
const view = game.view
const m = computed(() => view.value.missions)
const collectWhy = computed(() => (view.value.connected ? null : linkWords(view.value)?.cannot('collect') ?? null))
const noteWhy = computed(() => linkWords(view.value)?.why ?? '')
const stamps = computed(() => (m.value ? stampCells(m.value.stamps) : []))
const resetsIn = computed(() => (m.value ? until(m.value.resetAt, view.value.now) : ''))
const weekIn = computed(() => (m.value ? until(m.value.weekResetAt, view.value.now) : ''))
// The tasks come with the growth hello (the engine of the first download does not carry them): see server/routes/growth.ts.
const agentTasks = computed(() => agentRows({ agent: growth.state.hello?.agentTasks }, view.value.now, game.state.value.estate.city, (city, venue) => venueFor(city, venue)?.label ?? null))
const noMissions = computed(() => Boolean(m.value) && !m.value?.daily.length && !m.value?.weekly.length && !m.value?.pendingRewards.length && !m.value?.pendingSetRewards.length && !agentTasks.value.length)
const dailyMilestones = computed(() => retention.state.view?.flags.dailyMilestones && m.value ? getDailyMilestones(m.value.dailySet.done) : null)
const rules = computed(() => [
  'Three missions a day and three a week: one about your life, one about the city, one about people.',
  `A daily mission pays ${money(m.value?.daily[0]?.cash ?? 250)} and a weekly one ${money(m.value?.weekly[0]?.cash ?? 1000)}, once, when you collect it. Completing all three of a set adds stars.`,
  'Unfinished progress resets at midnight (weekly progress on Monday), Nigerian time. A completed cash reward stays saved until you collect it.',
  'If your star balance is full, a completed set bonus stays saved and new missions of that period wait until it fits.',
  'You can swap one unfinished daily mission a day.',
  'People around town (the AI-played characters, marked as such) give out tasks in person: ask one in its place for a task. A task pays the figure shown, once; at most two a day.',
  'Your count of days only ever goes up. There is no streak to lose.',
])

// A task may have been given since the last hello, so this panel asks again when it is drawn.
onMounted(() => { void growth.load({ force: true }); void retention.load() })

/** Which control is on its way to the server: one at a time. */
const working = ref<{ key: string; what: 'claim' | 'swap' } | null>(null)
const pendingOf = (mission: MissionRow): 'claim' | 'swap' | null => (working.value?.key === (mission.rewardId ?? mission.id) ? working.value.what : null)
async function claim(mission: Pick<MissionRow, 'id' | 'rewardId' | 'rewardScope' | 'rewardPeriod' | 'rewardCityId' | 'kind'> | MissionRewardView): Promise<void> {
  if (working.value) return
  const rewardId = mission.rewardId
  const viewedReward = 'scope' in mission
    ? { scope: mission.scope, period: mission.period, cityId: mission.cityId }
    : { scope: mission.rewardScope, period: mission.rewardPeriod, cityId: mission.rewardCityId }
  working.value = { key: rewardId ?? mission.id, what: 'claim' }
  try {
    const result = await game.command('missions.claim', { id: mission.id, ...(rewardId ? { rewardId } : {}) })
    if (result.ok) {
      game.toast(game.state.value.message || 'Mission collected.', 'earn')
      growth.track('mission_completed', { kind: mission.kind })
      if (viewedReward.scope && viewedReward.period !== null && viewedReward.cityId) {
        growth.track('mission_reward_viewed_v2', { event_version: 2, mission: mission.id, scope: viewedReward.scope, period: viewedReward.period, city_id: viewedReward.cityId })
      }
    }
  } finally { working.value = null }
}
/** A task an agent gave in person: the same 'missions.claim', by the task's id. */
const pendingOfTask = (task: AgentMissionRow): 'claim' | 'swap' | null => (working.value?.key === task.id ? working.value.what : null)
async function claimTask(task: AgentMissionRow): Promise<void> {
  if (working.value) return
  working.value = { key: task.id, what: 'claim' }
  try {
    const result = await game.command('missions.claim', { id: task.id })
    if (result.ok) { game.toast(game.state.value.message || 'Task collected.', 'earn'); growth.track('mission_completed', { kind: 'agent' }); void growth.load({ force: true }) }
  } finally { working.value = null }
}
function goAgent(task: AgentMissionRow): void {
  const venue = task.go?.[0]
  if (venue) { shell.close(); void goTo(venue) }
}
async function swap(mission: MissionRow): Promise<void> {
  if (working.value) return
  working.value = { key: mission.id, what: 'swap' }
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
      <BaseButton variant="primary" block data-settle-now @click="startSettling(shell)">Settle in now</BaseButton>
    </template>
    <p v-else-if="noMissions" class="gr-note">{{ view.connected ? 'Today’s missions are being dealt…' : noteWhy }}</p>
    <template v-else>
      <template v-if="m.pendingRewards.length || m.pendingSetRewards.length">
        <SectionTitle>Saved rewards</SectionTitle>
        <ul v-if="m.pendingRewards.length" class="gr-list" aria-label="Saved mission rewards">
          <li v-for="reward in m.pendingRewards" :key="reward.rewardId" class="gr-saved">
            <GameIcon name="good" :size="22" aria-hidden="true" />
            <div><b>{{ reward.label }}</b><small>Completed {{ reward.scope === 'daily' ? 'daily' : 'weekly' }} mission · {{ money(reward.cash) }} ready</small></div>
            <BaseButton variant="primary" :disabled="Boolean(collectWhy) || working !== null" :reason="collectWhy" @click="claim(reward)">{{ working?.key === reward.rewardId ? 'Collecting…' : `Collect ${money(reward.cash)}` }}</BaseButton>
          </li>
        </ul>
        <div v-for="reward in m.pendingSetRewards" :key="reward.rewardId" class="gr-card gr-saved-stars">
          <b>+{{ reward.stars }} stars saved</b>
          <p>Your completed {{ reward.scope }} set bonus will be added automatically when your star balance has room. New {{ reward.scope }} missions will then appear.</p>
        </div>
      </template>

      <HeroCard v-if="m.daily.length" :label="`Today in ${view.city.name}`" :figure="`${m.dailySet.done} of ${m.dailySet.total} missions done`" class="gr-hero">
        <div class="gr-dots" aria-hidden="true"><i v-for="mission in m.daily" :key="mission.id" :class="{ 'is-on': mission.done }" /></div>
        <p>New missions in {{ resetsIn }}. Missing a day costs you nothing.</p>
      </HeroCard>
      <section v-if="dailyMilestones" class="gr-milestones" aria-labelledby="daily-milestones-title">
        <header><b id="daily-milestones-title">Today’s progress</b><strong>{{ dailyMilestones.displayPoints }} / 60</strong></header>
        <div class="gr-milestone-meter" role="meter" aria-label="Daily display points" aria-valuemin="0" aria-valuemax="60" :aria-valuenow="dailyMilestones.displayPoints"><i :style="{ width: `${dailyMilestones.displayPoints / 60 * 100}%` }" /></div>
        <ol aria-label="Daily milestones">
          <li v-for="milestone in dailyMilestones.milestones" :key="milestone.points" :class="{ 'is-reached': milestone.reached }"><GameIcon :name="milestone.reached ? 'good' : 'goal'" :size="15" /><span>{{ milestone.points }}</span></li>
        </ol>
        <p>Finish a mission to reach each milestone. Your usual mission rewards stay the same.</p>
      </section>
      <ul v-if="m.daily.length" class="gr-list" aria-label="Today’s missions">
        <MissionItem v-for="mission in m.daily" :key="mission.id" :mission="mission" scope="daily" :rerolls-left="m.rerollsLeft" :why="collectWhy" :pending="pendingOf(mission)" @claim="claim(mission)" @swap="swap(mission)" @go="go(mission)" />
      </ul>
      <p v-if="setLine(m.dailySet, 'today')" class="gr-set">{{ setLine(m.dailySet, 'today') }}</p>
      <BaseButton v-if="m.dailySet.total && m.dailySet.done === m.dailySet.total" block :disabled="growth.state.busy !== null" @click="growth.share('missions')">{{ growth.state.busy === 'missions' ? 'Preparing…' : 'Share today’s result' }}</BaseButton>

      <template v-if="agentTasks.length">
        <SectionTitle note="given in person">From agents</SectionTitle>
        <ul class="gr-list" aria-label="Tasks from agents">
          <AgentMissionItem v-for="task in agentTasks" :key="task.id" :task="task" :why="collectWhy" :pending="pendingOfTask(task)" @claim="claimTask(task)" @go="goAgent(task)" />
        </ul>
      </template>

      <SectionTitle v-if="m.weekly.length" :note="`resets in ${weekIn}`">This week</SectionTitle>
      <ul v-if="m.weekly.length" class="gr-list" aria-label="This week’s missions">
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
.gr-dots i { width: 22px; height: 22px; border-radius: 7px; background: var(--c-fill-2, #e3e7e5); display: block; }
.gr-dots i.is-on { background: var(--c-green); }
.gr-milestones { display: grid; gap: 8px; margin: 0 0 var(--s-3); padding: 11px 12px; border-radius: var(--r-md); background: var(--c-surface-solid); box-shadow: var(--e-1), var(--ring); }.gr-milestones header { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }.gr-milestones header b { font-size: 14px; }.gr-milestones header strong { color: var(--c-green-dark); font-size: 12px; font-variant-numeric: tabular-nums; }.gr-milestones p { margin: 0; color: var(--c-muted); font-size: 11px; line-height: 1.45; }
.gr-milestone-meter { height: 7px; overflow: hidden; border-radius: var(--r-pill); background: var(--c-fill); }.gr-milestone-meter i { display: block; height: 100%; border-radius: inherit; background: var(--c-green); }
.gr-milestones ol { list-style: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 0; padding: 0; }.gr-milestones li { display: flex; justify-content: center; align-items: center; gap: 5px; min-height: 30px; border-radius: var(--r-sm); background: var(--c-fill); color: var(--c-muted); font-size: 11px; font-weight: 700; }.gr-milestones li.is-reached { background: var(--c-green-soft); color: var(--c-green-dark); }
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
.gr-saved { background: var(--c-green-soft); border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 12px 14px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.gr-saved b, .gr-saved small { display: block; }
.gr-saved small { color: var(--c-muted); font-size: 12px; line-height: 1.35; }
.gr-saved :deep(.game-icon) { color: var(--c-green); }
.gr-saved-stars { border-left: 4px solid var(--c-amber); }
.gr-saved-stars p { margin: 4px 0 0; }
</style>
