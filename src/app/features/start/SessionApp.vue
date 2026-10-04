<script setup lang="ts">
// Device-session entry: the nickname prompt for a new device, and what to do when the server no
// longer knows this browser's session. (A new device normally lands on QuickStartApp.vue; this is
// the session gate when no landing screen is registered, and the sheet of an expired session.)
//
// A nickname identifies a browser, not a person. When the server refuses the nickname (not
// allowed, malformed, or the player is muted) the form comes back with its reason.
//
// `reason: 'expired'` is the case where the server is reachable but answers 401 to a browser that
// still holds a cached life: the server's data was reset (a local server restarted with an empty
// data folder) or the session ran out. This is NOT "offline" and the panel never says so: it says
// what happened and puts "Start a new life" one tap away, with "Try again" beside it.
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { problemOf } from './quickStartModel.ts'
import { LEGACY_CHARACTER_URL, nicknameOf } from './sessionModel.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const view = game.view
const expired = computed(() => (props.params && typeof props.params === 'object' ? (props.params as { reason?: unknown }).reason : null) === 'expired')
const problem = computed(() => problemOf(props.params))
const kept = computed(() => (view.value.name && view.value.name !== 'New Lagosian' ? view.value.name : ''))
const nickname = ref(problem.value?.name ?? kept.value)

function start(name: string | null): void {
  shell.close()
  window.dispatchEvent(new CustomEvent('jaw:start-life', { detail: { name } }))
}
function submit(): void { start(nicknameOf(nickname.value)) }
// "Try again" asks the server once more; if it still does not know this session, this sheet comes back.
function retry(): void {
  shell.close()
  window.dispatchEvent(new CustomEvent('jaw:reconnect'))
}
</script>

<template>
  <template v-if="expired">
    <div class="session-card is-warn">
      <h3>This device’s saved life is no longer on this server</h3>
      <p>The server is running, but it has no record of the life this browser remembers. That happens when the server’s data was reset, or when a session is not used for 30 days.</p>
      <p>What you see behind this sheet is the copy kept on this device: you can look, but nothing can change.</p>
    </div>
    <div class="session-actions"><button class="ui-button is-primary is-block" data-session-new @click="start(null)">Start a new life</button><button class="ui-button is-block" data-session-retry @click="retry">Try again</button></div>
    <p class="session-note">Starting a new life keeps your nickname<template v-if="kept"> ({{ kept }})</template> and begins with a quick character and a fresh start in the city. The old life cannot be brought back from this device.</p>
    <p class="session-legacy"><a class="legacy-character-link" :href="LEGACY_CHARACTER_URL">Open your original Allworld character</a><span>Your original world and this city life have separate saves.</span></p>
  </template>
  <template v-else>
    <div class="session-card"><h3>Start your city life</h3><p>Choose a nickname for this device. There is no password and no e-mail: a cookie in this browser is the key to your life.</p></div>
    <p v-if="problem?.reason" class="ui-error" role="alert">{{ problem.reason }}</p>
    <form class="session-form" data-session-form @submit.prevent="submit"><label>Your nickname <input v-model="nickname" name="name" minlength="3" maxlength="24" required autocomplete="nickname"></label><button class="ui-button is-primary is-block">Start life</button></form>
    <p class="session-legacy"><a class="legacy-character-link" :href="LEGACY_CHARACTER_URL">Open your original Allworld character</a><span>Your original world and this city life have separate saves.</span></p>
  </template>
</template>

<style scoped>
.legacy-character-link { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.legacy-character-link:focus-visible { outline: 3px solid var(--c-green-dark); outline-offset: 3px; }
.session-legacy { display: grid; gap: 2px; margin: 12px 0 0; font-size: var(--t-small); color: var(--c-muted); }
</style>
