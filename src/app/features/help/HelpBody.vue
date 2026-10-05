<script setup lang="ts">
// How to play: the Help app in the phone, and the help sheet (the ? key) outside it.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { shortcutRows } from '../../../ui/keys.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { openWorld } from '../tour/tourWorld.ts'

const { game, shell } = useApp()
const country = computed(() => openWorld(game.cityId.value).country)
const STEPS = computed(() => [
  { icon: 'home', title: 'Do things', text: 'Pick a spot in the venue panel, then an activity. It takes real seconds and finishes on the server even if you close the tab.' },
  { icon: 'map', title: 'Go places', text: 'Open the Map to travel. Every fare, trip time and closing hour is shown before you go.' },
  { icon: 'phone', title: 'Use your phone', text: 'Jobs, Bank, Messages and every other app live in the Phone (P). Red badges mean something is waiting.' },
  { icon: 'person', title: 'Look after your Sim', text: 'The six bars are your needs. Tap your avatar for your profile, goals, skills and people.' },
  { icon: 'globe', title: 'Travel to other cities', text: `Open the Map and tap World at the top. Tap a city that is open, then the bus, train or flight: the price and the seconds it takes are on each button. You stay a visitor there, with a guest house for the night, and your home stays where it is. Cities in ${country.value} are open; more of Africa and the world are coming.` },
  { icon: 'chat', title: 'Call and chat', text: 'Tap the online count, then a player, to chat or Call them; they choose whether to answer. The chat button at a place opens its community.' },
  { icon: 'bell', title: 'Ping a friend', text: 'A friend who is not in the game has Ping where Call would be: one tap tells them you are here. If they come, they land right where you are.' },
  { icon: 'career', title: 'Work and business', text: 'Jobs and Career earn your pay, Bank and Invest look after it, and Billboards advertise for you.' },
] as const)
const rows = shortcutRows()
/** The walkthrough starts after this sheet closes (src/app/features/tour/TourTrigger.vue). */
function takeTour(): void { window.dispatchEvent(new CustomEvent('jaw:tour')) }
function showShortcuts(): void { window.dispatchEvent(new CustomEvent('jaw:shortcuts', { detail: { from: 'help' } })) }
</script>

<template>
  <div class="help">
    <ul class="help-steps">
      <li v-for="step in STEPS" :key="step.title"><i aria-hidden="true"><GameIcon bare :name="step.icon" /></i><div><b>{{ step.title }}</b><span>{{ step.text }}</span></div></li>
    </ul>
    <p class="help-note">The <b>More</b> button holds the weather, the gem hunt, messages and the city switch. <b>Clean screen</b> (the eye, or X) hides the panels so you can see the whole scene.</p>
    <p class="help-note">{{ game.connected.value ? 'Your progress is saved on this server. As a guest your character lives on this device; make a free account (Sign up) to keep it and play on any device.' : 'You are not connected: what you see is the last saved copy, and nothing changes until the connection is back.' }}</p>
    <div class="help-actions">
      <BaseButton block variant="primary" @click="takeTour">Take the tour</BaseButton>
      <BaseButton block @click="showShortcuts">Keyboard shortcuts</BaseButton>
    </div>
    <h3>Keyboard</h3>
    <dl class="help-keys"><div v-for="row in rows" :key="row.label"><dt><kbd>{{ row.label }}</kbd></dt><dd>{{ row.description }}</dd></div></dl>
    <BaseButton block @click="shell.open('support')">Report a problem</BaseButton>
  </div>
</template>

<style scoped>
.help-actions { display: grid; gap: 8px; margin: 0 0 16px; }
</style>
