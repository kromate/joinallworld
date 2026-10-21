<script setup lang="ts">
// My Life is a readable projection of the systems that already own progress. It does not create
// awards or infer history: every line comes from the current LifeView and every action reuses an
// existing destination.
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import type { AchievementRow } from '../../../types/achievements.ts'
import type { MissionRow, RelationshipCard } from '../../../types/view.ts'
import { cityName } from '../../../game/cities/registry.ts'
import { linkWords } from '../../../ui/link.ts'
import { useApp } from '../../state/app.ts'
import BaseButton from '../../ui/BaseButton.vue'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { until } from '../growth/growthModel.ts'
import { stampCells, stampsNote } from '../growth/missionsLines.ts'
import { SETTLE_FIRST_HINT, startSettling } from '../start/settleModel.ts'
import { PASSPORT_TABS, campusLine, careerLine, lifetimeLines, missionProgress, nextStep, originLine, pathLabel, playerFriendsOf, residentsOf } from './passportModel.ts'
import type { PassportStep, PassportTab } from './passportModel.ts'
import EpisodeCard from './EpisodeCard.vue'
import JourneyCollection from './JourneyCollection.vue'
import ProjectBoard from './ProjectBoard.vue'
import RhythmCard from './RhythmCard.vue'
import SeasonCard from './SeasonCard.vue'
import { useRetention } from './useRetention.ts'

const PublicProfile = defineAsyncComponent(() => import('../social/PublicProfile.vue'))
const StoryModePanel = defineAsyncComponent(() => import('../story/StoryModePanel.vue'))
// The share loops (docs/SHARE-LOOPS.md): passport, Wrapped, street fame, the start card and the street video, fetched when the tab is opened.
const LoopsHub = defineAsyncComponent(() => import('../shareloops/LoopsHub.vue'))

const props = defineProps<{ params?: unknown }>()
const askedTab = (props.params as { tab?: unknown } | null)?.tab
const askedStoryHelp = (props.params as { storyHelp?: unknown } | null)?.storyHelp
const tab = ref<PassportTab>(PASSPORT_TABS.some(([id]) => id === askedTab) ? askedTab as PassportTab : 'today')
const { game, shell, goTo } = useApp()
const view = game.view
const missions = computed(() => view.value.missions)
const step = computed(() => nextStep(missions.value))
const dailyReset = computed(() => until(missions.value.resetAt, view.value.now))
const weeklyReset = computed(() => until(missions.value.weekResetAt, view.value.now))
const stamps = computed(() => stampCells(missions.value.stamps))
const storyDream = computed(() => view.value.goals.dream)
const student = computed(() => view.value.unilagStudent ?? null)
const records = computed(() => lifetimeLines(missions.value, view.value.goals, view.value.career, student.value))
const titles = computed(() => missions.value.titles)
const friends = computed(() => playerFriendsOf(view.value.social))
const residents = computed(() => residentsOf(view.value.social).slice(0, 8))
const achievements = computed(() => view.value.achievements ?? null)
const episodes = computed(() => (view.value.episodes?.rows ?? []).filter(row => row.cityId === view.value.cityId))
const travelEpisodes = computed(() => (view.value.episodes?.rows ?? []).filter(row => row.cityId !== view.value.cityId))
const disconnected = computed(() => !view.value.connected ? linkWords(view.value)?.why ?? 'Reconnect to continue.' : '')
const zeroCash = computed(() => view.value.wallet.cash === 0 && !view.value.onboarding.guest)
const homeActionLabel = computed(() => view.value.onboarding.guest ? SETTLE_FIRST_HINT : 'Go home first')
const retention = useRetention()
const collections = computed(() => retention.state.view?.collections ?? [])
const achievementPending = ref<string | null>(null)
const earnedAchievements = computed(() => achievements.value?.rows.filter(row => row.earnedAt !== null) ?? [])
const trackedSince = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })

