<script setup lang="ts">
// Tables: the Phone app for the game tables. Its first screen lists the tables where the Sim is and
// elsewhere in the city; opening one shows the table itself: who sits there, the rules the first
// player chose, the game while it is on (drawn by the game's own board) and the result.
//
// Everything shown comes from the server (src/tables/client.ts, through useTables()); every button
// sends a message and the answer, not the press, changes what is shown. A press that is on its way
// disables the buttons that would repeat it. Player names are text, never markup.
import LazyList from '../../ui/LazyList.vue'
import { chunkedView } from '../../ui/lazyList.ts'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { isDeparting } from '../../../life.ts'
import { linkWords } from '../../../ui/link.ts'
import BaseButton from '../../ui/BaseButton.vue'
import BaseChip from '../../ui/BaseChip.vue'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { useGrowth } from '../growth/useGrowth.ts'
import type { FriendOffer } from '../../../types/growth.ts'
import { markGameShown, markNotNow, tableCard } from '../social/friendOfferModel.ts'
import { offerMemory, saveOfferMemory } from '../social/friendOfferStore.ts'
import PenaltyBoard from './PenaltyBoard.vue'
import WhotBoard from './WhotBoard.vue'
// The board games' screens are chunks of their own, fetched when a table of that game is opened.
const ChessBoard = defineAsyncComponent(() => import('./ChessBoard.vue'))
const WeaveBoard = defineAsyncComponent(() => import('./WeaveBoard.vue'))
// After a game with people: the one friendship card (add as friend, a small gift, invite), a chunk of its own.
const FriendOfferCard = defineAsyncComponent(() => import('../social/FriendOfferCard.vue'))
const AyoBoard = defineAsyncComponent(() => import('./AyoBoard.vue'))
import { GAME_LABELS, ayoRules, chessRules, isAyoState, isChessState, isPenaltyState, isWeaveState, isWhotState, penaltyRules, tableById, weaveRules, whotRules } from './tablesBoundary.ts'
import {
  AGAIN_STAKE_NOTE, LIST_RULES, NO_TABLE_HERE, PLAY_MONEY, acceptNote, adultAnswer, botCounts, botLabel, heroFigure, heroNote, hostNote, leavesOnBack, openLabel, optionKey, outcomeNote, outcomeTitle,
  parseOption, partition, pickNote, ratingLine, rowStake, rowSub, seatLabel, showsStake, sitLabel, sitReason, stakeLine, startNote, tableParam, tableTitle,
} from './tablesModel.ts'
import { useTables } from './useTables.ts'
import { money } from '../../ui/format.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell, goTo } = useApp()
const tables = useTables()
const growth = useGrowth()
const view = game.view
const t = tables.t
const connected = computed(() => view.value.connected)
const offlineWhy = computed(() => linkWords(view.value)?.why ?? '')
/** Where the Sim is, or null while it travels. */
const at = computed(() => (isDeparting(game.state.value) ? null : game.state.value.location))
const lists = computed(() => partition(t.value.list ?? [], at.value))
// Tables in the rest of the city: drawn forty at a time as the reader goes down.
const elsewhere = chunkedView(() => lists.value.other)
const ratings = computed(() => Object.entries(t.value.ratings ?? {}).flatMap(([id, rating]) => (rating ? [{ id, label: GAME_LABELS[id] ?? id, rating }] : [])))
const paid = computed(() => view.value.growth?.tables ?? null)
const busyWhy = computed(() => (growth.state.busy ? 'A share is being prepared.' : null))

