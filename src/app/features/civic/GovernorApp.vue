<script setup lang="ts">
// Governor: the election app (phase, countdown, candidates, live tally, run, vote, announce).
//
// GET /api/civic/gov also says exactly why this player can or cannot run, vote and announce, and
// every disabled control here shows that reason. The slogan and the announcement are bound to a
// draft that outlives the sheet, so a state update never touches what is being typed. Filing a
// candidacy keeps its request id until it is applied: pressing again after a lost answer repeats
// the SAME request, so the filing fee is taken once. The last refused vote stays beside the ballot
// (a toast is gone in seconds). The weekly cycle and all eligibility rules are original beta design.
import { computed, ref, watch } from 'vue'
import { civicTitle } from '../../../game/cities/terminology.ts'
import { useApp } from '../../state/app.ts'
import { isDeparting } from '../../../life.ts'
import type { GovResponse, PulseResponse } from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import CivicAction from './CivicAction.vue'
import CivicAvatar from './CivicAvatar.vue'
import CivicStale from './CivicStale.vue'
import CivicStatus from './CivicStatus.vue'
import GovernorNews from './GovernorNews.vue'
import GovernorSeat from './GovernorSeat.vue'
import { ELECTION } from './civicContent.ts'
import { govDraft as draft, govRefusal, govRunRequest } from './civicDrafts.ts'
import {
  CYCLE, NEXT, PHASES, announceWhy, announcementTooShort, barWidth, count, dateTime, electionRules, govKey, govPath, lastResultLine, pulseKey, pulsePath,
  refusalTitle, runWhy, sloganTooShort, until, voteWhy, votes,
} from './civicModel.ts'
import { useCivic, useLoaded, useOffline } from './useCivic.ts'

defineProps<{ params?: unknown }>()
const { game, shell, goTo } = useApp()
const civic = useCivic()
const offline = useOffline()
const view = game.view
const state = game.state
const role = computed(() => civicTitle(view.value.cityId))
const cityId = computed(() => view.value.cityId)
const { item, reload } = useLoaded<GovResponse>({ key: () => govKey(cityId.value), path: () => govPath(cityId.value), maxAge: 20000 })
// The city's news is on this screen: it is the Governor's "Updates" and clears the badge on the Phone.
const pulse = useLoaded<PulseResponse>({ key: () => pulseKey(cityId.value), path: () => pulsePath(cityId.value), maxAge: 60000 })
const notices = computed(() => pulse.item.value.data?.notices ?? [])
watch(notices, () => { if (civic.markNewsRead()) shell.bump() }, { immediate: true })

const data = computed(() => item.value.data)
const you = computed(() => data.value?.you ?? null)
const top = computed(() => Math.max(1, ...(data.value?.election.candidates.map((candidate) => candidate.votes) ?? [])))
const elsewhere = computed(() => Boolean(you.value && !you.value.vote.ok && you.value.vote.code === 'wrong_place'))
/** The refused vote is shown only beside the ballot of the city it was refused in. */
const refusal = computed(() => (govRefusal.value?.key === govKey(cityId.value) ? govRefusal.value : null))
const runField = ref<HTMLInputElement | null>(null)
const textField = ref<HTMLTextAreaElement | null>(null)

/** Where an unmet requirement can be worked on, by check id: 'work' is earned through paid shifts and gigs. */
const nextStep = (id: string): { label: string; open: string } | null => (id === 'work' ? { label: 'Open Jobs to find paid work', open: 'jobs' } : null)

