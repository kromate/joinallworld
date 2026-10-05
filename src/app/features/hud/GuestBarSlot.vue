<script setup lang="ts">
// Decides when the guest bar (account/GuestBar.vue, fetched only then) is on screen: a guest, accounts configured, in the
// venue view, with nothing else in front (the tour, a sheet, a running activity or trip, a call) and not dismissed in the
// last 7 days. The coach tip does not hold it back: they are in separate rows of the bottom stack. It sits in the bottom stack just above the navigation, so it never covers it.
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { barDue, barFacts, dismissBar, hiddenUntil } from '../account/guestBarModel.ts'
import { signupShown } from '../account/shownOnce.ts'
import { useAccountLite } from '../account/useAccountLite.ts'
import { callVisible } from '../calls/callState.ts'
import { tour } from '../tour/tourState.ts'

const GuestBar = defineAsyncComponent(() => import('../account/GuestBar.vue'))
const { game, shell } = useApp()
const lite = useAccountLite()
const storage = (): Storage | null => { try { return globalThis.localStorage } catch { return null } }
const hidden = ref(hiddenUntil(storage()))
// The answer depends on the session cookie: ask once the page is connected (the top bar does the same; one request serves both).
watch(() => game.view.value.connected, (on) => { if (on) void lite.load() }, { immediate: true })

const show = computed(() => {
  const view = game.view.value
  return barDue(barFacts({
    account: lite.state, connected: view.connected, creatorOpen: view.onboarding?.required === true, tour: tour.active || tour.pending,
    sheetOpen: Boolean(shell.sheet.value), activityRunning: Boolean(game.state.value.activeAction), callOnScreen: callVisible(),
    venue: game.mode.value === 'venue', hiddenUntil: hidden.value, now: Date.now(),
  }))
})
watch(show, (on) => { if (on) signupShown('guestbar') }, { immediate: true })
function dismiss(): void { hidden.value = dismissBar(storage(), Date.now()) }
</script>

<template>
  <GuestBar v-if="show" @dismiss="dismiss" />
</template>
