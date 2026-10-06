<script setup lang="ts">
// The ride debt, wherever it blocks something: what is still owed, and one button — "Pay ₦12,000 now" when cash covers it (the existing
// 'travel.repay-ride'), otherwise the way to "What you can do now". It is gone as soon as the debt is.
import '../../../ui/panels/relief.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { useAct } from '../kit/act.ts'
import { debtLine } from './debtModel.ts'

const props = defineProps<{ helpHere?: boolean }>()
const { game, shell, command } = useApp()
const { act, pending } = useAct()
const line = computed(() => debtLine(game.view.value.estate?.ride.debt ?? 0, game.state.value.cash))
function press(): void {
  if (line.value?.canPay) void act('repay', () => command('travel.repay-ride', {}))
  else shell.open('bank')
}
</script>

<template>
  <section v-if="line" class="relief-link debt-pay" aria-label="Your ride home is not paid" data-debt-pay>
    <p class="debt-text">{{ line.text }}</p>
    <button v-if="line.canPay || !props.helpHere" type="button" class="relief-go" data-debt-button :disabled="pending !== null" @click="press">{{ line.button }}</button>
  </section>
</template>

<style scoped>
.debt-pay { display: grid; gap: 8px; }
.debt-text { white-space: normal; overflow-wrap: anywhere; line-height: 1.4; }
.debt-pay .relief-go { justify-self: start; }
</style>