function chooseTab(next: PassportTab): void { tab.value = next }
function onTabKey(event: KeyboardEvent, index: number): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? PASSPORT_TABS.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + PASSPORT_TABS.length) % PASSPORT_TABS.length
  const id = PASSPORT_TABS[next]![0]
  tab.value = id
  requestAnimationFrame(() => document.getElementById(`passport-tab-${id}`)?.focus())
}
function follow(target: PassportStep): void {
  if (target.go?.[0]) { shell.close(); void goTo(target.go[0], target.go[1]); return }
  if (target.open) shell.open(target.open)
}
function followMission(mission: MissionRow): void {
  if (mission.done || (!mission.open && !mission.go)) { shell.open('missions'); return }
  follow({ label: mission.label, detail: mission.hint, ...(mission.open ? { open: mission.open } : {}), ...(mission.go ? { go: mission.go } : {}) })
}
function openPerson(person: RelationshipCard): void {
  shell.open('person', person.npc ? { npc: person.id } : { player: person.id, name: person.name })
}
function achievementDate(at: number): string { return trackedSince.format(new Date(at)) }
function achievementCity(id: string): string { return cityName(id) ?? id }
function goHome(): void {
  if (view.value.onboarding.guest) { startSettling(shell); return }
  shell.close(); void goTo('home')
}
function followAchievement(row: AchievementRow): void {
  if (row.next.go?.[0]) { shell.close(); void goTo(row.next.go[0], row.next.go[1]); return }
  if (row.next.open) shell.open(row.next.open)
}
function achievementNextReason(row: AchievementRow): string {
  if (disconnected.value) return disconnected.value
  if (!row.next.open) return ''
  const panel = shell.byId.get(row.next.open)
  return panel ? shell.gateOf(panel) ?? '' : ''
}
function openStory(): void {
  tab.value = 'story'
  requestAnimationFrame(() => document.getElementById('passport-panel-story')?.focus())
}
function openProject(): void {
  tab.value = 'people'
  requestAnimationFrame(() => document.getElementById('passport-panel-people')?.focus())
}
function pinReason(row: AchievementRow): string {
  if (disconnected.value) return disconnected.value
  if (achievementPending.value) return 'Another achievement change is being saved.'
  if (!row.pinned && (achievements.value?.pinned.length ?? 0) >= 3) return 'Unpin one of your three badges first.'
  return ''
}
async function togglePin(row: AchievementRow): Promise<void> {
  const book = achievements.value
  if (!book || row.earnedAt === null || pinReason(row)) return
  const ids = row.pinned ? book.pinned.filter(id => id !== row.id) : [...book.pinned, row.id]
  achievementPending.value = `pin:${row.id}`
  try {
    const result = await game.command('achievements.pin', { ids })
    if (result.ok) game.toast(row.pinned ? `${row.title} unpinned.` : `${row.title} pinned.`, 'good')
  } finally { achievementPending.value = null }
}
function displayReason(row: AchievementRow): string {
  if (disconnected.value) return disconnected.value
  if (achievementPending.value) return 'Another achievement change is being saved.'
  if (view.value.onboarding.guest) return SETTLE_FIRST_HINT
  if (game.state.value.location !== 'home') return 'Go to your home to change the plaque.'
  return ''
}
async function toggleDisplay(row: AchievementRow): Promise<void> {
  if (row.earnedAt === null || displayReason(row)) return
  achievementPending.value = `display:${row.id}`
  try {
    const result = await game.command('achievements.display', { id: row.displayed ? null : row.id })
    if (result.ok) game.toast(row.displayed ? 'Home plaque removed.' : `${row.title} is displayed at home.`, 'good')
  } finally { achievementPending.value = null }
}
onMounted(() => { void retention.load() })
</script>