const s = computed(() => t.value.state)
const table = computed(() => s.value?.table ?? null)
const seated = computed(() => s.value !== null && s.value.you !== null)
/** A Phone table (src/tables phone-*) is not in a venue: you can sit at it anywhere. */
const onPhone = computed(() => table.value?.venue === 'phone')
const atVenue = computed(() => table.value !== null && (onPhone.value || table.value.venue === at.value))
const free = computed(() => (table.value ? table.value.max - table.value.seats.length : 0))
const rulesText = computed(() => (table.value?.game === 'whot' ? whotRules : table.value?.game === 'penalty' ? penaltyRules : table.value?.game === 'chess' ? chessRules : table.value?.game === 'weave' ? weaveRules : table.value?.game === 'ayo' ? ayoRules : []))
const whot = computed(() => (s.value && isWhotState(s.value) ? s.value : null))
const penalty = computed(() => (s.value && isPenaltyState(s.value) ? s.value : null))
const chess = computed(() => (s.value && isChessState(s.value) ? s.value : null))
const weave = computed(() => (s.value && isWeaveState(s.value) ? s.value : null))
const ayo = computed(() => (s.value && isAyoState(s.value) ? s.value : null))
const result = computed(() => (table.value?.status === 'over' ? s.value?.result ?? null : null))
const outcome = computed(() => (result.value ? { title: outcomeTitle(result.value), note: outcomeNote(result.value, t.value.claimed, paid.value?.win ?? 0) } : null))
// Friendship after shared play: the server sends, with the result, who this player may be offered (not friends, not blocked either way). The card
// is put up once for that game, and "Not now" keeps those people off the next card for a day (the rules are in friendOfferModel.ts).
const offerPeople = ref<FriendOffer[]>([])
watch(() => result.value?.mine?.offers, (offers) => {
  if (!offers) { offerPeople.value = []; return }
  const memory = offerMemory(), people = tableCard(memory, offers, Date.now())
  if (!people.length) return
  markGameShown(memory, offers.match); saveOfferMemory(); offerPeople.value = people
}, { immediate: true })
function closeOffer(unasked: string[]): void { markNotNow(offerMemory(), unasked, Date.now()); saveOfferMemory(); offerPeople.value = [] }
// Stakes: game naira only. The server says what this player may do about the table's stake; nothing here decides it.
const stakes = computed(() => s.value?.stakes ?? null)
const staked = computed(() => (table.value?.stake ?? 0) > 0)
const stakeCard = computed(() => showsStake(stakes.value, table.value?.stake ?? 0))
const sitWhy = computed(() => sitReason(free.value, t.value.pending, stakes.value))
/** Every stake refused for one reason (18+, work first): said on screen, since a disabled button's reason is only a tooltip. */
const choicesWhy = computed(() => { const list = stakes.value?.choices ?? [], first = list[0]; return first?.why && list.every((choice) => choice.code === first.code) ? first : null })
const answering = ref(false)
/** The second player sat down for these rules and this stake: neither moves afterwards (the server refuses it too). */
const rulesLocked = computed(() => staked.value && (table.value?.seats.length ?? 0) > 1)

// Opened on a table (a link, the venue chip): go straight to it, once per params object.
let handled: unknown = null
function openFromParams(params: unknown): void {
  const id = tableParam(params)
  if (!id || params === handled) return
  handled = params
  if (id.startsWith('phone-') || tableById(view.value.cityId, id)) tables.openTable(id)
}
// "Play the computer" on a Phone table: sit down, and start with the bots as soon as the seat is confirmed.
const wantBots = ref(0)
function playBots(count: number): void { if (seated.value) tables.begin(count); else { wantBots.value = count; tables.sit() } }
watch(seated, (now) => { if (now && wantBots.value > 0 && table.value?.status === 'open') { const count = wantBots.value; wantBots.value = 0; tables.begin(count) } })
onMounted(() => openFromParams(props.params))
watch(() => props.params, openFromParams)

function back(): void {
  wantBots.value = 0
  if (leavesOnBack(t.value.state)) tables.leave()
  tables.closeTable()
}
function forfeit(): void { if (window.confirm(staked.value ? 'Leave the game? You forfeit it, and the other player takes the pot.' : 'Leave the game? You forfeit it.')) tables.leave() }
/** "I am 18 or older": the same answer Stay in touch records (POST /api/growth/consent), then the table is asked about again. */
async function sayAdult(): Promise<void> {
  answering.value = true
  try { await game.fetchJson('/api/growth/consent', { method: 'POST', body: adultAnswer(view.value.cityId) }); tables.refreshTable() } catch (error) { game.toast(error instanceof Error ? error.message : 'That could not be saved.', 'error') } finally { answering.value = false }
}
function goToVenue(venue: string): void { shell.close(); void goTo(venue) }
function invite(): void { void growth.share('table', t.value.tableId ? { table: t.value.tableId, surface: 'table' } : { surface: 'table' }) }
function onOption(name: string, raw: string): void {
  const value = parseOption(raw)
  if (value !== undefined) tables.setOption(name, value)
}
</script>

