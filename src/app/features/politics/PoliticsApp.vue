<script setup lang="ts">
// Politics: who holds each seat, the weekly election for it, the rules the officeholder has set, the treasury and the parties.
//
// One screen for the three seats (city, state, nation) and the parties. The ballot of a seat is GET /api/civic/gov?tier=; the rest
// (rules, treasury, parties) is GET /api/politics/overview. Every control that is off says why. Filing a candidacy, drawing the
// salary and founding a party keep their request id until applied, so pressing again after a lost answer is the SAME request.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { GovResponse } from '../../../types/civic.ts'
import type { BillView, CaseView, JusticeResponse, LeverView, PoliticsResponse, TierId, Verdict } from '../../../types/politics.ts'
import { money } from '../../ui/format.ts'
import EmptyState from '../../ui/EmptyState.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import CivicAction from '../civic/CivicAction.vue'
import CivicAvatar from '../civic/CivicAvatar.vue'
import CivicStale from '../civic/CivicStale.vue'
import CivicStatus from '../civic/CivicStatus.vue'
import { colourOf, sloganTooShort, until, votes, PHASES, NEXT, voteWhy, runWhy, barWidth } from '../civic/civicModel.ts'
import { AD_COLOURS, ELECTION } from '../civic/civicContent.ts'
import { useCivic, useLoaded, useOffline } from '../civic/useCivic.ts'
import { appealRequest, arrestRequest, bailRequest, escalateRequest, partyRequest, politicsUi as ui, runRequest, salaryRequest } from './politicsDrafts.ts'
import type { RecordEntryView, RecordKind, RecordsResponse } from '../../../types/records.ts'
import { RECORD_FILTERS, checkRecords, kindLabel, recordDate, recordsPath, shortHash } from './politicsModel.ts'
import { BILL_STATUS, FLAG_TEXT, TABS, assemblyName, billLine, billVoteWhy, proposeWhy, tallyLine, VERDICTS, arrestWhy, auditLine, petitionWhy, canEscalate, caseLine, courtName, higherCourt, noteWhy, rulingLine, statementWhy, ballotKey, jailLine, justiceKey, justicePath, offenceLine, officerOf, ballotPath, ledgerKind, leverRange, leverText, leverWhy, officeLine, overviewKey, overviewPath, partyMottoWhy, partyName, partyNameWhy, quorumLine, seatOf } from './politicsModel.ts'

const props = defineProps<{ params?: unknown }>()
const { game } = useApp()
const civic = useCivic()
const offline = useOffline()
const view = game.view
const cityId = computed(() => view.value.cityId)
const overview = useLoaded<PoliticsResponse>({ key: () => overviewKey(cityId.value), path: () => overviewPath(cityId.value), maxAge: 20000 })
const tier = computed<TierId | null>(() => (ui.tab === 'parties' || ui.tab === 'justice' || ui.tab === 'records' ? null : ui.tab))
const justice = useLoaded<JusticeResponse>({ key: () => justiceKey(cityId.value), path: () => justicePath(cityId.value), maxAge: 15000, when: () => ui.tab === 'justice' })
const law = computed(() => justice.item.value.data)
const ballot = useLoaded<GovResponse>({ key: () => ballotKey(cityId.value, tier.value ?? 'city'), path: () => ballotPath(cityId.value, tier.value ?? 'city'), maxAge: 20000, when: () => tier.value !== null })

const data = computed(() => overview.item.value.data)
const gov = computed(() => (tier.value ? ballot.item.value.data : null))
const seat = computed(() => (tier.value ? seatOf(data.value, tier.value) : null))
const you = computed(() => gov.value?.you ?? null)
const top = computed(() => Math.max(1, ...(gov.value?.election.candidates.map((candidate) => candidate.votes) ?? [])))
const myParty = computed(() => partyName(data.value, data.value?.you?.party))
const officeParty = computed(() => partyName(data.value, seat.value?.officeholderParty)?.name ?? null)
watch(seat, (current) => {
  // The boxes start at what is in force now, once per seat and visit; what the player typed is kept.
  for (const lever of current?.levers ?? []) if (ui.levers[lever.id] === undefined) ui.levers[lever.id] = lever.value
}, { immediate: true })