<template>
  <div class="passport-app">
    <header class="passport-heading">
      <span class="passport-mark" aria-hidden="true"><GameIcon name="person" :size="24" /></span>
      <div><small>My Life</small><h3>{{ game.state.value.name }}</h3><p>{{ view.city.name }} · your progress and next steps</p></div>
    </header>

    <p v-if="disconnected" class="passport-offline" role="status"><GameIcon inline name="cloud-off" /> {{ disconnected }} Your saved life is still readable here.</p>

    <nav class="passport-tabs" role="tablist" aria-label="My Life sections">
      <button v-for="([id, label], index) in PASSPORT_TABS" :id="`passport-tab-${id}`" :key="id" type="button" role="tab" :aria-selected="tab === id" :aria-controls="`passport-panel-${id}`" :tabindex="tab === id ? 0 : -1" @click="chooseTab(id)" @keydown="onTabKey($event, index)">{{ label }}</button>
    </nav>

    <section v-if="tab === 'today'" id="passport-panel-today" role="tabpanel" aria-labelledby="passport-tab-today" tabindex="0">
      <template v-if="missions.locked">
        <EmptyState icon="home" title="Settle in to start your life record" :text="missions.locked">
          <BaseButton variant="primary" @click="startSettling(shell)">Settle in now</BaseButton>
        </EmptyState>
      </template>
      <template v-else>
        <HeroCard label="Next step" :figure="step.label">
          <p>{{ step.detail }}</p>
          <BaseButton variant="primary" :disabled="Boolean(disconnected)" :reason="disconnected" @click="follow(step)">{{ step.open === 'missions' ? 'Open Missions' : 'Continue' }}</BaseButton>
        </HeroCard>

        <section v-if="missions.pendingRewards.length || missions.pendingSetRewards.length" class="passport-saved" aria-label="Saved rewards">
          <div><GameIcon name="good" :size="21" /><span><b>Saved rewards</b><small>{{ missions.pendingRewards.length }} cash reward{{ missions.pendingRewards.length === 1 ? '' : 's' }}<template v-if="missions.pendingSetRewards.length"> · {{ missions.pendingSetRewards.length }} set bonus</template></small></span></div>
          <BaseButton small @click="shell.open('missions')">Review</BaseButton>
        </section>

        <RhythmCard />
        <SeasonCard :retention="retention" @open-story="openStory" @open-project="openProject" />

        <SectionTitle :note="`resets in ${dailyReset}`">Today’s missions</SectionTitle>
        <ul v-if="missions.daily.length" class="passport-list" aria-label="Today’s missions">
          <li v-for="mission in missions.daily" :key="mission.id">
            <button type="button" @click="followMission(mission)">
              <GameIcon :name="mission.done ? 'good' : 'goal'" :size="20" />
              <span><b>{{ mission.label }}</b><small>{{ mission.hint }}</small></span>
              <strong>{{ missionProgress(mission) }}</strong>
            </button>
          </li>
        </ul>
        <EmptyState v-else compact icon="missions" title="Today’s missions are being dealt" text="Open Missions after reconnecting or settling in." />

        <SectionTitle :note="`resets in ${weeklyReset}`">This week’s missions</SectionTitle>
        <ul v-if="missions.weekly.length" class="passport-list" aria-label="This week’s missions">
          <li v-for="mission in missions.weekly" :key="mission.id">
            <button type="button" @click="followMission(mission)">
              <GameIcon :name="mission.done ? 'good' : 'goal'" :size="20" />
              <span><b>{{ mission.label }}</b><small>{{ mission.hint }}</small></span>
              <strong>{{ missionProgress(mission) }}</strong>
            </button>
          </li>
        </ul>

        <SectionTitle>Four-of-seven card</SectionTitle>
        <section class="passport-week">
          <div class="passport-stamps" :aria-label="`${missions.stamps.days} of 7 days played this week`">
            <span v-for="(cell, index) in stamps" :key="index" :class="`is-${cell}`"><GameIcon v-if="cell === 'stamped'" name="good" :size="16" /><i v-else aria-hidden="true" /></span>
          </div>
          <p><b>{{ missions.stamps.days }} of 7 days played.</b> {{ stampsNote(missions.stamps) }}</p>
          <p>{{ missions.weeklySet.done }} of {{ missions.weeklySet.total }} weekly missions complete.</p>
          <BaseButton small @click="shell.open('missions')">See the full week</BaseButton>
        </section>

        <section v-if="zeroCash" class="passport-guidance">
          <GameIcon name="jobs" :size="22" /><div><b>You can rebuild from ₦0</b><p>Jobs shows paid shifts. People and the Map also lead to free ways to spend time in the city.</p><BaseButton small @click="shell.open(view.career.employed ? 'career' : 'jobs')">{{ view.career.employed ? 'Open Career' : 'Find a job' }}</BaseButton></div>
        </section>
      </template>
    </section>

    <section v-else-if="tab === 'story'" id="passport-panel-story" role="tabpanel" aria-labelledby="passport-tab-story" tabindex="0">
      <StoryModePanel v-if="view.story?.enabled === true" :story-help="askedStoryHelp" />
      <SectionTitle>Life chapters</SectionTitle>
      <p class="passport-detail">Original stories set around this city’s playable places. The characters and story events are fiction.</p>
      <div v-if="episodes.length" class="passport-episodes" aria-label="Life chapters">
        <EpisodeCard v-for="episode in episodes" :key="episode.id" :row="episode" :disconnected="disconnected" />
      </div>
      <EmptyState v-else compact icon="book" title="No authored chapter is available yet" text="Your dream, career and campus progress are still recorded below." />

      <details v-if="travelEpisodes.length" class="passport-card">
        <summary>Chapters from your travels ({{ travelEpisodes.length }})</summary>
        <p class="passport-detail">Your choices and keepsakes travel with you. Return to a chapter’s city to continue it.</p>
        <EpisodeCard v-for="episode in travelEpisodes" :key="episode.id" :row="episode" :disconnected="disconnected" />
      </details>

      <template v-if="collections.length">
        <SectionTitle>Journey collection</SectionTitle>
        <div class="passport-collections" aria-label="Journey collections">
          <JourneyCollection v-for="collection in collections" :key="`${collection.id}:v${collection.version}`" :collection="collection" />
        </div>
        <p class="passport-honesty">Collections appear only where a place has published its own chapters.</p>
      </template>

      <SectionTitle>Dream</SectionTitle>
      <section v-if="storyDream" class="passport-card">
        <div class="passport-card-head"><GameIcon kind="dream" :id="storyDream.id" :emoji="storyDream.icon" :size="22" /><div><b>{{ storyDream.label }}</b><small>{{ storyDream.goal }}</small></div><strong>{{ storyDream.percent }}%</strong></div>
        <div class="passport-meter" role="meter" aria-label="Dream progress" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="storyDream.percent"><i :style="{ width: `${storyDream.percent}%` }" /></div>
        <BaseButton small @click="shell.open('goals')">Open Goals</BaseButton>
      </section>
      <EmptyState v-else compact icon="goals" title="Choose a dream" text="Your dream gives the longer story a direction."><BaseButton small @click="shell.open('goals')">Choose in Goals</BaseButton></EmptyState>

      <SectionTitle>Career</SectionTitle>
      <section class="passport-card">
        <div class="passport-card-head"><GameIcon name="jobs" :size="22" /><div><b>{{ view.career.employed ? view.career.role || view.career.label : 'Work' }}</b><small>{{ careerLine(view.career) }}</small></div></div>
        <p v-if="view.career.employed" class="passport-detail">{{ view.career.step.text }}</p>
        <BaseButton small @click="shell.open(view.career.employed ? 'career' : 'jobs')">{{ view.career.employed ? 'Resume Career' : 'Find work' }}</BaseButton>
      </section>

      <SectionTitle v-if="view.cityId === 'lagos'">Campus</SectionTitle>
      <section v-if="view.cityId === 'lagos'" class="passport-card">
        <div class="passport-card-head"><GameIcon name="campus" :size="22" /><div><b>{{ student?.programme?.label ?? 'University of Lagos' }}</b><small>{{ campusLine(student) }}</small></div></div>
        <BaseButton small @click="shell.open('campus')">{{ student?.status === 'deferred' ? 'Resume at Campus' : 'Open Campus' }}</BaseButton>
      </section>
    </section>

    <section v-else-if="tab === 'achievements'" id="passport-panel-achievements" role="tabpanel" aria-labelledby="passport-tab-achievements" tabindex="0">
      <PublicProfile v-if="game.session.value?.id" mode="profile" :id="game.session.value.id" :name="game.state.value.name" own />
      <template v-if="achievements">
        <section class="passport-achievement-summary" aria-labelledby="achievement-summary-title">
          <span aria-hidden="true"><GameIcon name="star" :size="22" /></span>
          <div><b id="achievement-summary-title">{{ achievements.earnedCount }} of {{ achievements.rows.length }} badges earned</b><small>Tracking since {{ achievementDate(achievements.trackingSince) }}</small></div>
          <strong v-if="achievements.pinned.length">{{ achievements.pinned.length }}/3 pinned</strong>
        </section>
        <details class="passport-achievement-about">
          <summary>About achievement tracking</summary>
          <div>
            <p>Tracking began {{ achievementDate(achievements.trackingSince) }}. Earlier activity does not become an award unless a saved completion proves it.</p>
            <p>Human-played and agent-assisted progress can qualify. Each badge keeps the place and play origin recorded when it was earned.</p>
            <p v-if="achievements.displayed">One earned badge is displayed as a plaque at home.</p>
          </div>
        </details>

        <ul class="passport-achievements" aria-label="Achievement collection">
          <li v-for="row in achievements.rows" :key="row.id" :class="{ 'is-earned': row.earnedAt !== null }">
            <div class="passport-achievement-head">
              <span class="passport-achievement-icon" aria-hidden="true"><GameIcon :name="row.icon" :size="22" /></span>
              <span><small>{{ pathLabel(row.path) }}</small><b>{{ row.title }}</b></span>
              <strong>{{ row.earnedAt !== null ? 'Earned' : `${row.progress} / ${row.target}` }}</strong>
            </div>
            <p>{{ row.description }}</p>
            <div class="passport-meter" role="meter" :aria-label="`${row.title} progress`" aria-valuemin="0" :aria-valuemax="row.target" :aria-valuenow="row.progress"><i :style="{ width: `${Math.min(100, row.progress / row.target * 100)}%` }" /></div>
            <div v-if="row.earnedAt !== null" class="passport-achievement-actions">
              <BaseButton small :variant="row.pinned ? 'selected' : 'default'" :disabled="Boolean(pinReason(row))" :reason="pinReason(row)" :aria-pressed="row.pinned" @click="togglePin(row)">{{ achievementPending === `pin:${row.id}` ? 'Saving…' : row.pinned ? 'Pinned' : 'Pin badge' }}</BaseButton>
              <BaseButton small :variant="row.displayed ? 'selected' : 'default'" :disabled="Boolean(displayReason(row))" :reason="displayReason(row)" :aria-pressed="row.displayed" @click="toggleDisplay(row)">{{ achievementPending === `display:${row.id}` ? 'Saving…' : row.displayed ? 'Plaque displayed' : 'Display at home' }}</BaseButton>
            </div>
            <template v-else-if="row.next.open || row.next.go">
              <BaseButton small :disabled="Boolean(achievementNextReason(row))" :reason="achievementNextReason(row)" @click="followAchievement(row)">Continue toward this</BaseButton>
              <BaseButton v-if="row.next.open === 'buy' && achievementNextReason(row)" small :disabled="Boolean(disconnected)" :reason="disconnected" @click="goHome">{{ homeActionLabel }}</BaseButton>
            </template>
            <details v-if="row.origins.length || row.earnedAt !== null" class="passport-achievement-record">
              <summary>{{ row.earnedAt !== null ? 'Badge record' : 'Progress record' }}</summary>
              <p v-if="row.origins.length">{{ originLine(row.origins) }}.</p>
              <p v-if="row.earnedAt !== null">Earned {{ achievementDate(row.earnedAt) }}<template v-if="row.earnedCity"> in {{ achievementCity(row.earnedCity) }}</template>. {{ row.reward }}. Recognition only; no cash or stars.</p>
            </details>
          </li>
        </ul>
        <section v-if="earnedAchievements.length && game.state.value.location !== 'home'" class="passport-guidance">
          <GameIcon name="home" :size="22" /><div><b>{{ view.onboarding.guest ? 'Settle in to get your home' : 'Display one earned plaque at home' }}</b><p>{{ view.onboarding.guest ? 'Your earned badges stay saved. Settle in, then choose one to display at home.' : 'Go home, then choose Display at home on the achievement you want visitors to see.' }}</p><BaseButton small @click="goHome">{{ view.onboarding.guest ? SETTLE_FIRST_HINT : 'Go home' }}</BaseButton></div>
        </section>
      </template>
      <EmptyState v-else compact icon="star" title="Achievement tracking is not available yet" text="Your existing titles and lifetime record are still shown below." />

      <SectionTitle>Earned titles</SectionTitle>
      <ul v-if="titles.length" class="passport-titles" aria-label="Earned titles">
        <li v-for="title in titles" :key="title"><GameIcon name="star" :size="18" /><b>{{ title }}</b></li>
      </ul>
      <EmptyState v-else compact icon="star" title="No title earned yet" text="Titles come from days played. There is no streak to lose."><BaseButton small @click="shell.open('missions')">See Missions</BaseButton></EmptyState>

      <SectionTitle>Lifetime record</SectionTitle>
      <dl class="passport-records">
        <div v-for="record in records" :key="record.id"><dt>{{ record.label }}</dt><dd>{{ record.value }}</dd></div>
      </dl>
      <p class="passport-honesty">Lifetime totals and titles come from your saved record. Badges appear only after their criteria are recorded.</p>
    </section>

    <section v-else-if="tab === 'moments'" id="passport-panel-moments" role="tabpanel" aria-labelledby="passport-tab-moments" tabindex="0">
      <LoopsHub />
    </section>

    <section v-else id="passport-panel-people" role="tabpanel" aria-labelledby="passport-tab-people" tabindex="0">
      <SectionTitle>Shared project</SectionTitle>
      <ProjectBoard />

      <SectionTitle>Player friends</SectionTitle>
      <ul v-if="friends.length" class="passport-people" aria-label="Player friends">
        <li v-for="person in friends" :key="person.id"><button type="button" @click="openPerson(person)"><span class="passport-avatar" aria-hidden="true">{{ person.emoji }}</span><span><b>{{ person.name }}</b><small>Player friend<template v-if="person.next"> · {{ person.points }} of {{ person.next.min }} toward {{ person.next.label }}</template></small></span><GameIcon name="chevron" :size="17" /></button></li>
      </ul>
      <EmptyState v-else compact icon="people" title="No player friends recorded here yet" text="Meet players in places around town, then send a friend request."><BaseButton small @click="shell.open('people')">Open People</BaseButton></EmptyState>

      <SectionTitle>Residents you know</SectionTitle>
      <ul v-if="residents.length" class="passport-people" aria-label="Residents you know">
        <li v-for="person in residents" :key="person.id"><button type="button" @click="openPerson(person)"><span class="passport-avatar" aria-hidden="true">{{ person.emoji }}</span><span><b>{{ person.name }}</b><small>Resident · {{ person.role }} · {{ person.tierLabel }}<template v-if="person.next"> · next: {{ person.next.label }}</template><template v-if="person.where"> · {{ person.where }}</template></small></span><GameIcon name="chevron" :size="17" /></button></li>
      </ul>
      <EmptyState v-else compact icon="handshake" title="No resident relationships yet" text="Talk to a resident at a venue and they will appear here."><BaseButton small @click="shell.open('map')">Find a place</BaseButton></EmptyState>

      <div class="passport-people-actions"><BaseButton small @click="shell.open('people')">People nearby</BaseButton><BaseButton small @click="shell.open('contacts')">Open Contacts</BaseButton></div>
    </section>
  </div>
