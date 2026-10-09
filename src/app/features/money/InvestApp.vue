<script setup lang="ts">
// Invest app: fixed deposits — an original beta savings product.
// Lock cash for 1, 3 or 7 days; principal plus a small fixed interest returns automatically at
// maturity on server time. Limits and rates come from view.economy.savings (systems/economy.js).
// No gambling and no random outcome.
//
// Actions: 'economy.open-deposit' { amount, term } and 'economy.close-deposit' { id }.
import { computed } from 'vue'
import type { DepositTermId } from '../../../types/life.ts'
import { formatClock } from '../../../game/clock.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import EmptyState from '../../ui/EmptyState.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import { readOnlyReason, useAct } from '../kit/act.ts'
import { investRules, pickAmount } from './investModel.ts'
import { chosen, closing } from './investState.ts'

defineProps<{ params?: unknown }>()

const { game, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const economy = computed(() => view.value.economy)
const savings = computed(() => economy.value.savings)
const offline = computed(() => readOnlyReason(view.value.connected ? null : linkWords(view.value)?.why))
const pick = computed(() => pickAmount(savings.value, chosen.value))
const blocked = computed(() => offline.value || pick.value?.blocked || null)
const wait = computed(() => pending.value !== null)

const open = (term: DepositTermId): Promise<boolean> => act(`open:${term}`, () => command('economy.open-deposit', { amount: pick.value?.amount ?? 0, term }))
const close = (id: string): Promise<boolean> => act(`close:${id}`, () => command('economy.close-deposit', { id }))
</script>

<template>
  <div class="invest-app">
    <section class="ui-hero invest-hero" aria-label="Locked savings">
      <small>Locked in deposits <span class="invest-beta">Beta</span></small>
      <strong>{{ money(savings.locked) }}</strong>
      <p>of {{ money(savings.cap) }} allowed · balance {{ money(game.state.value.cash) }} · up to {{ savings.maxOpen }} deposits at once</p>
    </section>
    <section v-if="pick" class="invest-card">
      <h3>Open a deposit</h3>
      <p class="ui-note">Pick an amount, then a term. Closing early returns the amount without interest.</p>
      <div class="invest-amounts" role="group" aria-label="Deposit amount">
        <button v-for="item in savings.amounts" :key="item.amount" type="button" :aria-pressed="item.amount === pick.amount" :disabled="wait" @click="chosen = item.amount">{{ money(item.amount) }}</button>
      </div>
      <div class="invest-terms">
        <button v-for="term in savings.terms" :key="term.id" type="button" class="invest-term" :disabled="Boolean(blocked) || wait" :title="blocked ?? undefined" @click="open(term.id)">
          <span><b>Lock for {{ term.label }}</b><small>{{ term.percent }}% fixed interest</small></span>
          <span class="invest-get"><small>you get</small>{{ money(pick.payouts[term.id]) }}</span>
        </button>
      </div>
      <p v-if="blocked" class="ui-why">{{ blocked }}</p>
    </section>

    <h3 class="ui-section">Your deposits</h3>
    <section v-for="deposit in economy.deposits" :key="deposit.id" class="invest-card">
      <div class="invest-row"><h3>{{ money(deposit.amount) }}<small>{{ deposit.termLabel }}</small></h3><b class="ui-chip is-good">+{{ money(deposit.interest) }}</b></div>
      <p>Pays {{ money(deposit.payout) }} into your balance automatically on {{ deposit.maturesLabel }} ({{ formatClock(deposit.maturesAt) }}).</p>
      <div v-if="closing === deposit.id" class="ui-confirm">
        <p>Close early? You get your {{ money(deposit.amount) }} back now and give up the {{ money(deposit.interest) }} interest.</p>
        <div>
          <BaseButton variant="danger" :disabled="wait" :reason="offline" @click="close(deposit.id)">Close without interest</BaseButton>
          <BaseButton variant="primary" :disabled="wait" @click="closing = null">Keep it</BaseButton>
        </div>
      </div>
      <BaseButton v-else small :disabled="wait" @click="closing = deposit.id">Close early (no interest)</BaseButton>
    </section>
    <EmptyState v-if="!economy.deposits.length" compact icon="invest" title="No open deposits" text="Pick an amount and a term above. The money comes back by itself, with interest, when the term ends." />
    <HowItWorks id="invest-rules" page label="How deposits work" :rules="investRules(savings, money)" />
  </div>
</template>

<style scoped src="../../../ui/panels/invest.css"></style>