/** What a write handed back: the fresh overview and ballot replace the cached ones. */
function done(result: Record<string, unknown>, at: TierId | null = tier.value): void {
  if (result.politics) civic.put(overviewKey(cityId.value), result.politics as PoliticsResponse)
  if (result.gov && at) civic.put(ballotKey(cityId.value, at), result.gov as GovResponse)
  civic.changed()
}
async function run(): Promise<void> {
  const at = tier.value
  if (!at) return
  if (sloganTooShort(ui.slogan)) { game.toast(`Write a slogan first (${ELECTION.sloganMin}–${ELECTION.sloganMax} characters). Nothing was charged.`, 'error'); return }
  const result = await civic.send('p-run', '/api/civic/gov/run', { tier: at, slogan: ui.slogan, requestId: civic.requestId(runRequest, [cityId.value, at, ui.slogan]) }, { success: 'You are on the ballot.' })
  civic.requestDone(runRequest, result)
  if (result.ok) { ui.slogan = ''; overview.reload() }
  done(result, at)
}
async function vote(candidate: string): Promise<void> {
  const at = tier.value
  if (!at) return
  done(await civic.send(`p-vote:${candidate}`, '/api/civic/gov/vote', { tier: at, candidate }, { success: 'Your vote was counted.' }), at)
}
async function decree(lever: LeverView): Promise<void> {
  const at = tier.value, value = ui.levers[lever.id]
  if (!at) return
  const result = await civic.send(`p-decree:${lever.id}`, '/api/politics/decree', { tier: at, lever: lever.id, value }, { success: `${lever.label} is now ${leverText(lever, value ?? lever.base)}.` })
  done(result)
}
async function proposeBill(lever: LeverView): Promise<void> {
  const at = tier.value, value = ui.levers[lever.id]
  if (!at) return
  done(await civic.send(`p-bill:${lever.id}`, '/api/politics/bill', { tier: at, lever: lever.id, value }, { success: `A bill to set ${lever.label} is before the assembly.` }))
}
async function voteBill(bill: BillView, yes: boolean): Promise<void> {
  const at = tier.value
  if (!at) return
  const result = await civic.send(`p-billvote:${bill.id}`, '/api/politics/bill/vote', { tier: at, bill: bill.id, yes }, { success: yes ? 'You voted for the bill.' : 'You voted against the bill.' })
  if (result.ok && result.code === 'passed') game.toast('The bill passed: it is law for the week.', 'good')
  done(result)
}
async function signBill(bill: BillView, signIt: boolean): Promise<void> {
  const at = tier.value
  if (!at) return
  done(await civic.send(`p-billsign:${bill.id}`, '/api/politics/bill/sign', { tier: at, bill: bill.id, sign: signIt }, { success: signIt ? 'You signed the bill.' : 'You vetoed the bill.' }))
}
async function drawSalary(): Promise<void> {
  const at = tier.value
  if (!at) return
  const result = await civic.send('p-salary', '/api/politics/salary', { tier: at, requestId: civic.requestId(salaryRequest, [cityId.value, at]) }, { success: 'Your salary was paid.' })
  civic.requestDone(salaryRequest, result)
  done(result)
}
async function found(): Promise<void> {
  const result = await civic.send('p-found', '/api/politics/party/found', { ...ui.party, requestId: civic.requestId(partyRequest, [cityId.value, ui.party.name]) }, { success: 'Your party is founded.' })
  civic.requestDone(partyRequest, result)
  if (result.ok) { ui.party.name = ''; ui.party.motto = '' }
  done(result)
}
async function joinParty(id: string): Promise<void> { done(await civic.send(`p-join:${id}`, '/api/politics/party/join', { party: id }, { success: 'You joined the party.' })) }
async function leaveParty(): Promise<void> { done(await civic.send('p-leave', '/api/politics/party/leave', {}, { success: 'You left your party.' })) }
const bgOf = (id: string): string => colourOf(AD_COLOURS, id).bg
// A link such as /records opens the app on its tab.
watch(() => props.params, (given) => { const tab = typeof given === 'object' && given !== null ? Reflect.get(given, 'tab') : undefined; if (TABS.some((item) => item.id === tab)) ui.tab = tab as typeof ui.tab }, { immediate: true })

// The public record: read without signing in, a page at a time, and checked here against its seals.
const filter = ref<RecordKind | 'all'>('all')
const hall = ref<{ entries: RecordEntryView[]; before: number | null; head: string; count: number; loading: boolean; error: string | null }>({ entries: [], before: null, head: '', count: 0, loading: false, error: null })
let recordsRevision = 0
onBeforeUnmount(() => { recordsRevision += 1 })
async function loadRecords(more = false): Promise<void> {
  if (more && (hall.value.loading || hall.value.before === null)) return
  const revision = ++recordsRevision
  const path = recordsPath(filter.value, more ? hall.value.before : null)
  hall.value = more ? { ...hall.value, loading: true, error: null } : { entries: [], before: null, head: '', count: 0, loading: true, error: null }
  try {
    const answer = await game.fetchJson<RecordsResponse>(path)
    if (revision !== recordsRevision) return
    hall.value = { entries: more ? [...hall.value.entries, ...answer.entries] : answer.entries, before: answer.before, head: answer.head, count: answer.count, loading: false, error: null }
  } catch {
    if (revision !== recordsRevision) return
    hall.value.loading = false; hall.value.error = 'The record could not be loaded. Try again.'
  }
}
const hallCheck = computed(() => checkRecords(hall.value.entries, filter.value === 'all'))
watch([() => ui.tab, filter], ([tab]) => {
  recordsRevision += 1; hall.value.loading = false
  if (tab === 'records') void loadRecords()
}, { immediate: true })

