<script setup lang="ts">
// Decides when the guest bar (account/GuestBar.vue, fetched only then) is on screen: a guest, accounts configured, in the
// venue view, with nothing else in front (the tour, a sheet, a running activity or trip, a call) and not dismissed in the
// last 7 days. The coach tip does not hold it back: they are in separate rows of the bottom stack. It sits in the bottom stack just above the navigation, so it never covers it.
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { barDue, barFacts, dismissBar, hiddenUntil } from '../account/guestBarModel.ts'
import { signupShown } from '../account/shownOnce.ts'
import { offerDue, owed, settle } from '../growth/touchOfferModel.ts'
import { useAccountLite } from '../account/useAccountLite.ts'
import { callVisible } from '../calls/callState.ts'
import { tour } from '../tour/tourState.ts'

const GuestBar = defineAsyncComponent(() => import('../account/GuestBar.vue'))
const TouchOffer = defineAsyncComponent(() => import('../growth/TouchOffer.vue'))
const MailNotice = defineAsyncComponent(() => import('../growth/MailNotice.vue'))
// Offers notifications after a win at a table or a new friend, never on arrival (growth/notifyAsk.ts).
const NotifyAsk = defineAsyncComponent(() => import('../growth/NotifyAsk.vue'))
const app = useApp()
const { game, shell } = app
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
// The one-time pointer to "Older characters" is its own small file, fetched when it is due.
watch(() => [game.view.value.connected, game.view.value.session?.id, game.view.value.onboarding?.required, tour.active, tour.pending, Boolean(shell.sheet.value)], () => { setTimeout(() => void import('./olderPointer.ts').then((m) => m.pointToOlder(app)), 4000) }, { immediate: true })
// Right after an account is made: one offer of Stay in touch (growth/touchOfferModel.ts), in the same place as the guest bar, never both.
const offerOwed = ref(owed(storage()))
const offerFacts = () => {
  const view = game.view.value
  return {
    owed: offerOwed.value, signedIn: lite.state.account !== null, connected: view.connected, creating: view.onboarding?.required === true, tour: tour.active || tour.pending,
    busy: Boolean(shell.sheet.value) || Boolean(game.state.value.activeAction) || callVisible(), venue: game.mode.value === 'venue',
  }
}
const offer = computed(() => offerDue(offerFacts()))
// An account whose e-mails were switched on by default is told once (growth/MailNotice.vue asks the server and shows nothing otherwise).
// It is fetched a few seconds after a signed-in player is in the game with nothing in front, and then stays until answered.
const calm = computed(() => offerDue({ ...offerFacts(), owed: true }))
const mailNotice = ref(false)
watch(calm, (on) => { if (on && !mailNotice.value) setTimeout(() => { if (calm.value) mailNotice.value = true }, 6000) }, { immediate: true })
function closeOffer(): void { settle(storage()); offerOwed.value = false }
function openOffer(): void { closeOffer(); shell.open('touch') }
function dismiss(): void { hidden.value = dismissBar(storage(), Date.now()) }
</script>

<template>
  <GuestBar v-if="show" @dismiss="dismiss" />
  <TouchOffer v-else-if="offer" @open="openOffer" @dismiss="closeOffer" />
  <MailNotice v-else-if="mailNotice && calm" />
  <NotifyAsk v-if="game.view.value.connected" />
</template>
