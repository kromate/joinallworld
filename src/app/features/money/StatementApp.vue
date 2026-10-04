<script setup lang="ts">
// Statement: exactly why the balance is what it is.
//
// Opening balance, money in and out for each Lagos day (with the reasons that moved the most),
// every recent change line by line with its reason and time, and the closing balance — with the
// arithmetic shown. The page is drawn from view.wallet (the life the server sent), and "Check with
// the server" fetches GET /api/support/statement, the same statement computed from the server's own
// copy, and says whether the two agree (a toast, and a line that stays under the button). Nothing
// here changes anything.
import { computed, ref } from 'vue'
import type { WalletStatement } from '../../../types/view.ts'
import { formatClock } from '../../../game/clock.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../legacy/modules.ts'
import { money, signedMoney } from '../../ui/format.ts'
import EmptyState from '../../ui/EmptyState.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import ListRow from '../../ui/ListRow.vue'
import ListRows from '../../ui/ListRows.vue'
import RowMark from '../../ui/RowMark.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { changes, dayLabel, failedVerdict, sameStatement, statementRules, verdictOf } from './statementModel.ts'
import type { Verdict } from './statementModel.ts'
import { checked } from './statementState.ts'

defineProps<{ params?: unknown }>()

const { game, shell } = useApp()
const view = game.view
const wallet = computed(() => view.value.wallet)
const summary = computed(() => wallet.value.statement)
const since = computed(() => (summary.value.opening.day === null ? 'before your first change' : `at the start of ${dayLabel(summary.value.opening.day)}`))
const verdict = computed<Verdict | null>(() => (checked.value && checked.value.cityId === view.value.cityId ? checked.value : null))
const offline = computed(() => (view.value.connected ? null : `${linkWords(view.value)?.why ?? ''} This check needs the server.`))
const busy = ref(false)

async function check(): Promise<void> {
  if (busy.value) return
  const cityId = view.value.cityId
  busy.value = true
  try {
    const reply = await game.fetchJson<{ statement: WalletStatement }>(`/api/support/statement?city=${encodeURIComponent(cityId)}`)
    const server = reply.statement, mine = view.value.wallet.statement
    checked.value = verdictOf(cityId, server, sameStatement(server, mine, game.state.value.cash))
  } catch (error) {
    checked.value = failedVerdict(cityId, error instanceof Object && 'status' in error ? error.status : undefined)
  } finally { busy.value = false }
  // The answer is also a toast, like every other action taken inside a sheet; the line under the button stays.
  const done = checked.value
  if (done) game.toast(done.ok ? 'The server’s statement agrees with this one.' : done.text, done.ok ? 'good' : 'error')
}
</script>

<template>
  <EmptyState v-if="!summary" icon="statement" title="No statement yet" text="This life has no wallet history to explain yet. Your first fare, meal or wage starts it." />
  <div v-else class="statement-app">
    <section class="ui-hero statement-hero" aria-label="Closing balance"><small>Closing balance · {{ changes(summary.totals.changes) }}</small><strong>{{ money(summary.closing) }}</strong></section>
    <dl class="statement-sums">
      <div><dt>Opening balance <small>{{ since }}</small></dt><dd>{{ money(summary.opening.balance) }}</dd></div>
      <div><dt>Money in</dt><dd class="is-in">+{{ money(summary.totals.in) }}</dd></div>
      <div><dt>Money out</dt><dd class="is-out">−{{ money(summary.totals.out) }}</dd></div>
    </dl>
    <p v-if="summary.reconciled" class="statement-ok">{{ money(summary.opening.balance) }} + {{ money(summary.totals.in) }} − {{ money(summary.totals.out) }} = {{ money(summary.closing) }}. Every naira is accounted for.</p>
    <p v-else class="statement-bad" role="alert">This statement does not add up: {{ summary.problems.join(' ') }} Please use Phone → Report a problem; your history is attached automatically.</p>
    <span class="statement-check">
      <button type="button" class="ui-button is-block" :disabled="Boolean(offline) || busy" :title="offline ?? undefined" @click="check()">{{ busy ? 'Checking…' : 'Check with the server' }}</button>
      <small v-if="offline" class="ui-why">{{ offline }}</small>
    </span>
    <p v-if="verdict" :class="verdict.ok ? 'statement-ok' : 'statement-bad'" role="status">{{ verdict.text }}</p>

    <h3 class="ui-section">By day</h3>
    <ul v-if="wallet.days.length" class="statement-days">
      <li v-for="day in wallet.days" :key="day.day">
        <div class="statement-day"><strong>{{ dayLabel(day.day) }}</strong><span>{{ money(day.open) }} → {{ money(day.close) }}</span></div>
        <div class="statement-flow"><span class="is-in">+{{ money(day.in) }}</span><span class="is-out">−{{ money(day.out) }}</span><small>{{ changes(day.changes) }}</small></div>
        <ul class="statement-groups">
          <li v-for="group in day.groups" :key="group.group"><span>{{ group.group }}<template v-if="group.count > 1"> × {{ group.count }}</template></span><b :class="group.net < 0 ? 'is-out' : 'is-in'">{{ signedMoney(group.net) }}</b></li>
        </ul>
      </li>
    </ul>
    <EmptyState v-else compact icon="calendar" title="No changes yet" text="Your first fare, meal or wage will appear here, day by day." />

    <h3 class="ui-section">Recent changes</h3>
    <ListRows v-if="wallet.ledger.length" as="ul" label="Recent changes">
      <ListRow v-for="(line, index) in wallet.ledger" :key="`${line.at}:${index}`" as="li" :title="line.reason" :sub="`${formatClock(line.at)} · balance ${money(line.balance)}`">
        <template #icon><RowMark round :tone="line.amount < 0 ? 'out' : 'in'"><GameIcon :name="line.amount < 0 ? 'spend' : 'earn'" /></RowMark></template>
        <template #end><span :class="line.amount < 0 ? 'is-out' : 'is-in'">{{ signedMoney(line.amount) }}</span></template>
      </ListRow>
    </ListRows>
    <EmptyState v-else compact icon="statement" title="Nothing yet" text="Every change to your balance is listed here with its reason and time." />
    <HowItWorks id="statement-rules" page label="How this statement works" :rules="statementRules(summary.kept)" />
    <button type="button" class="ui-button is-block statement-wrong" @click="shell.open('support', { category: 'money' })">Something here looks wrong</button>
  </div>
</template>

<style scoped src="../../../ui/panels/statement.css"></style>
<style scoped>
.is-in { color: var(--c-green-dark); }
.is-out { color: var(--c-red); }
</style>