<template>
  <p v-if="!connected" class="gr-note">{{ offlineWhy }}</p>
  <div v-else class="tb">
    <!-- The list -->
    <template v-if="!t.tableId">
      <p v-if="!t.list" class="gr-note">
        <template v-if="t.socket === 'closed'">Could not reach the tables. <button class="gr-swap" type="button" @click="tables.reconnect()">Try again</button></template>
        <template v-else>Looking for tables…</template>
      </p>
      <template v-else>
        <HeroCard label="Game tables" :figure="heroFigure(lists.mine.length)">{{ heroNote(paid) }}</HeroCard>
        <ul v-if="lists.mine.length" class="ui-rows">
          <li v-for="row in lists.mine" :key="row.id" class="ui-row">
            <span class="ui-row-icon" aria-hidden="true"><GameIcon name="tables" inline /></span>
            <span class="ui-row-body"><b>{{ tableTitle(row) }} <BaseChip :tone="rowStake(row).tone">{{ rowStake(row).text }}</BaseChip></b><small>{{ rowSub(row) }}</small></span>
            <span class="ui-row-end"><BaseButton variant="primary" @click="tables.openTable(row.id)">{{ openLabel(row, true) }}</BaseButton></span>
          </li>
        </ul>
        <EmptyState v-else compact icon="tables" :title="NO_TABLE_HERE.title" :text="NO_TABLE_HERE.text" />
        <template v-if="lists.other.length">
          <SectionTitle>Elsewhere in the city</SectionTitle>
          <LazyList class="ui-rows" :items="elsewhere.visible.value" :item-key="(row: (typeof lists.other)[number]) => row.id" :has-more="elsewhere.hasMore.value" :loading="false" :row-height="60" label="tables" @more="elsewhere.more()">
            <template #row="{ item: row }">
              <div class="ui-row">
                <span class="ui-row-icon" aria-hidden="true"><GameIcon name="tables" inline /></span>
                <span class="ui-row-body"><b>{{ tableTitle(row) }} <BaseChip :tone="rowStake(row).tone">{{ rowStake(row).text }}</BaseChip></b><small>{{ rowSub(row) }}</small></span>
                <span class="ui-row-end"><BaseButton @click="tables.openTable(row.id)">{{ openLabel(row, false) }}</BaseButton></span>
              </div>
            </template>
          </LazyList>
        </template>
        <p v-for="entry in ratings" :key="entry.id" class="gr-note">{{ ratingLine(entry.label, entry.rating) }}</p>
        <HowItWorks id="tables-rules" :rules="LIST_RULES" />
      </template>
    </template>

    <!-- A table that has not arrived yet -->
    <template v-else-if="!s || !table">
      <button class="gr-swap tb-back" type="button" @click="back">‹ All tables</button>
      <p class="gr-note">
        <template v-if="t.socket === 'closed'">Not connected to the table. <button class="gr-swap" type="button" @click="tables.reconnect()">Reconnect</button></template>
        <template v-else>Walking up to the table…</template>
      </p>
    </template>

    <!-- The table -->
    <template v-else>
      <div class="tb-top" :class="{ 'is-live': table.status !== 'open' }">
        <button class="gr-swap tb-back" type="button" @click="back">‹ All tables</button>
        <h3 class="tb-title">{{ tableTitle(table) }} <BaseChip :tone="rowStake(table).tone">{{ rowStake(table).text }}</BaseChip><small>{{ table.venueLabel }}{{ table.watching ? ` · ${table.watching} watching` : '' }}</small></h3>
      </div>
      <p v-if="t.socket !== 'open'" class="ui-error" role="alert">Reconnecting to the table… your seat is kept. <button class="gr-swap" type="button" @click="tables.reconnect()">Try now</button></p>

      <template v-if="table.status === 'open'">
        <div v-if="onPhone && !seated" class="tb-start">
          <BaseButton variant="primary" :reason="t.pending ? 'Waiting for the table to answer.' : null" @click="playBots(1)">Play the computer</BaseButton>
        </div>
        <div class="gr-card">
          <h3>At the table</h3>
          <p>
            <span v-if="table.seats.length" class="tb-seats"><BaseChip v-for="(seat, index) in table.seats" :key="index" :tone="seat.bot ? 'neutral' : 'good'">{{ seatLabel(seat) }}</BaseChip></span>
            <span v-else class="gr-note">Nobody is sitting yet.</span>
          </p>
          <BaseButton v-if="seated" @click="tables.leave()">Get up</BaseButton>
          <BaseButton v-else-if="atVenue" variant="primary" :reason="sitWhy" @click="tables.sit()">{{ sitLabel(table, free) }}</BaseButton>
          <template v-else>
            <p>You can watch from here. To sit, go to {{ table.venueLabel }}.</p>
            <BaseButton variant="primary" @click="goToVenue(table.venue)">Go to {{ table.venueLabel }}</BaseButton>
          </template>
        </div>
        <!-- The stake -->
        <div v-if="stakeCard && stakes" class="gr-card tb-stake">
          <h3>Stake</h3>
          <p><b>{{ stakeLine(table.stake) }}</b></p>
          <p v-if="staked" class="gr-note tb-playmoney">{{ PLAY_MONEY }}</p>
          <template v-if="stakes.choices.length">
            <div class="tb-start" role="group" aria-label="Choose the stake">
              <BaseButton :variant="table.stake === 0 ? 'selected' : 'default'" :reason="t.pending ? 'Waiting for the table to answer.' : null" @click="tables.setStake(0)">Free</BaseButton>
              <BaseButton v-for="choice in stakes.choices" :key="choice.amount" :variant="table.stake === choice.amount ? 'selected' : 'default'" :reason="t.pending ? 'Waiting for the table to answer.' : choice.why" @click="tables.setStake(choice.amount)">{{ money(choice.amount) }}</BaseButton>
            </div>
            <p class="gr-note">{{ pickNote }}</p>
            <p v-if="!staked" class="gr-note tb-playmoney">{{ PLAY_MONEY }}</p>
          </template>
          <p v-else-if="staked && !seated" class="gr-note">{{ acceptNote(table.stake) }}</p>
          <p v-if="stakes.why" class="ui-error" role="status">{{ stakes.why }}</p>
          <p v-else-if="choicesWhy" class="ui-error" role="status">{{ choicesWhy.why }}</p>
          <BaseButton v-if="stakes.code === 'adults_only' || choicesWhy?.code === 'adults_only'" :disabled="answering" @click="sayAdult">{{ answering ? 'Saving…' : 'I am 18 or older' }}</BaseButton>
        </div>
        <template v-if="seated">
          <div class="tb-start">
            <BaseButton v-if="table.seats.length >= table.min" variant="primary" :reason="t.pending ? 'Waiting for the table to answer.' : null" @click="tables.begin(0)">{{ staked ? `Start: play for ${money(table.stake)} each` : `Start with ${table.seats.length}` }}</BaseButton>
            <BaseButton v-for="count in botCounts(staked ? 0 : free)" :key="count" :variant="table.seats.length < table.min && count === 1 ? 'primary' : 'default'" :reason="t.pending ? 'Waiting for the table to answer.' : null" @click="tables.begin(count)">{{ botLabel(count) }}</BaseButton>
          </div>
          <p class="gr-note">{{ startNote(table) }}</p>
        </template>
        <BaseButton v-if="!onPhone" block :reason="busyWhy" @click="invite">{{ growth.state.busy === 'table' ? 'Preparing…' : 'Invite a friend to this table' }}</BaseButton>
        <div class="gr-card">
          <h3>Table rules</h3>
          <label v-for="option in s.optionList" :key="option.name" class="tb-option">{{ option.label }}
            <select :disabled="!s.host || rulesLocked" :title="rulesLocked ? 'The rules are fixed once two players have sat down for a stake.' : s.host ? undefined : hostNote(false)" @change="onOption(option.name, ($event.target as HTMLSelectElement).value)">
              <option v-for="(value, index) in option.values" :key="optionKey(value)" :value="optionKey(value)" :selected="value === option.value">{{ option.names[index] }}</option>
            </select>
          </label>
          <p class="gr-note">{{ hostNote(s.host) }}</p>
        </div>
        <HowItWorks v-if="rulesText.length" :id="`table-rules-${table.game}`" :rules="rulesText" :label="`How to play ${table.gameLabel}`" />
      </template>

      <template v-else>
        <p v-if="staked && !outcome" class="gr-note tb-playmoney"><b>{{ stakeLine(table.stake) }}.</b> {{ PLAY_MONEY }}</p>
        <div v-if="outcome && result" class="gr-card tb-result" :class="{ 'is-won': result.mine?.won }">
          <h3>{{ outcome.title }}</h3>
          <p>{{ result.text }}</p>
          <p v-if="outcome.note">{{ outcome.note }}</p>
          <p v-if="result.mine?.stake" class="gr-note tb-playmoney">{{ PLAY_MONEY }} {{ AGAIN_STAKE_NOTE }}</p>
          <BaseButton variant="primary" @click="tables.again()">Play again</BaseButton>
          <BaseButton v-if="result.mine?.won" :reason="busyWhy" @click="growth.share('table')">Share the win</BaseButton>
          <BaseButton @click="back">Leave the table</BaseButton>
        </div>
        <FriendOfferCard v-if="offerPeople.length" :people="offerPeople" source="table" @close="closeOffer" />
        <WhotBoard v-if="whot" :state="whot" :now="view.now" @play="tables.play" />
        <PenaltyBoard v-else-if="penalty" :state="penalty" :now="view.now" @play="tables.play" />
        <ChessBoard v-else-if="chess" :state="chess" :now="view.now" @play="tables.play" />
        <WeaveBoard v-else-if="weave" :state="weave" :now="view.now" @play="tables.play" />
        <AyoBoard v-else-if="ayo" :state="ayo" :now="view.now" :pending="t.pending" :error="t.error" @play="tables.play" />
        <p v-else class="gr-note">This game cannot be shown in this version.</p>
        <button v-if="table.status !== 'over' && seated" class="gr-swap tb-leave" type="button" @click="forfeit">Leave the game (you forfeit)</button>
        <BaseButton v-if="table.status !== 'over' && !onPhone" block :reason="busyWhy" @click="invite">{{ growth.state.busy === 'table' ? 'Preparing…' : 'Invite a friend to this table' }}</BaseButton>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* The existing panel's classes (src/ui/panels/tables.css and the growth screens' notes and cards), kept as they were. */