function doneLaw(result: Record<string, unknown>): void {
  if (result.justice) civic.put(justiceKey(cityId.value), result.justice as JusticeResponse)
  civic.changed()
}
async function arrest(id: string): Promise<void> {
  const result = await civic.send(`p-arrest:${id}`, '/api/politics/justice/arrest', { offence: id, requestId: civic.requestId(arrestRequest, [cityId.value, id]) }, { success: 'The arrest is made.' })
  civic.requestDone(arrestRequest, result)
  doneLaw(result)
}
async function appeal(): Promise<void> {
  const result = await civic.send('p-appeal', '/api/politics/justice/appeal', { statement: ui.court.statement, ...(ui.court.counsel ? { counsel: ui.court.counsel } : {}), requestId: civic.requestId(appealRequest, [cityId.value, ui.court.statement, ui.court.counsel]) }, { success: 'Your appeal is filed.' })
  civic.requestDone(appealRequest, result)
  if (result.ok) ui.court.statement = ''
  doneLaw(result)
}
async function escalate(): Promise<void> {
  const result = await civic.send('p-escalate', '/api/politics/justice/escalate', { requestId: civic.requestId(escalateRequest, [cityId.value]) }, { success: 'Your case is before the higher court.' })
  civic.requestDone(escalateRequest, result)
  doneLaw(result)
}
async function postBail(): Promise<void> {
  const result = await civic.send('p-bail', '/api/politics/justice/bail', { requestId: civic.requestId(bailRequest, [cityId.value]) }, { success: 'Bail paid. You are free.' })
  civic.requestDone(bailRequest, result)
  doneLaw(result)
}
async function practise(on: boolean): Promise<void> { doneLaw(await civic.send('p-bar', '/api/politics/justice/lawyer', { on }, { success: on ? 'You are listed as a lawyer.' : 'You have stopped practising.' })) }
async function argue(offence: string): Promise<void> {
  const result = await civic.send(`p-argue:${offence}`, '/api/politics/justice/argue', { offence, argument: ui.court.argument }, { success: 'Your argument is filed.' })
  if (result.ok) ui.court.argument = ''
  doneLaw(result)
}
async function rule(found: CaseView, verdict: Verdict): Promise<void> {
  const result = await civic.send(`p-rule:${found.id}`, '/api/politics/justice/rule', { offence: found.id, verdict, note: ui.court.note }, { success: 'Your ruling is made.' })
  if (result.ok) ui.court.note = ''
  doneLaw(result)
}
async function audit(): Promise<void> { done(await civic.send('p-audit', '/api/politics/audit', { tier: tier.value }, { success: 'The audit is in.' })) }
async function impeach(): Promise<void> {
  const result = await civic.send('p-impeach', '/api/politics/impeach', { tier: tier.value }, { success: 'You signed the petition.' })
  if (result.ok && result.code === 'removed') game.toast('The petition succeeded: the officeholder is removed.', 'good')
  done(result)
  const at = tier.value
  if (at) civic.load(ballotKey(cityId.value, at), ballotPath(cityId.value, at), { force: true })
}
async function dismissOfficer(tierId: string, player: string): Promise<void> { doneLaw(await civic.send(`p-dismiss:${player}`, '/api/politics/justice/dismiss', { tier: tierId, player }, { success: 'The officer is dismissed.' })) }
const dateOf = (at: number): string => new Date(at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
</script>

<template>
  <div class="politics">
    <nav class="politics-tabs" role="tablist" aria-label="Politics">
      <button v-for="tab in TABS" :key="tab.id" type="button" role="tab" :aria-selected="ui.tab === tab.id" :class="{ 'is-on': ui.tab === tab.id }" @click="ui.tab = tab.id">{{ tab.label }}</button>
    </nav>
    <p v-if="data" class="politics-week"><strong>{{ PHASES[data.cycle.phase] }}</strong> · {{ NEXT[data.cycle.phase] }} in <b>{{ until(data.cycle.endsAt, view.now) }}</b>. City, state and national seats all follow this week.</p>
    <CivicStatus :item="overview.item.value" @retry="overview.reload" />

    <template v-if="data && seat && tier">
      <section class="ui-card politics-seat">
        <strong>{{ seat.title }} of {{ seat.name }}</strong>
        <p v-if="gov">{{ officeLine(seat, gov, officeParty) }}</p>
        <p class="politics-treasury">Treasury <b>{{ money(seat.treasury.balance) }}</b></p>
      </section>
      <CivicStale :item="overview.item.value" />
      <CivicStatus :item="ballot.item.value" @retry="ballot.reload" />

      <template v-if="gov">
        <section class="politics-cycle" aria-label="This week’s election">
          <strong>{{ PHASES[gov.phase] }}</strong>
          <span>{{ NEXT[gov.phase] }} in <b>{{ until(gov.phaseEndsAt, view.now) }}</b></span>
        </section>
        <p class="politics-note">{{ quorumLine(seat) }}</p>

        <SectionTitle>{{ gov.phase === 'results' ? 'This week’s result' : 'Candidates' }}</SectionTitle>
        <EmptyState v-if="!gov.election.candidates.length" icon="ballot" title="Nobody has stood" :text="gov.phase === 'nominations' ? 'Be the first: see “Run for office” below.' : 'Nominations open again on Monday, Nigerian time.'" />
        <div v-else class="politics-ballot">
          <div v-for="candidate in gov.election.candidates" :key="candidate.id" class="politics-candidate" :class="{ 'is-chosen': gov.election.yourVote === candidate.id }">
            <div class="politics-who">
              <CivicAvatar :name="candidate.name" :seed="candidate.id" />
              <strong>{{ candidate.name }}{{ candidate.you ? ' (you)' : '' }}</strong>
              <span v-if="gov.phase !== 'nominations'">{{ votes(candidate.votes) }}</span>
            </div>
            <span v-if="partyName(data, seat.parties[candidate.id])" class="politics-party"><i :style="{ background: bgOf(seat.parties[candidate.id] ? partyName(data, seat.parties[candidate.id])?.colour ?? '' : '') }" />{{ partyName(data, seat.parties[candidate.id])?.name }}</span>
            <span v-else class="politics-party is-independent">Independent</span>
            <q>{{ candidate.slogan }}</q>
            <div v-if="gov.phase !== 'nominations'" class="politics-bar" aria-hidden="true"><i :style="{ width: `${barWidth(candidate.votes, top)}%` }" /></div>
            <span v-if="gov.election.yourVote === candidate.id" class="ui-chip is-good">Your vote</span>
            <CivicAction v-else-if="!gov.election.yourVote && gov.phase !== 'results'" :primary="gov.phase === 'voting'" :working="civic.busy(`p-vote:${candidate.id}`)" :reason="voteWhy(offline('vote'), you)" @click="vote(candidate.id)">Vote for {{ candidate.name }}</CivicAction>
          </div>
        </div>
        <p v-if="gov.phase === 'voting'" class="politics-note">{{ votes(gov.election.totalVotes) }} cast so far. One vote per player; it cannot be changed.</p>

        <SectionTitle>Run for office</SectionTitle>
        <section class="ui-card">
          <p v-if="!you" class="politics-note">Connect to see whether you can run.</p>
          <p v-else-if="you.isCandidate" class="politics-note">You are on this week’s ballot.</p>
          <template v-else>
            <label class="politics-field">Your slogan ({{ ELECTION.sloganMin }}–{{ ELECTION.sloganMax }} characters, no links)<input v-model="ui.slogan" :maxlength="ELECTION.sloganMax" autocomplete="off"></label>
            <p class="politics-note">You will stand {{ myParty ? `for the ${myParty.name}` : 'as an independent' }}. Found or join a party under Parties.</p>
            <CivicAction :primary="gov.phase === 'nominations'" :working="civic.busy('p-run')" :reason="runWhy(offline('run'), you)" @click="run">Run for {{ seat.title }} · {{ money(seat.fee) }}</CivicAction>
            <p class="politics-note">The {{ money(seat.fee) }} filing fee is not refunded. It goes into the treasury.</p>
          </template>
        </section>
      </template>

      <SectionTitle>Rules in force</SectionTitle>
      <section class="ui-card politics-levers">
        <p v-if="seat.decree" class="politics-note">Decreed by {{ seat.decree.by.name }} on {{ dateOf(seat.decree.at) }}. They lapse when the term ends.</p>
        <p v-else class="politics-note">No decree this term: every rule is at its usual value.</p>
        <div v-for="lever in seat.levers" :key="lever.id" class="politics-lever">
          <div><strong>{{ lever.label }}</strong><small>{{ lever.about }}</small></div>
          <b class="politics-value">{{ leverText(lever, lever.value) }}</b>
          <template v-if="seat.assembly.members.length && seat.assembly.you?.canPropose">
            <label class="politics-set"><span>{{ leverRange(lever) }}</span><input v-model.number="ui.levers[lever.id]" type="number" :min="lever.min" :max="lever.max" step="1" inputmode="numeric"></label>
            <CivicAction primary :working="civic.busy(`p-bill:${lever.id}`)" :reason="proposeWhy(offline('propose'), lever, ui.levers[lever.id], seat.assembly)" @click="proposeBill(lever)">Propose a bill</CivicAction>
          </template>
          <template v-else-if="seat.you?.isOfficeholder && !seat.assembly.members.length">
            <label class="politics-set"><span>{{ leverRange(lever) }}</span><input v-model.number="ui.levers[lever.id]" type="number" :min="lever.min" :max="lever.max" step="1" inputmode="numeric"></label>
            <CivicAction primary :working="civic.busy(`p-decree:${lever.id}`)" :reason="offline('decree') ?? leverWhy(lever, ui.levers[lever.id])" @click="decree(lever)">Set</CivicAction>
          </template>
        </div>
      </section>

      <SectionTitle>{{ assemblyName(seat.tier, seat.name) }}</SectionTitle>
      <section class="ui-card politics-case">
        <p v-if="!seat.assembly.members.length" class="politics-note">No assembly sits this term, so the {{ seat.title }} sets the rules directly. The runners-up of a weekly election who got at least one vote join it, up to {{ seat.assembly.seats }}.</p>
        <template v-else>
          <p class="politics-note">Members ({{ seat.assembly.members.length }} of {{ seat.assembly.seats }}): <b>{{ seat.assembly.members.map((member) => member.name).join(', ') }}</b>. A rule changes only by a bill. The {{ seat.title }}’s bill needs a majority of the assembly; a member’s needs two thirds, or a majority and the {{ seat.title }}’s signature. The {{ seat.title }} can veto a member’s bill.</p>
          <p v-if="!seat.assembly.bills.length" class="politics-note">No bills this term. Propose one from “Rules in force” above.</p>
          <div v-for="bill in seat.assembly.bills" :key="bill.id" class="politics-docket">
            <strong>{{ billLine(bill) }}</strong>
            <small>Proposed by {{ bill.by.name }}{{ bill.byOffice ? ` (${seat.title})` : '' }} · {{ BILL_STATUS[bill.status] }}</small>
            <small>{{ tallyLine(bill) }}</small>
            <template v-if="bill.status === 'open'">
              <span v-if="seat.assembly.you?.member" class="politics-verdicts">
                <CivicAction primary :working="civic.busy(`p-billvote:${bill.id}`)" :reason="billVoteWhy(offline('vote'), bill, seat.assembly)" @click="voteBill(bill, true)">Vote for</CivicAction>
                <CivicAction :working="civic.busy(`p-billvote:${bill.id}`)" :reason="billVoteWhy(offline('vote'), bill, seat.assembly)" @click="voteBill(bill, false)">Vote against</CivicAction>
              </span>
              <span v-if="seat.you?.isOfficeholder && !bill.byOffice && !bill.signed" class="politics-verdicts">
                <CivicAction primary :working="civic.busy(`p-billsign:${bill.id}`)" :reason="offline('sign') ?? ''" @click="signBill(bill, true)">Sign it</CivicAction>
                <CivicAction :working="civic.busy(`p-billsign:${bill.id}`)" :reason="offline('veto') ?? ''" @click="signBill(bill, false)">Veto it</CivicAction>
              </span>
            </template>
          </div>
        </template>
      </section>

      <SectionTitle>Treasury</SectionTitle>
      <section class="ui-card">
        <p class="politics-note">Levies and filing fees pay into it. The {{ seat.title }} may draw a salary of up to a fifth of it, once a term.</p>
        <CivicAction v-if="seat.you?.isOfficeholder" primary :working="civic.busy('p-salary')" :reason="offline('draw') ?? (seat.you.salary > 0 ? '' : 'Nothing to draw this term.')" @click="drawSalary">Draw salary · {{ money(seat.you.salary) }}</CivicAction>
        <ul v-if="seat.treasury.ledger.length" class="politics-ledger">
          <li v-for="(line, index) in seat.treasury.ledger" :key="index"><span>{{ ledgerKind(line.kind) }}<small>{{ line.note }}</small></span><b :class="{ 'is-out': line.amount < 0 }">{{ line.amount < 0 ? '−' : '+' }}{{ money(Math.abs(line.amount)) }}</b></li>
        </ul>
        <p v-else class="politics-note">Nothing has been paid in yet.</p>
      </section>

      <SectionTitle>Accountability</SectionTitle>
      <section class="ui-card politics-case">
        <p class="politics-note">This term: <b>{{ money(seat.accounts.income) }}</b> came in, <b>{{ money(seat.accounts.salary) }}</b> was drawn as salary and <b>{{ money(seat.accounts.granted) }}</b> was granted.</p>
        <ul v-if="seat.grants.length" class="politics-ledger">
          <li v-for="(grant, index) in seat.grants" :key="index"><span>{{ grant.to.name }}<small>{{ grant.purpose }}</small></span><b class="is-out">{{ money(grant.amount) }}</b></li>
        </ul>
        <p v-else class="politics-note">No grants this term.</p>
        <CivicAction :working="civic.busy('p-audit')" :reason="offline('audit') ?? (gov?.governor ? '' : 'Nobody holds this seat.')" @click="audit">Ask for an audit</CivicAction>
        <div v-if="seat.audit" class="politics-audit">
          <p class="politics-note">{{ auditLine(seat.audit) }}</p>
          <ul v-if="seat.audit.flags.length" class="politics-flags"><li v-for="flag in seat.audit.flags" :key="flag">{{ FLAG_TEXT[flag] }}</li></ul>
          <p v-else class="politics-note">Nothing unusual was found.</p>
        </div>
        <template v-if="seat.petition">
          <p class="politics-note">Petition to remove the {{ seat.title }}: <b>{{ seat.petition.signed }} of {{ seat.petition.needed }}</b> signatures. It takes more than half of the votes they won.</p>
          <CivicAction :working="civic.busy('p-impeach')" :reason="petitionWhy(offline('sign'), seat.petition, !!seat.you)" @click="impeach">Sign to remove the {{ seat.title }}</CivicAction>
        </template>
      </section>
    </template>

    <template v-else-if="data && ui.tab === 'parties'">
      <SectionTitle>Parties</SectionTitle>
      <EmptyState v-if="!data.parties.length" icon="ballot" title="No party yet" text="Found the first one below, then others can join it." />
      <section v-for="party in data.parties" :key="party.id" class="ui-card politics-partycard">
        <div class="politics-who"><span class="politics-dot" :style="{ background: bgOf(party.colour) }" /><strong>{{ party.name }}</strong><span>{{ party.members }} member{{ party.members === 1 ? '' : 's' }}</span></div>
        <q>{{ party.motto }}</q>
        <small>Founded by {{ party.founder.name }}</small>
        <span v-if="party.mine" class="ui-chip is-good">Your party</span>
        <CivicAction v-else :working="civic.busy(`p-join:${party.id}`)" :reason="offline('join') ?? ''" @click="joinParty(party.id)">{{ data.you?.party ? 'Switch to this party' : 'Join' }}</CivicAction>
      </section>
      <CivicAction v-if="data.you?.party" :working="civic.busy('p-leave')" :reason="offline('leave') ?? ''" @click="leaveParty">Leave my party</CivicAction>

      <SectionTitle>Found a party</SectionTitle>
      <section class="ui-card">
        <p v-if="!data.you" class="politics-note">Connect to found a party.</p>
        <p v-else-if="!data.you.canFound" class="politics-note">You have already founded a party.</p>
        <template v-else>
          <label class="politics-field">Name ({{ data.partyRules.nameMin }}–{{ data.partyRules.nameMax }} characters)<input v-model="ui.party.name" :maxlength="data.partyRules.nameMax" autocomplete="off"></label>
          <label class="politics-field">Motto ({{ data.partyRules.mottoMin }}–{{ data.partyRules.mottoMax }} characters, no links)<input v-model="ui.party.motto" :maxlength="data.partyRules.mottoMax" autocomplete="off"></label>
          <div class="politics-colours" role="radiogroup" aria-label="Party colour"><button v-for="colour in data.partyRules.colours" :key="colour" type="button" role="radio" :aria-checked="ui.party.colour === colour" :aria-label="colour" :class="{ 'is-on': ui.party.colour === colour }" :style="{ background: bgOf(colour) }" @click="ui.party.colour = colour" /></div>
          <CivicAction primary :working="civic.busy('p-found')" :reason="offline('found a party') ?? (partyNameWhy(ui.party.name) || partyMottoWhy(ui.party.motto))" @click="found">Found the party · {{ money(data.partyRules.fee) }}</CivicAction>
          <p class="politics-note">The fee is not refunded. You can found one party; anyone can stand under it.</p>
        </template>
      </section>
    </template>


    <template v-else-if="ui.tab === 'records'">
      <SectionTitle>Hall of Records</SectionTitle>
      <p class="politics-note">Every election, ruling, removal and new party is written here for good. Nothing is edited or removed, and each entry is sealed by the one before it, so a change anywhere would show.</p>
      <div class="politics-filters" role="group" aria-label="Filter the record"><button v-for="item in RECORD_FILTERS" :key="item.id" type="button" :class="{ 'is-on': filter === item.id }" :aria-pressed="filter === item.id" @click="filter = item.id">{{ item.label }}</button></div>
      <p v-if="hall.loading" class="politics-note" role="status">Loading records…</p>
      <div v-if="hall.error"><p class="politics-note is-warn" role="alert">{{ hall.error }}</p><CivicAction @click="loadRecords()">Try again</CivicAction></div>
      <EmptyState v-else-if="!hall.entries.length && !hall.loading" icon="ballot" title="Nothing recorded yet" text="The first finished election will be written here." />
      <section v-for="entry in hall.entries" :key="entry.n" class="ui-card politics-entry">
        <small>{{ recordDate(entry.at) }} · {{ kindLabel(entry.kind) }} · {{ entry.scopeName }}</small>
        <strong>{{ entry.title }}</strong>
      </section>
      <CivicAction v-if="hall.before !== null" :working="hall.loading" @click="loadRecords(true)">Older entries</CivicAction>
      <p v-if="hall.entries.length" class="politics-note" :class="{ 'is-warn': !hallCheck.ok }">{{ hallCheck.line }} {{ hall.count }} entries so far; the latest seal is <code>{{ shortHash(hall.head) }}</code>.</p>
    </template>
    <template v-else-if="ui.tab === 'justice'">
      <CivicStatus :item="justice.item.value" @retry="justice.reload" />
      <template v-if="law">
        <div v-if="law.you?.jail" class="politics-jail" role="alert"><strong>You are in jail</strong><p>{{ jailLine(law.you.jail, view.now) }}</p></div>
        <SectionTitle>Police</SectionTitle>
        <section v-for="seat in law.seats" :key="seat.scope" class="ui-card politics-force">
          <strong>{{ seat.title }} of {{ seat.name }}</strong>
          <p class="politics-note">Assault sentence in force: <b>{{ seat.sentence }} minutes</b>. {{ seat.officers.length }} of {{ seat.capacity }} officers{{ seat.officers.length ? ':' : '.' }}</p>
          <p class="politics-note">Bail: <b>{{ seat.bail > 0 ? money(seat.bail) : 'none' }}</b>. {{ seat.judges.length }} of {{ seat.judgeCapacity }} judges{{ seat.judges.length ? `: ${seat.judges.map((judge) => judge.name).join(', ')}` : '.' }}</p>
          <ul v-if="seat.officers.length" class="politics-officers">
            <li v-for="officer in seat.officers" :key="officer.id"><span>{{ officer.name }}</span><CivicAction v-if="seat.canEnrol" :working="civic.busy(`p-dismiss:${officer.id}`)" :reason="offline('dismiss') ?? ''" @click="dismissOfficer(seat.tier, officer.id)">Dismiss</CivicAction></li>
          </ul>
          <p v-if="seat.canEnrol" class="politics-note">You hold this seat. Open a player’s card to make them an officer or a judge. An officer serves until your term ends.</p>
        </section>
        <template v-if="law.you?.police">
          <SectionTitle>Open offences</SectionTitle>
          <EmptyState v-if="!law.offences.length" icon="ballot" title="Nothing to act on" text="Fights are on record for a day. An officer arrests someone standing in the same place." />
          <section v-for="offence in law.offences" :key="offence.id" class="ui-card politics-offence">
            <strong>{{ offenceLine(offence) }}</strong>
            <small>{{ dateOf(offence.at) }} · {{ offence.here ? 'here with you now' : 'not here' }}</small>
            <CivicAction primary :working="civic.busy(`p-arrest:${offence.id}`)" :reason="arrestWhy(offline('arrest'), offence)" @click="arrest(offence.id)">Arrest {{ offence.by.name }}</CivicAction>
          </section>
        </template>
        <template v-if="law.you?.wanted.length">
          <SectionTitle>You are wanted</SectionTitle>
          <p class="politics-note">Police may arrest you for these fights if they find you.</p>
          <section v-for="offence in law.you.wanted" :key="offence.id" class="ui-card politics-offence"><strong>{{ offenceLine(offence) }}</strong><small>{{ dateOf(offence.at) }}</small></section>
        </template>

        <SectionTitle>Courts</SectionTitle>
        <section v-if="law.you?.jail" class="ui-card politics-case">
          <strong>Your case</strong>
          <template v-if="law.court.case">
            <p class="politics-note">{{ caseLine(law.court.case) }}. Before the {{ courtName(law.court.case.tier) }}.</p>
            <q>{{ law.court.case.statement }}</q>
            <p v-if="law.court.case.counsel" class="politics-note">Your lawyer: {{ law.court.case.counsel.name }}{{ law.court.case.counsel.argument ? `: “${law.court.case.counsel.argument}”` : ' (has not argued yet)' }}</p>
            <p v-if="law.court.case.lower" class="politics-note">Lower court: {{ rulingLine({ ruling: law.court.case.lower }) }}</p>
            <p v-if="law.court.case.ruling" class="politics-note"><strong>{{ rulingLine(law.court.case) }}</strong></p>
            <p v-else class="politics-note">Waiting for a judge to rule.</p>
            <CivicAction v-if="canEscalate(law.court.case)" :working="civic.busy('p-escalate')" :reason="offline('appeal') ?? ''" @click="escalate">Take it to the {{ higherCourt(law.court.case.tier) }} · {{ money(law.court.fees.escalate) }}</CivicAction>
          </template>
          <template v-else>
            <label class="politics-field">Your statement (up to 140 characters, no links)<input v-model="ui.court.statement" maxlength="140" autocomplete="off"></label>
            <label v-if="law.court.lawyers.length" class="politics-field">A lawyer to argue for you (optional)<select v-model="ui.court.counsel"><option value="">None</option><option v-for="lawyer in law.court.lawyers" :key="lawyer.id" :value="lawyer.id">{{ lawyer.name }}</option></select></label>
            <CivicAction primary :working="civic.busy('p-appeal')" :reason="statementWhy(offline('appeal'), ui.court.statement)" @click="appeal">Appeal the arrest · {{ money(law.court.fees.appeal) }}</CivicAction>
          </template>
          <CivicAction v-if="law.court.bail > 0" :working="civic.busy('p-bail')" :reason="offline('post bail') ?? ''" @click="postBail">Pay bail · {{ money(law.court.bail) }}</CivicAction>
          <p v-else class="politics-note">No bail is set for this arrest.</p>
        </section>
        <section class="ui-card politics-case">
          <strong>Lawyers</strong>
          <p class="politics-note">A lawyer argues for a jailed player who names them. Agree a fee in chat; the game does not move it.</p>
          <CivicAction :working="civic.busy('p-bar')" :reason="offline('practise') ?? ''" @click="practise(!law.court.lawyer)">{{ law.court.lawyer ? 'Stop practising' : 'Practise as a lawyer' }}</CivicAction>
          <p v-if="law.court.lawyers.length" class="politics-note">Practising: {{ law.court.lawyers.map((lawyer) => lawyer.name).join(', ') }}</p>
          <div v-for="found in law.court.counselFor" :key="found.id" class="politics-docket">
            <strong>{{ found.defendant.name }}</strong><q>{{ found.statement }}</q>
            <template v-if="!found.counsel?.argument">
              <label class="politics-field">Your argument (up to 200 characters)<input v-model="ui.court.argument" maxlength="200" autocomplete="off"></label>
              <CivicAction primary :working="civic.busy(`p-argue:${found.id}`)" :reason="statementWhy(offline('argue'), ui.court.argument)" @click="argue(found.id)">Argue the case</CivicAction>
            </template>
            <p v-else class="politics-note">You argued: {{ found.counsel.argument }}</p>
          </div>
        </section>
        <section v-if="law.court.judge" class="ui-card politics-case">
          <strong>The bench · {{ courtName(law.court.judge.tier) }}</strong>
          <p v-if="!law.court.docket.length" class="politics-note">No case is waiting for you.</p>
          <div v-for="found in law.court.docket" :key="found.id" class="politics-docket">
            <strong>{{ caseLine(found) }}</strong>
            <q>{{ found.statement }}</q>
            <p v-if="found.counsel" class="politics-note">Counsel {{ found.counsel.name }}: {{ found.counsel.argument ?? 'has not argued yet' }}</p>
            <p v-if="found.lower" class="politics-note">Lower court: {{ rulingLine({ ruling: found.lower }) }}</p>
            <label class="politics-field">Your reasons (public)<input v-model="ui.court.note" maxlength="100" autocomplete="off"></label>
            <span class="politics-verdicts"><CivicAction v-for="verdict in VERDICTS" :key="verdict.id" :primary="verdict.id === 'quashed'" :working="civic.busy(`p-rule:${found.id}`)" :reason="noteWhy(offline('rule'), ui.court.note)" :title="verdict.about" @click="rule(found, verdict.id)">{{ verdict.label }}</CivicAction></span>
          </div>
        </section>
        <template v-if="law.court.rulings.length">
          <SectionTitle>Recent rulings</SectionTitle>
          <section v-for="found in law.court.rulings" :key="found.id" class="ui-card politics-offence"><strong>{{ found.defendant.name }}</strong><small>{{ courtName(found.tier) }} · {{ rulingLine(found) }}</small></section>
        </template>
        <SectionTitle>How it works</SectionTitle>
        <section class="ui-card">
          <p class="politics-note">Open another player’s card in the same place and press Fight. A newcomer (less than a day here) is left alone. The fitter player usually wins, both lose energy, and the fight goes on record for {{ law.rules.offenceHours }} hours. The officeholder of a seat enrols its police for their term and sets how long the sentence is. Jail never lasts more than four hours, and you can always message and call.</p>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.politics-week { margin: 0 0 var(--s-2); padding: 8px 12px; border-radius: var(--r-sm); background: var(--c-fill); font-size: 12px; line-height: 1.4; color: var(--c-ink-2); }
.politics-week b { color: var(--c-ink); }
.politics-tabs { display: flex; overflow-x: auto; gap: 4px; margin: 0 0 var(--s-3); padding: 4px; border-radius: var(--r-md); background: var(--c-fill); }
.politics-tabs button { flex: 1 0 auto; padding: 0 8px; min-height: var(--tap); border: 0; border-radius: var(--r-sm); background: transparent; font: 600 12px var(--font); color: var(--c-ink-2); cursor: pointer; }
.politics-tabs button.is-on { background: #fff; color: var(--c-ink); }
.politics-seat { display: grid; gap: 4px; }
.politics-seat strong { font-size: 16px; }
.politics-seat p { margin: 0 !important; font-size: 13px !important; color: var(--c-ink-2); }
.politics-treasury b { color: var(--c-ink); font-variant-numeric: tabular-nums; }
.politics-cycle { display: grid; gap: 1px; margin: var(--s-2) 0; padding: 10px 14px; border-radius: var(--r-md); background: #fff; border: 1px solid var(--c-line); min-width: 0; }
.politics-cycle strong { font-size: 15px; }
.politics-cycle span { font-size: 12px; color: var(--c-muted); }
.politics-cycle span b { color: var(--c-ink); }
.politics-note { font-size: 12px !important; line-height: 1.45 !important; color: var(--c-muted); margin: var(--s-2) 2px !important; }
.politics-ballot { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
:global(.ph.is-wide) .politics-ballot { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.politics-candidate, .politics-partycard { display: grid; gap: 6px; padding: 12px 14px; border-radius: var(--r-md); background: #fff; border: 1px solid var(--c-line); min-width: 0; align-content: start; }
.politics-partycard { margin-bottom: var(--s-2); }
.politics-candidate.is-chosen { box-shadow: inset 0 0 0 2px var(--c-green); }
.politics-who { display: flex; align-items: center; gap: 10px; }
.politics-who strong { flex: 1; min-width: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.politics-who > span:last-child { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--c-ink-2); }
.politics-who .ui-avatar { width: 34px; height: 34px; font-size: 14px; }
.politics-candidate q, .politics-partycard q { font-size: 13px; color: var(--c-ink-2); overflow-wrap: anywhere; }
.politics-party { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--c-ink-2); }
.politics-party i, .politics-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.politics-party.is-independent { color: var(--c-muted); font-weight: 500; }
.politics-bar { height: 6px; border-radius: 6px; background: var(--c-fill-2); overflow: hidden; }
.politics-bar i { display: block; height: 100%; border-radius: 6px; background: var(--app-tint, var(--c-green)); }
.politics-field { display: grid; gap: 6px; font-size: 13px; font-weight: 600; margin: 0 0 var(--s-2); }
.politics-levers { display: grid; gap: var(--s-3); }
.politics-lever { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; align-items: center; }
.politics-lever > div { display: grid; gap: 2px; }
.politics-lever small { font-size: 12px; color: var(--c-muted); }
.politics-value { font-size: 18px; font-variant-numeric: tabular-nums; }
.politics-set { grid-column: 1; display: grid; gap: 4px; font-size: 12px; color: var(--c-muted); }
.politics-lever :deep(.civic-action) { grid-column: 2; }
.politics-ledger { list-style: none; margin: var(--s-2) 0 0; padding: 0; display: grid; gap: 6px; }
.politics-ledger li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; font-size: 13px; }
.politics-ledger small { display: block; font-size: 11px; color: var(--c-muted); overflow-wrap: anywhere; }
.politics-ledger b { font-variant-numeric: tabular-nums; color: var(--c-green-dark); }
.politics-ledger b.is-out { color: var(--c-red-dark); }
.politics-jail { margin: var(--s-2) 0; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-red-soft); box-shadow: inset 0 0 0 1.5px #e3a995; }
.politics-jail strong { color: var(--c-red-dark); }
.politics-jail p { margin: 2px 0 0 !important; font-size: 13px !important; }
.politics-force, .politics-offence { display: grid; gap: 6px; margin-bottom: var(--s-2); }
.politics-offence small { color: var(--c-muted); font-size: 12px; }
.politics-case { display: grid; gap: 6px; margin-bottom: var(--s-2); }
.politics-case q { font-size: 13px; color: var(--c-ink-2); overflow-wrap: anywhere; }
.politics-docket { display: grid; gap: 6px; padding-top: var(--s-2); border-top: 1px solid var(--c-fill-2); }
.politics-verdicts { display: flex; flex-wrap: wrap; gap: 4px; }
.politics-field select { min-height: var(--tap); }
.politics-officers { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.politics-officers li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; font-size: 14px; }
.politics-filters { display: flex; flex-wrap: wrap; gap: 4px; margin: var(--s-2) 0; }
.politics-filters button { min-height: 44px; padding: 0 10px; border: 0; border-radius: 16px; background: var(--c-fill); font: 600 12px var(--font); color: var(--c-ink-2); cursor: pointer; }
.politics-filters button.is-on { background: var(--app-tint, var(--c-green-dark)); color: #fff; }
.politics-entry { display: grid; gap: 3px; margin-bottom: var(--s-2); }
.politics-entry small { color: var(--c-muted); font-size: 11px; }
.politics-entry strong { font-size: 13px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.politics-note code { font-size: 11px; }
.politics-note.is-warn { color: var(--c-red-dark); }
.politics-flags { margin: 0; padding-left: 18px; font-size: 13px; color: var(--c-red-dark); }
.politics-audit { display: grid; gap: 4px; }
.politics-colours { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 var(--s-2); }
.politics-colours button { width: 32px; height: 32px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.politics-colours button.is-on { border-color: var(--c-ink); }
</style>