/** What a write handed back: the fresh election, which replaces the cached one and redraws the screens behind. */
function done(result: Record<string, unknown>): void {
  if (result.gov) { civic.put(govKey(cityId.value), result.gov as GovResponse); civic.changed() }
}
async function run(): Promise<void> {
  if (sloganTooShort(draft.slogan)) { game.toast(`Write a slogan first (${ELECTION.sloganMin}–${ELECTION.sloganMax} characters). Nothing was charged.`, 'error'); runField.value?.focus(); return }
  const result = await civic.send('run', '/api/civic/gov/run', { slogan: draft.slogan, requestId: civic.requestId(govRunRequest, [cityId.value, draft.slogan]) }, { success: 'You are on the ballot.' })
  civic.requestDone(govRunRequest, result)
  if (result.ok) draft.slogan = ''
  done(result)
}
async function vote(candidate: string): Promise<void> {
  const result = await civic.send(`vote:${candidate}`, '/api/civic/gov/vote', { candidate }, { success: 'Your vote was counted.' })
  // A refusal the server explained (the per-connection vote limit, a missing requirement) stays beside the ballot.
  if (result.ok) govRefusal.value = null
  else if (result.reason && result.code !== 'busy' && result.code !== 'offline') govRefusal.value = { key: govKey(cityId.value), code: result.code, reason: result.reason }
  done(result)
}
async function announce(): Promise<void> {
  if (announcementTooShort(draft.announcement)) { game.toast('Write your announcement first.', 'error'); textField.value?.focus(); return }
  const result = await civic.send('announce', '/api/civic/gov/announce', { text: draft.announcement }, { success: 'Announcement posted.' })
  if (result.ok) draft.announcement = ''
  done(result)
}
function goVote(venue: string): void { shell.close(); void goTo(venue) }
</script>

