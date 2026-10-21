<script setup lang="ts">
// Allworld House (docs/ALLWORLD-HOUSE.md): the season's AI housemates (always marked AI) with today's diary-room line, an adult's one save
// vote a week, the weeks with their reveals and share cards, and on Sunday night the eviction stage (stage mode, world-events/StagePanel).
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { loadHouse, voteHousemate, watch } from './watchStore.ts'
import { shareGist } from '../growth/shareMoment.ts'
import { HOUSE } from '../../../watch/house.ts'

const StagePanel = defineAsyncComponent(() => import('../world-events/StagePanel.vue'))
const { game, shell } = useApp()
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void loadHouse(true); timer = setInterval(() => { void loadHouse() }, 30000) })
onBeforeUnmount(() => { if (timer !== undefined) clearInterval(timer) })
const season = computed(() => watch.house?.season ?? null)
const problem = ref<string | null>(null)
const when = (at: number): string => new Date(at).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' })
const status = computed(() => {
  const s = season.value
  if (!s) return ''
  if (s.phase === 'announced') return `Season ${s.number} starts ${new Date(s.startsAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}.`
  if (s.phase === 'voting') return `Week ${s.week} of ${s.weeks}, day ${s.day}. Eviction night: ${when(s.weekList[s.week - 1]!.evictAt)}.`
  if (s.phase === 'eviction') return s.weekList[s.week - 1]?.out ? 'Eviction night: the result is in.' : `Eviction night is live. The reveal is at ${when(s.weekList[s.week - 1]!.revealAt)}.`
  if (s.phase === 'stopped') return 'This season was stopped.'
  return 'The season is over.'
})
const fixedName = (id: string | null): string => season.value?.mates.find((mate) => mate.id === id)?.label ?? ''
async function vote(mate: string): Promise<void> {
  problem.value = await voteHousemate(mate)
  if (!problem.value) game.toast(`You saved ${fixedName(mate)} this week.`, 'good')
}
const fail = (): void => game.toast('That could not be shared. Try again.', 'error')
const inSquare = computed(() => season.value?.room === 'world:square')
</script>

<template>
  <div class="watch-part" data-watch="house">
    <p class="social-note">{{ HOUSE.title }}: a four-week season in a house, with AI housemates. Adults vote every week to save one; on Sunday night the one with the fewest saves leaves, live on the stage. The last Sunday crowns the winner.</p>
    <p v-if="!watch.house" class="social-note">Loading…</p>
    <template v-else-if="!season">
      <p class="social-note">No season is on. The next one is announced here and in the Gist.</p>
    </template>
    <template v-else>
      <header class="watch-head"><h3>Season {{ season.number }}</h3><p class="social-note" data-watch="house-status">{{ status }}</p></header>
      <p v-if="problem" class="ui-error" role="alert">{{ problem }}</p>
      <p v-if="season.canVote && !season.voted" class="social-note">Tap “Save” on the housemate you want to keep. One vote a week.</p>
      <p v-else-if="season.voted" class="social-note" data-watch="voted">You saved {{ fixedName(season.voted) }} this week.</p>
      <div class="watch-mates">
        <article v-for="mate in season.mates" :key="mate.id" class="watch-mate" :class="{ 'is-out': !mate.in, 'is-winner': mate.winner }" :data-watch-mate="mate.id">
          <header><strong>{{ mate.label }}</strong><small>{{ mate.winner ? '🏆 Winner' : mate.in ? mate.city.replace(/-/g, ' ') : `Left in week ${mate.outWeek}` }}</small></header>
          <p v-if="mate.diary" class="watch-diary">Diary room: “{{ mate.diary }}”</p>
          <button v-if="season.canVote && mate.in && !season.voted" type="button" class="social-btn" data-watch="save" :disabled="watch.busy" @click="vote(mate.id)">Save</button>
        </article>
      </div>
      <section v-if="season.phase === 'eviction' || season.phase === 'voting'" class="watch-stage">
        <StagePanel v-if="season.phase === 'eviction'" :room="season.room" />
        <p class="social-note">{{ inSquare ? 'Eviction night is on the stage in the Square.' : 'Eviction night is on the stage in the house.' }}</p>
        <button v-if="inSquare" type="button" class="ui-button" data-watch="square" @click="shell.open('places')">Go to the Square</button>
      </section>
      <section class="watch-weeks" aria-label="The weeks">
        <p v-for="item in season.weekList" :key="item.week" class="social-note">
          <b>{{ item.finale ? 'Finale' : `Week ${item.week}` }}</b> · {{ when(item.evictAt) }}
          <template v-if="item.out"> · {{ item.finale ? 'Winner' : 'Left' }}: {{ item.out }} ({{ item.share }}% of {{ item.voters }} votes)</template>
          <button v-if="item.line" type="button" class="social-btn" data-watch="share-week" @click="shareGist(item.line, fail)">Share</button>
        </p>
      </section>
    </template>
    <p v-if="watch.house?.past.length" class="social-note">Earlier seasons: <span v-for="(item, at) in watch.house.past" :key="item.number">{{ at ? ' · ' : '' }}Season {{ item.number }}{{ item.winner ? `: ${item.winner}` : '' }}</span></p>
  </div>
</template>

<style scoped>
.watch-part { display: grid; gap: 10px; }
.watch-head h3 { margin: 0; }
.watch-mates { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.watch-mate { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid var(--c-line, #ddd); border-radius: var(--r-sm, 10px); background: var(--c-fill, #f7f7f7); }
.watch-mate header { display: grid; }
.watch-mate small { color: var(--c-ink-2, #666); font-size: 12px; text-transform: capitalize; }
.watch-mate.is-out { opacity: 0.6; }
.watch-mate.is-winner { border-color: #d9a21b; }
.watch-diary { margin: 0; font-size: 13px; font-style: italic; }
.watch-stage, .watch-weeks { display: grid; gap: 6px; }
</style>
