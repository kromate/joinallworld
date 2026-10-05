<script setup lang="ts">
// Decides when the guest bar (account/GuestBar.vue, fetched only then) is on screen: a guest, accounts configured, in the
// venue view, with nothing else in front (the tour, a sheet, a running activity or trip, a call) and not dismissed in the
// last 7 days. It sits in the bottom stack just above the navigation, so it never covers it.
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { barDue, dismissBar, hiddenUntil } from '../account/guestBarModel.ts'
import { signupShown } from '../account/shownOnce.ts'
import { useAccountLite } from '../account/useAccountLite.ts'
import { callVisible } from '../calls/callState.ts'
import { tour } from '../tour/tourState.ts'

const GuestBar = defineAsyncComponent(() => import('../account/GuestBar.vue'))
const { game, shell } = useApp()
const lite = useAccountLite()
const storage = (): Storage | null => { try { return globalThis.localStorage } catch { return null } }
const hidden = ref(hiddenUntil(storage()))

const show = computed(() => {
  const view = game.view.value
  return barDue({
    enabled: lite.state.loaded && lite.state.enabled, guest: lite.state.guest && lite.state.account === null, connected: view.connected,
    creating: view.onboarding?.required === true || shell.ui.coaching, tour: tour.active || tour.pending,
    busy: Boolean(shell.sheet.value) || Boolean(game.state.value.activeAction) || callVisible(),
    venue: game.mode.value === 'venue', hiddenUntil: hidden.value, now: Date.now(),
  })
})
watch(show, (on) => { if (on) signupShown('guestbar') }, { immediate: true })
function dismiss(): void { hidden.value = dismissBar(storage(), Date.now()) }
</script>

<template>
  <GuestBar v-if="show" @dismiss="dismiss" />
</template>
