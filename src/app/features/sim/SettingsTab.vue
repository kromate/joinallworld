<script setup lang="ts">
// Settings tab of the Sim sheet: the sound preferences, the device-session explanation and
// the privacy switches the server already offers.
//
// The sound preferences are stored on this device (localStorage, src/audio/settings.ts) and nowhere else;
// nothing here is sent to the server.
//
// The account section (features/account/AccountSettings.vue) draws itself only when accounts are
// configured on this server. A guest is still told what a device session is, so nobody mistakes it
// for a password-protected account; that explanation is left out once the device is signed in.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
// The wallpaper tiles are drawn by the phone's stylesheet; the phone's code may not have been fetched yet.
import '../../../ui/phone/phone.css'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { WALLPAPERS, getWallpaper, setWallpaper } from '../../../ui/phone/wallpapers.ts'
import LinkButton from '../growth/LinkButton.vue'
import { useGrowth } from '../growth/useGrowth.ts'
import GameIcon from '../../ui/GameIcon.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import CallSettings from '../calls/CallSettings.vue'
import AccountSettings from '../account/AccountSettings.vue'
import { useAccount } from '../account/useAccount.ts'
import { HINTS_KEY, hintsOn } from './settingsModel.ts'
import { NOT_SAVED, SESSION_RULES, WALLPAPER_NOT_SAVED } from './settingsOptions.ts'
import { SOUND_NOT_SAVED, SOUND_SLIDERS, SOUND_SWITCHES, change, percent, soundSummary } from './soundSettingsModel.ts'
import { getSound, onSoundChange, setSound } from '../../../audio/settings.ts'
import { play } from '../../../audio/play.ts'

defineProps<{ params?: unknown }>()

const { game, shell } = useApp()
const growth = useGrowth()
const account = useAccount()
const view = game.view
function store(): Storage | null { try { return window.localStorage } catch { return null } }

const sound = reactive({ ...getSound() })
const stopSound = onSoundChange(() => { Object.assign(sound, getSound()) })
onBeforeUnmount(stopSound)
function changeSound(id: Parameters<typeof change>[0], value: boolean | number | string): void {
  warning.value = setSound(change(id, value)) ? '' : SOUND_NOT_SAVED
}
const hints = ref(hintsOn(store()))
const wall = ref(getWallpaper())
const warning = ref('')
const device = computed(() => (view.value.connected ? 'progress saved on the server' : `${linkWords(view.value)?.short ?? ''}: this is the last copy kept on this device`))

function toggleHints(on: boolean): void {
  hints.value = on
  try { if (on) store()?.removeItem(HINTS_KEY); else store()?.setItem(HINTS_KEY, '1') } catch { warning.value = NOT_SAVED }
  window.dispatchEvent(new CustomEvent('jaw:hints'))
}
function pickWall(id: string): void { warning.value = setWallpaper(id) ? '' : WALLPAPER_NOT_SAVED; wall.value = id }

function showTour(): void { window.dispatchEvent(new CustomEvent('jaw:tour')) }
function openPrivacy(): void { window.dispatchEvent(new CustomEvent('jaw:privacy')) }

const olderLives = ref<{ id: string; city: string; cash: number }[]>([])
const switching = ref(false)
const switchError = ref('')
const switchReceipts = new Map<string, string>()
async function loadOlderLives(): Promise<void> {
  if (!game.client.online) return
  try { olderLives.value = (await game.client.api<{ legacy: typeof olderLives.value }>('/api/characters')).legacy }
  catch { switchError.value = 'Older characters could not be loaded. Try again.' }
}
async function switchOlderLife(id: string): Promise<void> {
  if (switching.value) return
  switching.value = true
  const receipt = switchReceipts.get(id) ?? game.client.newId()
  switchReceipts.set(id, receipt)
  const result = await game.client.switchLegacy(id, receipt)
  switching.value = false
  switchError.value = result.ok ? '' : result.reason ?? 'Could not switch characters. Try again.'
  if (result.ok) { switchReceipts.delete(id); await loadOlderLives() }
}

onMounted(() => { void growth.load(); void loadOlderLives() })
</script>

