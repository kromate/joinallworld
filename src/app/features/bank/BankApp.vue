<script setup lang="ts">
// Bank app: balance, what is due each Saturday, the rent card, the loan card, savings and the
// full recent transaction list (view.wallet.ledger, newest first) so every change is explained.
//
// Everything shown comes from the view (systems/economy.js, career.js, wallet.js). Payments are
// the 'economy.pay-rent' and 'economy.pay-loan' { mode } actions: the button that was pressed
// says "Paying…" until the server answers, and the answer — not the press — changes the numbers.
import { computed, defineAsyncComponent, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { formatClock } from '../../../game/clock.ts'
import { money, signedMoney } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import BaseChip from '../../ui/BaseChip.vue'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import ListRow from '../../ui/ListRow.vue'
import ListRows from '../../ui/ListRows.vue'
import RowMark from '../../ui/RowMark.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import { linkWords } from '../../../ui/link.ts'
// Loaded when the wallet opens, not with it: it only matters while money is short.
const ReliefLink = defineAsyncComponent(() => import('../relief/ReliefLink.vue'))
import { billsLine, loanReasons, loanRule, rentStanding } from './bankLines.ts'

defineProps<{ params?: unknown }>()

const { game, shell, command } = useApp()
const state = game.state
const view = game.view
const economy = computed(() => view.value.economy)
const career = computed(() => view.value.career)
const ledger = computed(() => view.value.wallet.ledger)
// Why nothing can be paid right now, in the words of the real connection state.
const offline = computed(() => { const words = view.value.connected ? null : linkWords(view.value); return words ? `${words.why} Read-only until that is resolved.` : null })
const loanRules = computed(() => loanRule(loan.value?.rule))
const bills = computed(() => billsLine(economy.value, career.value))
const rent = computed(() => economy.value.rent)
const loan = computed(() => economy.value.loan)
const standing = computed(() => (rent.value ? rentStanding(rent.value) : null))
const rentBlocked = computed(() => offline.value || rent.value?.payBlocked || null)
const reasons = computed(() => (loan.value ? loanReasons(loan.value, offline.value) : []))
const repaid = computed(() => Math.round((loan.value?.progress ?? 0) * 100))

/** Which payment is on its way to the server. One at a time: the server refuses a second as 'busy'. */
const paying = ref<'rent' | 'week' | 'all' | null>(null)
async function pay(which: 'rent' | 'week' | 'all'): Promise<void> {
  if (paying.value) return
  paying.value = which
  try {
    const result = which === 'rent' ? await command('economy.pay-rent') : await command('economy.pay-loan', { mode: which })
    // The phone covers the scene, so a payment confirms itself here. A refusal was already shown with the server's reason.
    if (result.ok && state.value.message) game.toast(state.value.message, 'good')
  } finally { paying.value = null }
}
</script>

<template>
  <div class="bank">
    <ReliefLink />
    <HeroCard label="Balance" :figure="money(state.cash)">
      <template v-if="bills.due">
        Due every Saturday: <b>{{ money(economy.weeklyBills) }}</b> · next {{ economy.nextDueLabel }}.
        <template v-if="bills.tail === 'pay'"> Your job pays up to {{ money(career.weeklyPay) }} a week.</template>
        <template v-else-if="bills.tail === 'no-job'"> You have no job yet — open Jobs to start earning.</template>
      </template>
      <template v-else>No weekly bills yet.</template>
    </HeroCard>
    <p class="ui-note">Game money only. Real store earnings are shown in My Store.</p>
    <div v-if="offline" class="bank-why" role="status">{{ offline }}</div>

    <div class="bank-quick">
      <BaseButton @click="shell.open('statement')">Statement</BaseButton>
      <BaseButton @click="shell.open('invest')">Invest</BaseButton>
      <BaseButton v-if="!career.employed" @click="shell.open('jobs')">Find a job</BaseButton>
    </div>

    <div class="bank-cards">
    <section v-if="!rent" class="bank-card" aria-label="Rent">
      <header><span class="bank-card-mark" aria-hidden="true"><GameIcon name="home" /></span><div><b>Rent</b></div></header>
      <div class="bank-note">No rent yet: it starts when you move into a rented home.</div>
      <HowItWorks id="bank-rent" :rules="['Once you live in a rented home, its rent is collected here automatically every Saturday (Nigerian time), even while you are away.', 'Missed-rent rules are original beta rules.']" />
    </section>
    <section v-else class="bank-card" :class="{ 'is-warning': rent.arrears > 0 }" aria-label="Rent">
      <header>
        <span class="bank-card-mark" aria-hidden="true"><GameIcon name="home" /></span>
        <div><b>Rent</b><small>{{ rent.label }}</small></div>
        <strong>{{ money(rent.amount) }}<small>per week</small></strong>
      </header>
      <div class="bank-line"><BaseChip v-if="standing" :tone="standing.tone">{{ standing.label }}</BaseChip> Next due <b>{{ rent.nextDueLabel }}</b></div>
      <div v-if="rent.warning" class="bank-warning" role="alert">{{ rent.warning }}</div>
      <template v-if="rent.arrears > 0">
        <div class="bank-actions">
          <BaseButton variant="primary" :disabled="paying !== null" :reason="rentBlocked" @click="pay('rent')">{{ paying === 'rent' ? 'Paying…' : `Pay ${money(rent.arrears)} rent now` }}</BaseButton>
        </div>
        <div v-if="rentBlocked" class="bank-why">{{ rentBlocked }}</div>
      </template>
      <div v-if="rent.lateFee > 0 && !rent.warning" class="bank-note">A missed week must be paid within a week, or a {{ money(rent.lateFee) }} late fee is added.</div>
      <HowItWorks id="bank-rent" :rules="[rent.rule, 'Missed rent becomes arrears. Pay it within a week — here, or it is collected on a Saturday when your balance covers it — or the late fee is added.', 'You keep your home in this beta. Missed-rent rules are original beta rules.']" />
    </section>

    <section v-if="loan" class="bank-card" aria-label="Loan">
      <header>
        <span class="bank-card-mark" aria-hidden="true"><GameIcon name="handshake" /></span>
        <div><b>Starting loan</b><small>{{ money(loan.weekly) }} per week</small></div>
        <strong>{{ money(loan.left) }}<small>left to pay</small></strong>
      </header>
      <div class="bank-line">{{ money(loan.paid) }} of {{ money(loan.total) }} repaid<template v-if="loan.fees"> (includes {{ loan.fees }} late fee{{ loan.fees > 1 ? 's' : '' }})</template></div>
      <div class="bank-bar" role="meter" aria-label="Loan repaid" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="repaid"><i :style="{ width: `${repaid}%` }" /></div>
      <div class="bank-line">{{ loan.nextCollection }}</div>
      <template v-if="!loan.cleared">
        <div class="bank-actions">
          <BaseButton variant="primary" :disabled="paying !== null" :reason="offline || loan.weekBlocked" @click="pay('week')">{{ paying === 'week' ? 'Paying…' : `Pay ${money(loan.instalment)} now` }}</BaseButton>
          <BaseButton :disabled="paying !== null" :reason="offline || loan.allBlocked" @click="pay('all')">{{ paying === 'all' ? 'Paying…' : 'Pay it all off' }}</BaseButton>
        </div>
        <div v-for="reason in reasons" :key="reason" class="bank-why">{{ reason }}</div>
        <div v-if="loanRules.penalty" class="bank-note">{{ loanRules.penalty }}</div>
        <HowItWorks id="bank-loan" :rules="['Paying one instalment now covers the next Saturday collection.', ...loanRules.rest, 'Paying it all off ends the collections at once.']" />
      </template>
    </section>
    </div>

    <ListRows>
      <ListRow as="button" title="Savings" sub="Fixed deposits pay a small, capped interest (beta)" @click="shell.open('invest')">
        <template #icon><RowMark><GameIcon name="lock" /></RowMark></template>
        <template #end><span class="bank-locked">{{ money(economy.savings.locked) }}<small>locked</small></span><GameIcon name="chevron" :size="16" /></template>
      </ListRow>
    </ListRows>

    <SectionTitle :note="ledger.length ? `last ${ledger.length}, newest first` : ''">Recent transactions</SectionTitle>
    <ListRows v-if="ledger.length" as="ul" label="Recent transactions">
      <ListRow v-for="(entry, index) in ledger" :key="`${entry.at}:${index}`" as="li" :title="entry.reason" :sub="`${formatClock(entry.at)} · balance ${money(entry.balance)}`">
        <template #icon><RowMark round :tone="entry.amount < 0 ? 'out' : 'in'"><GameIcon :name="entry.amount < 0 ? 'spend' : 'earn'" /></RowMark></template>
        <template #end><span :class="entry.amount < 0 ? 'bank-out' : 'bank-in'">{{ signedMoney(entry.amount) }}</span></template>
      </ListRow>
    </ListRows>
    <EmptyState v-else compact icon="statement" title="No transactions yet" text="Every fare, purchase, wage and payment will be listed here with its reason." />
  </div>
</template>

<style scoped>
.bank-quick { display: flex; gap: var(--s-2); margin: 0 0 var(--s-3); }
.bank-quick > * { flex: 1; padding: 10px 8px; background: #fff; box-shadow: var(--ring); }
/* Rent and loan: stacked on a phone, side by side when the phone is expanded on a desktop. */
.bank-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); margin: 0 0 var(--s-2); align-items: start; }
:global(.ph.is-wide) .bank-cards { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
.bank-card { margin: 0; padding: var(--s-3) var(--s-4) var(--s-4); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); font-size: var(--t-body); line-height: 1.45; }
.bank-card.is-warning { box-shadow: var(--e-1), inset 0 0 0 1.5px var(--c-amber); background: #fffaf0; }
.bank-card header { display: flex; align-items: center; gap: 10px; margin: 0 0 var(--s-2); }
.bank-card header > div { flex: 1; min-width: 0; font-size: 15px; }
.bank-card header b { font-weight: 700; }
.bank-card header small { display: block; font-size: 12px; font-weight: 500; color: var(--c-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bank-card header > strong { flex: none; text-align: right; font-size: var(--t-title); white-space: nowrap; font-variant-numeric: tabular-nums; }
.bank-card-mark { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: var(--c-fill); font-size: 19px; }
.bank-line { margin: 5px 0; }
.bank-warning { margin: 5px 0; padding: 8px 10px; border-radius: var(--r-sm); background: var(--c-red-soft); color: var(--c-red-dark); font-weight: 600; }
.bank-note { margin: 5px 0 0; color: var(--c-muted); font-size: 12px; }
.bank-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-2); }
.bank-actions > * { flex: 1 1 140px; }
.bank-why { margin: 4px 0 var(--s-2); color: var(--c-red); font-size: 12px; line-height: 1.4; }
.bank-card .bank-why { margin-bottom: 0; }
.bank-bar { height: 8px; margin: var(--s-2) 0; border-radius: 8px; background: var(--c-fill-2); overflow: hidden; }
.bank-bar i { display: block; height: 100%; border-radius: 8px; background: var(--c-green); }
.bank-locked { display: block; }
.bank-locked small { display: block; font-size: 11px; font-weight: 500; color: var(--c-muted); }
.bank-in { color: var(--c-green-dark); }
.bank-out { color: var(--c-red); }
</style>
