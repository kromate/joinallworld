<script setup lang="ts">
// In the wallet and the bank: what is owed for a ride home (and a way to pay it now), and, while money is short, "What you can do
// now" opened in place.
import '../../../ui/panels/relief.css'
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import DebtPay from './DebtPay.vue'
import ReliefActions from './ReliefActions.vue'
import { helpNow } from './reliefModel.ts'

const { game } = useApp()
const debt = computed(() => game.view.value.estate?.ride.debt ?? 0)
const help = computed(() => helpNow(game.state.value, game.cityId.value))
const open = ref(false)
</script>

<template>
  <DebtPay v-if="debt" help-here />
  <section v-if="help" class="relief-link" aria-label="Money is short">
    <div class="relief-row">
      <p>Money is short. There is a way through.</p>
      <button v-if="help" type="button" class="relief-go" :aria-expanded="open" @click="open = !open">{{ open ? 'Hide' : 'What you can do now' }}</button>
    </div>
    <ReliefActions v-if="help && open" :help="help" @done="open = false" />
  </section>
</template>