<template>
  <div class="settings-app">
    <h3 class="ui-section">Phone wallpaper</h3>
    <div class="settings-walls" role="group" aria-label="Phone wallpaper">
      <button v-for="item in WALLPAPERS" :key="item.id" type="button" class="settings-wall" :class="`wall-${item.id}`" :aria-pressed="item.id === wall" :aria-label="`${item.label} wallpaper`" @click="pickWall(item.id)"><span>{{ item.label }}</span></button>
    </div>
    <p class="settings-note">Saved on this device only. Open the Phone to see it.</p>

    <h3 class="ui-section">Guidance</h3>
    <div class="ui-rows">
      <button class="ui-row settings-row" type="button" @click="showTour"><span class="ui-row-body"><b>Show the tour again</b><small>A short walkthrough of the screen.</small></span></button>
      <label class="ui-row settings-row"><span class="ui-row-body"><b>Hints</b><small>Point at the next thing to tap, and say when something happens elsewhere on screen.</small></span>
        <span class="settings-state">{{ hints ? 'On' : 'Off' }}</span><input type="checkbox" role="switch" :checked="hints" aria-label="Hints" @change="toggleHints(($event.target as HTMLInputElement).checked)"><i class="ui-switch" aria-hidden="true" /></label>
    </div>
    <h3 class="ui-section">Sound <span class="settings-state">{{ soundSummary(sound) }}</span></h3>
    <div class="ui-rows">
      <label v-for="option in SOUND_SWITCHES" :key="option.id" class="ui-row settings-row"><span class="ui-row-body"><b>{{ option.label }}</b><small>{{ option.hint }}</small></span>
        <span class="settings-state">{{ sound[option.id] ? 'On' : 'Off' }}</span><input type="checkbox" role="switch" :checked="sound[option.id]" :aria-label="option.label" @change="changeSound(option.id, ($event.target as HTMLInputElement).checked)"><i class="ui-switch" aria-hidden="true" /></label>
      <label v-for="option in SOUND_SLIDERS" :key="option.id" class="ui-row settings-slider"><span class="ui-row-body"><b>{{ option.label }}</b><small>{{ option.hint }}</small>
        <input type="range" min="0" max="100" step="5" :value="percent(sound[option.id])" :aria-label="option.label" :disabled="!sound.on" @input="changeSound(option.id, ($event.target as HTMLInputElement).value)" @change="play('tap')"></span>
        <span class="settings-state">{{ percent(sound[option.id]) }}%</span></label>
    </div>
    <p class="settings-note">Saved on this device only. Sounds are made on your phone as you play; nothing is downloaded.</p>
    <p v-if="warning" class="ui-error" role="alert">{{ warning }}</p>

    <CallSettings />

    <section v-if="olderLives.length || switchError" aria-label="Older characters">
      <h3 class="ui-section">Older characters</h3>
      <p class="settings-note">Switch to a character kept from an earlier visit. Your current character is saved here to return to.</p>
      <button v-for="life in olderLives" :key="life.id" type="button" :disabled="switching || Boolean(game.state.value.activeAction)" @click="switchOlderLife(life.id)">Open character in {{ life.city }} · ₦{{ life.cash.toLocaleString() }}</button>
      <p v-if="switchError" role="alert">{{ switchError }}</p>
      <button v-if="switchError" type="button" @click="loadOlderLives">Retry</button>
    </section>
    <h3 class="ui-section">This device</h3>
    <div class="ui-rows">
      <div class="ui-row"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>{{ game.state.value.name }}</b><small><template v-if="view.session">Player code #{{ view.session.id.slice(0, 6) }} · </template>{{ device }}</small></span></div>
    </div>
    <template v-if="!account.state.account">
      <p class="settings-note">You are playing as a guest: your character lives on this device. Clearing cookies, or 30 days without playing, ends it. Sign up for a free account to keep it and play on any device.</p>
      <HowItWorks id="settings-session" page label="How a device session works" :rules="SESSION_RULES" />
    </template>
    <AccountSettings />

    <h3 class="ui-section">Privacy</h3>
    <div class="ui-rows">
      <button type="button" class="ui-row" @click="shell.open('neighbours')"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="neighbours" /></span><span class="ui-row-body"><b>Neighbours directory</b><small>Hide or list your home</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
      <button type="button" class="ui-row" @click="shell.open('richlist')"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="richlist" /></span><span class="ui-row-body"><b>Rich List</b><small>Hide or show your balance</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
      <button type="button" class="ui-row" @click="shell.open('people')"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="people" /></span><span class="ui-row-body"><b>People and blocks</b><small>Blocked players are listed there</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
      <!-- Opens the telemetry sheet (src/telemetry): what is collected and the Accept / Reject choice for this device. -->
      <button type="button" class="ui-row" @click="openPrivacy()"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>Analytics and error reports</b><small>What we collect, and your choice</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
    </div>

    <h3 class="ui-section">Outside the game</h3>
    <div class="ui-rows">
      <button type="button" class="ui-row" @click="shell.open('touch')"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="bell" /></span><span class="ui-row-body"><b>Stay in touch</b><small>Notifications and e-mail: off until you switch them on</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
    </div>
    <LinkButton v-if="growth.channel.value" :href="growth.channel.value" block>Follow Allworld on WhatsApp</LinkButton>
    <p class="settings-note">The game never contacts you unless you ask. News always arrives in Phone → Messages → Updates.</p>
    <div class="ui-rows">
      <button type="button" class="ui-row" @click="shell.open('support')"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="support" /></span><span class="ui-row-body"><b>Report a problem</b><small>File a report and get a receipt</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
    </div>
  </div>
</template>

<style scoped src="../../../ui/panels/settings.css"></style>