.tb .ui-row-body > b { overflow: visible; overflow-wrap: anywhere; text-overflow: clip; white-space: normal; }
.tb .ui-row-body > small { overflow-wrap: anywhere; white-space: normal; }
.gr-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gr-swap { background: none; border: 0; color: var(--c-muted); font: inherit; font-size: 12px; text-decoration: underline; padding: 4px; cursor: pointer; }
.tb-back { min-height: var(--tap, 44px); }
.tb-top { display: flex; align-items: center; gap: 4px 10px; margin: 0 0 var(--s-2); }
.tb-top .tb-back { flex: none; padding: 4px 8px 4px 2px; }
.tb-top .tb-title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 15px; text-align: right; }
.tb-top.is-live .tb-title small { display: none; }
.tb-leave { min-height: var(--tap, 44px); }
.gr-card { background: #fff; border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 14px; margin: 0 0 var(--s-3); }
.gr-card h3 { margin: 0 0 4px; font-size: 15px; }
.gr-card p { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--c-ink-2); }
.gr-card .base-button { margin: 4px 6px 0 0; }
.tb-title { margin: 6px 0 10px; font-size: 17px; line-height: 1.2; }
.tb-title small { display: block; font-weight: 400; font-size: 12px; color: var(--c-muted); }
.tb-seats { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.tb-start { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 6px; }
.tb-start .base-button { flex: 1 1 auto; min-height: var(--tap, 44px); }
.tb-option { display: grid; gap: 4px; font-size: 13px; margin: 8px 0; }
.tb-option select:disabled { background: var(--c-fill); color: var(--c-ink-2); opacity: 1; }
.tb-option select { min-height: var(--tap, 44px); border-radius: 12px; border: 1px solid var(--c-line); padding: 0 10px; font: inherit; background: #fff; }
.tb-result.is-won { background: var(--c-green-soft); }
.tb-playmoney { font-weight: 600; }
</style>