<template>
  <div class="governor">
    <CivicStatus :item="item" @retry="reload" />
    <template v-if="data">
      <GovernorSeat :data="data" />
      <CivicStale :item="item" />
      <section class="governor-cycle" aria-label="This week’s election">
        <ol>
          <li v-for="step in CYCLE" :key="step.id" :class="{ 'is-now': step.id === data.phase }" :aria-current="step.id === data.phase ? 'step' : undefined"><b>{{ step.label }}</b><small>{{ step.days }}</small></li>
        </ol>
        <p><strong>{{ PHASES[data.phase] }}</strong><span>{{ NEXT[data.phase] }} in <b>{{ until(data.phaseEndsAt, view.now) }}</b> · {{ dateTime(data.phaseEndsAt) }}</span></p>
      </section>
      <p class="civic-note">{{ data.rules.pollingVenue ? 'Votes are cast in person at the Polling Unit.' : 'For now you vote from this app.' }}</p>
      <HowItWorks id="governor-rules" page label="How elections work" :rules="electionRules(data.rules)" />

      <SectionTitle>{{ data.phase === 'results' ? 'This week’s result' : 'Candidates' }}</SectionTitle>
      <EmptyState v-if="!data.election.candidates.length && data.phase === 'nominations'" icon="ballot" title="Nobody has declared yet" text="Be the first: see what you need under “Run for office” below." />
      <EmptyState v-else-if="!data.election.candidates.length" icon="ballot" title="Nobody stood in this election" text="Nominations open again on Monday, Lagos time." />
      <template v-else>
        <div class="governor-ballot">
          <div v-for="candidate in data.election.candidates" :key="candidate.id" class="governor-candidate" :class="{ 'is-chosen': data.election.yourVote === candidate.id }">
            <div class="governor-who">
              <CivicAvatar :name="candidate.name" :seed="candidate.id" />
              <strong>{{ candidate.name }}{{ candidate.you ? ' (you)' : '' }}</strong>
              <span v-if="data.phase !== 'nominations'">{{ votes(candidate.votes) }}</span>
            </div>
            <q>{{ candidate.slogan }}</q>
            <div v-if="data.phase !== 'nominations'" class="governor-bar" aria-hidden="true"><i :style="{ width: `${barWidth(candidate.votes, top)}%` }" /></div>
            <span v-if="data.election.yourVote === candidate.id" class="ui-chip is-good">Your vote</span>
            <CivicAction v-else-if="!data.election.yourVote && data.phase !== 'results'" :primary="data.phase === 'voting'" :working="civic.busy(`vote:${candidate.id}`)" :reason="voteWhy(offline('vote'), you)" @click="vote(candidate.id)">Vote for {{ candidate.name }}</CivicAction>
          </div>
        </div>
        <CivicAction v-if="elsewhere && data.phase === 'voting' && data.rules.pollingVenue" :reason="state.activeAction ? 'Finish your current action first.' : ''" @click="goVote(data.rules.pollingVenue)">Go to the Polling Unit</CivicAction>
        <div v-if="data.phase === 'voting' && !data.election.yourVote && refusal" class="civic-refusal" role="alert"><strong>{{ refusalTitle(refusal.code) }}</strong><p>{{ refusal.reason }}</p></div>
        <p v-if="data.phase === 'voting'" class="civic-note">{{ votes(data.election.totalVotes) }} cast so far. One vote per player; it cannot be changed.</p>
      </template>
      <p v-if="data.phase === 'results' && data.lastResult" class="civic-note">{{ lastResultLine(data.lastResult) }}</p>
      <template v-if="you && data.phase === 'voting' && !data.election.yourVote">
        <p class="civic-note">What you need to vote:</p>
        <ul class="civic-checks">
          <li v-for="check in you.vote.checks" :key="check.id" :class="check.met ? 'is-met' : 'is-unmet'">
            <i role="img" :aria-label="check.met ? 'Met' : 'Not met'"><GameIcon inline :name="check.met ? 'check' : 'close'" /></i>
            <div><strong>{{ check.label }}</strong><small>{{ check.detail }}</small><button v-if="!check.met && nextStep(check.id)" type="button" class="civic-link" @click="shell.open(nextStep(check.id)?.open ?? '')">{{ nextStep(check.id)?.label }}</button></div>
          </li>
        </ul>
      </template>

      <SectionTitle>Run for office</SectionTitle>
      <section class="ui-card">
        <p v-if="!you" class="civic-note">Connect to see whether you can run.</p>
        <p v-else-if="you.isCandidate" class="civic-note"><GameIcon inline name="check" /> You are on this week’s ballot. Voting runs Thursday to Saturday, Lagos time.</p>
        <template v-else>
          <p class="civic-note">What you need to run, and where you stand:</p>
          <ul class="civic-checks">
            <li v-for="check in you.run.checks" :key="check.id" :class="check.met ? 'is-met' : 'is-unmet'">
              <i role="img" :aria-label="check.met ? 'Met' : 'Not met'"><GameIcon inline :name="check.met ? 'check' : 'close'" /></i>
              <div><strong>{{ check.label }}</strong><small>{{ check.detail }}</small><button v-if="!check.met && nextStep(check.id)" type="button" class="civic-link" @click="shell.open(nextStep(check.id)?.open ?? '')">{{ nextStep(check.id)?.label }}</button></div>
            </li>
          </ul>
          <div class="civic-form"><label>Your slogan ({{ ELECTION.sloganMin }}–{{ ELECTION.sloganMax }} characters, no links)<input ref="runField" v-model="draft.slogan" :maxlength="ELECTION.sloganMax" autocomplete="off"></label></div>
          <CivicAction :primary="data.phase === 'nominations'" :working="civic.busy('run')" :reason="runWhy(offline('run'), you)" @click="run">Run for {{ role }} · {{ money(data.rules.filingFee) }}</CivicAction>
          <p class="civic-note">The {{ money(data.rules.filingFee) }} filing fee is not refunded.</p>
        </template>
      </section>

      <template v-if="you?.isGovernor">
        <SectionTitle>{{ role }}’s desk</SectionTitle>
        <div class="civic-form is-card"><label>Announcement to the city (up to {{ ELECTION.announcement.max }} characters, no links)<textarea ref="textField" v-model="draft.announcement" :maxlength="ELECTION.announcement.max" rows="3" /></label></div>
        <CivicAction primary :working="civic.busy('announce')" :reason="announceWhy(offline('post'), you)" @click="announce">Post announcement</CivicAction>
        <p class="civic-note">Up to {{ data.rules.announcementsPerDay }} a day, at least an hour apart. Everyone sees it in Updates.</p>
      </template>

      <GovernorNews :data="data" :notices="notices" />
      <div class="civic-actions"><CivicAction :working="item.loading" @click="reload">Refresh</CivicAction></div>
    </template>
  </div>