</template>

<style scoped>
.passport-app { container: passport / inline-size; display: grid; gap: var(--s-2); min-width: 0; padding-bottom: var(--s-4); color: var(--c-ink); }
.passport-heading { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; padding: 3px 2px 13px; border-bottom: 1px solid var(--c-line); }
.passport-mark { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 15px; background: #e8f0ff; color: #254f91; }
.passport-heading small,.passport-heading p { margin: 0; color: var(--c-muted); font-size: 12px; }
.passport-heading h3 { margin: 1px 0; font-size: 20px; line-height: 1.1; }
.passport-offline { margin: 2px 0; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-amber-soft, #fff6d8); color: var(--c-ink-2); font-size: 13px; line-height: 1.4; }
.passport-tabs { position: sticky; top: -1px; z-index: 2; display: flex; gap: 3px; min-width: 0; margin: 0 -4px var(--s-2); padding: 4px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; border-radius: 13px; background: var(--c-fill); -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 22px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 22px), transparent); }
.passport-tabs::-webkit-scrollbar { display: none; }
.passport-tabs button { flex: 1 0 auto; min-width: 44px; min-height: 44px; padding: 6px 12px; border: 0; border-radius: 10px; background: transparent; color: var(--c-muted); font: 650 13px/1.2 var(--font); cursor: pointer; white-space: nowrap; }
.passport-tabs button[aria-selected="true"] { background: var(--c-surface-solid); color: var(--c-ink); box-shadow: var(--e-1), var(--ring); }
.passport-tabs button:focus-visible,.passport-list button:focus-visible,.passport-people button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.passport-app [role="tabpanel"] { min-width: 0; outline: none; }
.passport-app :deep(.hero-card) { margin-bottom: var(--s-2); }
.passport-app :deep(.hero-card-note) { display: grid; justify-items: start; gap: 10px; }
.passport-app :deep(.hero-card-note p) { margin: 0; }
.passport-saved { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 12px; border-radius: var(--r-md); background: var(--c-green-soft); }
.passport-saved > div { display: flex; min-width: 0; gap: 9px; align-items: center; }
.passport-saved b,.passport-saved small,.passport-card-head b,.passport-card-head small,.passport-people b,.passport-people small { display: block; }
.passport-saved small,.passport-card-head small,.passport-people small { margin-top: 2px; color: var(--c-muted); font-size: 12px; line-height: 1.35; }
.passport-list,.passport-titles,.passport-people { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.passport-list button,.passport-people button { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 9px; align-items: center; width: 100%; min-height: var(--tap); padding: 11px 12px; border: 0; border-radius: var(--r-sm); background: #fff; box-shadow: var(--e-1), var(--ring); color: inherit; text-align: left; cursor: pointer; }
.passport-list b,.passport-list small { display: block; }
.passport-list small { margin-top: 2px; color: var(--c-muted); font-size: 12px; line-height: 1.35; }
.passport-list strong { color: var(--c-green-dark); font-size: 12px; white-space: nowrap; }
.passport-week,.passport-card,.passport-guidance { padding: 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.passport-week p,.passport-detail,.passport-guidance p { margin: 8px 0; color: var(--c-ink-2); font-size: 13px; line-height: 1.45; }
.passport-stamps { display: grid; grid-template-columns: repeat(7, minmax(24px, 1fr)); gap: 5px; }
.passport-stamps span { aspect-ratio: 1; display: grid; place-items: center; border: 2px dashed var(--c-line); border-radius: 50%; color: #fff; }
.passport-stamps span.is-stamped { border: 0; background: var(--c-green); }
.passport-stamps span.is-goal { border-color: var(--c-amber); }
.passport-stamps i { width: 4px; height: 4px; border-radius: 50%; background: var(--c-line); }
.passport-guidance { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; margin-top: var(--s-3); background: #fff8e8; }
.passport-guidance b { font-size: 14px; }
.passport-card { display: grid; justify-items: start; gap: 11px; }
.passport-episodes,.passport-collections { display: grid; gap: 10px; }
.passport-card-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; }
.passport-meter { width: 100%; height: 8px; overflow: hidden; border-radius: 99px; background: var(--c-fill); }
.passport-meter i { display: block; height: 100%; border-radius: inherit; background: var(--c-green); }
.passport-titles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.passport-titles li { display: flex; align-items: center; gap: 8px; padding: 12px; border-radius: var(--r-sm); background: #fff8e8; box-shadow: var(--ring); }
.passport-records { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; }
.passport-records div { padding: 12px; border-radius: var(--r-sm); background: #fff; box-shadow: var(--e-1), var(--ring); }
.passport-records dt { color: var(--c-muted); font-size: 12px; line-height: 1.3; }
.passport-records dd { margin: 4px 0 0; font-size: 22px; font-weight: 750; }
.passport-honesty { margin: var(--s-3) 2px 0; color: var(--c-muted); font-size: 12px; line-height: 1.45; }
.passport-achievements { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.passport-achievements li { display: grid; justify-items: start; gap: 9px; padding: 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.passport-achievements li.is-earned { background: var(--c-amber-soft); }
.passport-achievement-summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 11px 12px; border-radius: var(--r-md); background: var(--c-green-soft); color: var(--c-ink); }
.passport-achievement-summary > span { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--c-surface-solid); color: var(--c-green-dark); }
.passport-achievement-summary b,.passport-achievement-summary small { display: block; }.passport-achievement-summary b { font-size: 14px; line-height: 1.3; }.passport-achievement-summary small { margin-top: 2px; color: var(--c-ink-2); font-size: 11px; }.passport-achievement-summary strong { color: var(--c-green-dark); font-size: 11px; white-space: nowrap; }
.passport-achievement-about { border-bottom: 1px solid var(--c-line); }.passport-achievement-about > summary,.passport-achievement-record > summary { display: flex; align-items: center; min-height: 44px; color: var(--c-green-dark); font-size: 12px; font-weight: 700; cursor: pointer; }.passport-achievement-about > div { margin-bottom: 10px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-fill); }.passport-achievement-about p { margin: 0 0 7px; color: var(--c-ink-2); font-size: 12px; line-height: 1.5; }.passport-achievement-about p:last-child { margin-bottom: 0; }
.passport-achievement-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; }
.passport-achievement-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 13px; background: var(--c-fill); color: var(--c-green-dark); }
.passport-achievement-head small,.passport-achievement-head b { display: block; }
.passport-achievement-head small { color: var(--c-muted); font-size: 11px; }
.passport-achievement-head strong { color: var(--c-green-dark); font-size: 12px; white-space: nowrap; }
.passport-achievements p { margin: 0; color: var(--c-ink-2); font-size: 13px; line-height: 1.45; }
.passport-achievement-record { width: 100%; border-top: 1px solid var(--c-line); }.passport-achievement-record > summary { min-height: 36px; }.passport-achievement-record p { margin: 0 0 6px; color: var(--c-muted); font-size: 12px; }.passport-achievement-record p:last-child { margin-bottom: 4px; }
.passport-achievement-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.passport-avatar { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: var(--c-fill); font-size: 20px; }
.passport-people-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: var(--s-3); }
@container passport (max-width: 300px) {
  .passport-achievement-head strong { grid-column: 2; justify-self: start; }
  .passport-titles,.passport-records { grid-template-columns: 1fr; }
  .passport-list button,.passport-people button { padding-inline: 10px; }
}
</style>
