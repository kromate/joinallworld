<script setup lang="ts">
// "What you can do now": a calm card in the HUD when a player could be stuck (a visitor who cannot pay the way home, hunger with no
// money for a meal, no energy with no money for a room). It comes once for each situation and goes when dismissed; the wallet can
// open it again (the wallet). The situation is what reliefHelp.ts works out; this only shows it.
import '../../../ui/panels/relief.css'
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import ReliefActions from './ReliefActions.vue'
import { createDismissals, helpNow, shownHelp } from './reliefModel.ts'

const { game } = useApp()
const dismissals = createDismissals(globalThis.localStorage ?? null)
const gone = ref(0)
const help = computed(() => { void gone.value; return shownHelp(helpNow(game.state.value, game.cityId.value), dismissals.has) })
function dismiss(): void { if (help.value) dismissals.add(help.value.key); gone.value++ }
</script>

<template>
  <section v-if="help" class="relief-card" aria-label="What you can do now">
    <header><b>{{ help.title }}</b><button type="button" class="relief-close" aria-label="Dismiss" @click="dismiss">×</button></header>
    <p>{{ help.line }}</p>
    <ReliefActions :help="help" @done="dismiss" />
  </section>
</template>