</template>

<style scoped>
.civic-note { font-size: 12px !important; line-height: 1.45 !important; color: var(--c-muted); margin: var(--s-2) 2px !important; }
.civic-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0 0; }
.civic-actions .civic-action { flex: 1 1 140px; display: grid; margin: 0; }
.civic-form { display: grid; gap: var(--s-3); margin: var(--s-2) 0; }
.civic-form.is-card { padding: var(--s-3) var(--s-4) var(--s-4); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.civic-form label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; margin: 0 !important; }
.civic-checks { list-style: none; padding: 0; margin: var(--s-1) 0 var(--s-2); display: grid; gap: 6px; }
.civic-checks li { display: flex; align-items: flex-start; gap: 10px; padding: 9px 12px; border-radius: var(--r-sm); background: var(--c-fill); }
.civic-checks li > i { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 12px; font-weight: 700; color: #fff; background: var(--c-green-dark); }
.civic-checks .is-unmet > i { background: var(--c-red); }
.civic-checks li > div { min-width: 0; display: grid; gap: 2px; justify-items: start; }
.civic-checks strong { font-size: 13px; font-weight: 600; }
.civic-checks small { font-size: 12px; color: var(--c-muted); overflow-wrap: anywhere; }
.civic-link { border: 0; background: none; padding: 0; min-height: var(--tap); font: 600 12px var(--font); color: var(--c-green-dark); text-decoration: underline; cursor: pointer; }
.civic-refusal { border-radius: var(--r-sm); background: var(--c-red-soft); box-shadow: inset 0 0 0 1.5px #e3a995; padding: 10px 12px; margin: var(--s-2) 0; display: grid; gap: 2px; }
.civic-refusal strong { font-size: 13px; color: var(--c-red-dark); }
.civic-refusal p { margin: 0 !important; font-size: 12px !important; line-height: 1.45 !important; overflow-wrap: anywhere; }
:global(.ph.is-wide) .civic-checks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
:global(.ph.is-wide) .civic-form input { max-width: 460px; }
.governor-ballot { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); margin-bottom: var(--s-2); }
.governor-ballot .governor-candidate { margin: 0; align-content: start; }
:global(.ph.is-wide) .governor-ballot { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.governor-cycle { margin-bottom: var(--s-2); padding: 12px 14px 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.governor-cycle ol { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; list-style: none; margin: 0 0 10px; padding: 0; }
.governor-cycle li { display: grid; gap: 1px; padding: 7px 8px; border-radius: var(--r-xs); background: var(--c-fill); text-align: center; color: var(--c-muted); }
.governor-cycle li b { font-size: 12px; }
.governor-cycle li small { font-size: 11px; }
.governor-cycle li.is-now { background: var(--app-tint, var(--c-green-dark)); color: #fff; }
.governor-cycle p { display: grid; gap: 1px; margin: 0 !important; font-size: 13px !important; }
.governor-cycle p strong { font-size: 16px; }
.governor-cycle p span { color: var(--c-muted); font-size: 12px; }
.governor-cycle p span b { color: var(--c-ink); }
.governor-bar { height: 6px; border-radius: 6px; background: var(--c-fill-2); overflow: hidden; margin-top: 4px; }
.governor-bar i { display: block; height: 100%; border-radius: 6px; background: var(--app-tint, var(--c-green)); }
.governor-candidate { display: grid; gap: 6px; margin-bottom: var(--s-2); padding: 12px 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.governor-candidate.is-chosen { box-shadow: var(--e-1), inset 0 0 0 2px var(--c-green); }
.governor-who { display: flex; align-items: center; gap: 10px; }
.governor-who strong { flex: 1; min-width: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.governor-who span:last-child { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--c-ink-2); }
.governor-who .ui-avatar { width: 34px; height: 34px; font-size: 14px; }
.governor-candidate q { font-size: 13px; color: var(--c-ink-2); overflow-wrap: anywhere; }
.governor-candidate .civic-action { margin: 2px 0 0; }
</style>
