<script setup lang="ts">
// Phone -> Settings: who may ring you. Friends only by default; the choice is kept on the server with the player.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CallsFrom } from '../../../types/calls.ts'
import { callStore } from './callState.ts'
import { requestCallSetting } from './callsLoader.ts'

const CHOICES: { id: CallsFrom; label: string; hint: string }[] = [
  { id: 'everyone', label: 'Everyone', hint: 'Anyone who is not blocked can ring you.' },
  { id: 'friends', label: 'Friends only', hint: 'Only your friends can ring you. This is the default.' },
  { id: 'nobody', label: 'Nobody', hint: 'Nobody can ring you. You can still call people yourself.' },
]
let retry: ReturnType<typeof setTimeout> | null = null
onMounted(() => { if (!requestCallSetting()) retry = setTimeout(() => { requestCallSetting() }, 2500) })
onBeforeUnmount(() => { if (retry !== null) clearTimeout(retry) })
const warning = ref('')
const choose = (id: CallsFrom): void => { warning.value = requestCallSetting(id) ? '' : 'Not connected. Your choice was not saved.' }
</script>

<template>
  <h3 class="ui-section">Calls</h3>
  <div class="ui-rows" role="radiogroup" aria-label="Calls from">
    <label v-for="choice in CHOICES" :key="choice.id" class="ui-row settings-row"><span class="ui-row-body"><b>{{ choice.label }}</b><small>{{ choice.hint }}</small></span>
      <input type="radio" name="calls-from" :value="choice.id" :checked="(callStore.accepting ?? 'friends') === choice.id" :aria-label="`Calls from: ${choice.label}`" @change="choose(choice.id)"></label>
  </div>
  <p v-if="warning" class="ui-error" role="alert">{{ warning }}</p>
  <p class="settings-note">Calls from: who can ring you. Someone you block, or who is muted by a moderator, can never ring you.</p>
</template>
