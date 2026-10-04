<script setup lang="ts">
// The shared half of Community: this week's Student Union election, the weekly clean-up goal and
// the leaderboards. It is read from the server, never worked out here; every name is text.
import { computed } from 'vue'
import CampusCard from './CampusCard.vue'
import CampusControl from './CampusControl.vue'
import CampusGo from './CampusGo.vue'
import { NOMINATE_NOTE, at, formatCount, goalView, nominateReason, sharedKey, standingRows, title, voteReason } from './campusModel.ts'
import { board, loadShared, postShared, useCampus } from './useCampus.ts'

const { game, state, connected, blocked, community, act } = useCampus()
// What was loaded for someone else (another person, another city) is not shown.
const same = computed(() => board.key === sharedKey(game.view.value))
const data = computed(() => (same.value ? board.data : null))
const loading = computed(() => same.value && board.loading)
const error = computed(() => (same.value ? board.error : ''))
const eligible = computed(() => community.value?.eligible === true)

const election = computed(() => data.value?.election ?? { phase: 'nominations' as const, week: null, candidates: [], winner: null })
const elections = computed(() => state.value.unilagCommunity?.elections)
const nominated = computed(() => (election.value.week !== null && board.nominated.has(election.value.week)) || Boolean(elections.value?.nominated?.includes(election.value.week as number)))
const voted = computed(() => (election.value.week !== null && board.voted.has(election.value.week)) || Boolean(elections.value?.voted?.includes(election.value.week as number)))
const nominateWhy = computed(() => nominateReason(connected.value, eligible.value, election.value.phase, nominated.value))
const candidates = computed(() => (Array.isArray(election.value.candidates) ? election.value.candidates : []))
const winner = computed(() => {
  const won = election.value.winner
  return won && (candidates.value.find((candidate) => candidate.id === won.id)?.name ?? '')
})
const goal = computed(() => goalView(data.value?.goal))
const union = computed(() => at(state.value, 'student-union'))
const retry = (): void => loadShared(game, true)
const sending = (tag: string): boolean => board.pending.has(tag)
const nominateLabel = computed(() => (sending('nominate') ? 'Nominating…' : nominated.value ? 'Nominated' : 'Nominate yourself'))
const nominateTitle = computed(() => (nominateWhy.value || (sending('nominate') ? 'Sending nomination…' : '')))
function voteTitle(id: string): string { const why = voteReason(connected.value, eligible.value, election.value.phase, voted.value); return why || (sending(`vote:${id}`) ? 'Sending your vote…' : '') }
</script>

<template>
  <CampusCard v-if="!connected && !data" icon="🌍" heading="Shared campus"><p>Reconnect to load the live election, leaderboards and weekly goal.</p></CampusCard>
  <CampusCard v-else-if="loading && !data" icon="🌍" heading="Shared campus"><p role="status">Loading the live campus board…</p></CampusCard>
  <CampusCard v-else-if="error && !data" icon="🌍" heading="Shared campus">
    <p class="ui-error" role="alert">{{ error }}</p>
    <template #extra><button type="button" class="ui-button" @click="retry">Try again</button></template>
  </CampusCard>
  <CampusCard v-else-if="!data" icon="🌍" heading="Shared campus"><p role="status">Loading the live campus board…</p></CampusCard>
  <CampusCard v-else-if="data.available === false" icon="🌍" heading="Shared campus">
    <p>The shared UNILAG election, leaderboards and weekly goal are available in Lagos. Travel to campus to take part.</p>
    <template #extra><CampusGo spot="main-gate" label="Travel to UNILAG" class="is-primary" /></template>
  </CampusCard>

  <template v-else>
    <CampusCard icon="🗳️" :heading="`Student Union · ${title(election.phase)}`">
      <p>Week {{ election.week ?? '—' }}<template v-if="winner"> · Winner: {{ winner }}</template></p>
      <div v-for="candidate in candidates" :key="candidate.id" class="campus-row">
        <div><strong>{{ candidate.name }}</strong><small>{{ formatCount(candidate.votes) }} vote{{ candidate.votes === 1 ? '' : 's' }}</small></div>
        <button type="button" class="ui-button" :disabled="Boolean(voteTitle(candidate.id))" :title="voteTitle(candidate.id) || undefined" @click="postShared(game, 'vote', candidate.id)">{{ sending(`vote:${candidate.id}`) ? 'Voting…' : 'Vote' }}</button>
      </div>
      <p v-if="!candidates.length" class="campus-note">No candidates yet.</p>
      <template #extra>
        <button type="button" class="ui-button is-primary" :disabled="Boolean(nominateTitle)" :title="nominateTitle || undefined" @click="postShared(game, 'nominate')">{{ nominateLabel }}</button>
        <small v-if="nominateWhy && !nominated" class="campus-why">{{ nominateWhy }}</small>
      </template>
    </CampusCard>

    <CampusCard icon="🤝" heading="Weekly clean-up goal">
      <div class="campus-goal">
        <div><strong>{{ goal.progress }} / {{ goal.target }}</strong><span>{{ goal.complete ? 'Complete' : NOMINATE_NOTE }}</span></div>
        <div :aria-label="`${goal.percent}% complete`"><i :style="{ width: `${goal.percent}%` }" /></div>
      </div>
      <template #extra>
        <CampusControl v-if="union" primary label="Volunteer today" :reason="blocked" @press="act('activity', { id: 'unilag-volunteer' })" />
        <CampusGo v-else spot="student-union" label="Go volunteer" />
      </template>
    </CampusCard>

    <div class="campus-grid campus-leaders">
      <CampusCard icon="🏫" heading="Faculty board">
        <ol v-if="standingRows(data.leaderboards?.faculty).length" class="campus-standings">
          <li v-for="row in standingRows(data.leaderboards?.faculty)" :key="row.key"><span>{{ row.name }}<small v-if="row.members">{{ row.members }}</small></span><b>{{ row.score }}</b></li>
        </ol>
        <p v-else class="campus-note">No faculty scores yet.</p>
      </CampusCard>
      <CampusCard icon="🏠" heading="Hall board">
        <ol v-if="standingRows(data.leaderboards?.hall).length" class="campus-standings">
          <li v-for="row in standingRows(data.leaderboards?.hall)" :key="row.key"><span>{{ row.name }}<small v-if="row.members">{{ row.members }}</small></span><b>{{ row.score }}</b></li>
        </ol>
        <p v-else class="campus-note">No hall scores yet.</p>
      </CampusCard>
    </div>
    <CampusCard icon="🏅" heading="Top players">
      <ol v-if="standingRows(data.leaderboards?.players).length" class="campus-standings">
        <li v-for="row in standingRows(data.leaderboards?.players)" :key="row.key"><span>{{ row.name }}<small v-if="row.members">{{ row.members }}</small></span><b>{{ row.score }}</b></li>
      </ol>
      <p v-else class="campus-note">No player scores yet.</p>
      <template #extra>
        <p v-if="error" class="ui-error">Refresh failed: {{ error }}</p>
        <button v-else type="button" class="ui-button campus-refresh" @click="retry">Refresh live board</button>
      </template>
    </CampusCard>
  </template>
</template>
