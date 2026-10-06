<script setup lang="ts">
// The actions of the "What you can do now" card, one tap each. Used by the card in the HUD and by the sheet opened from the wallet.
import { ref } from 'vue'
import type { ReliefAction, ReliefHelp } from '../../../types/view.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { useAct } from '../kit/act.ts'
import { ui as messages } from '../messages/messagesState.ts'
import { actionVerb, askFriendText, orderedActions, shortReason } from './reliefModel.ts'

const props = defineProps<{ help: ReliefHelp }>()
const emit = defineEmits<{ done: [] }>()
const { game, shell, goTo, command } = useApp()
const { act, pending } = useAct()
/** The ride on credit asks once more: it is a debt. */
const confirming = ref(false)

const glyph = (action: ReliefAction): string => (action.id === 'odd-job' ? 'jobs' : action.id === 'bench' ? 'bed' : action.id === 'tap' ? 'drink' : action.id === 'credit-ride' ? 'bus' : action.id === 'clinic' ? 'health' : action.id === 'friend' ? 'social' : 'coin')

async function run(action: ReliefAction): Promise<void> {
  if (action.blocked) return
  if (action.id === 'credit-ride' && action.to && action.mode) {
    if (!confirming.value) { confirming.value = true; return }
    confirming.value = false
    const to = action.to, mode = action.mode
    if (await act('credit-ride', () => command('estate.relocate', { to, mode, credit: true }))) emit('done')
    return
  }
  if (action.activity && action.venue) {
    const activity = action.activity
    if (!action.here) { await goTo(action.venue, action.spot ?? undefined); emit('done'); return }
    if (game.state.value.spot !== action.spot && action.spot) await command('spot', { id: action.spot })
    if (await act(action.id, () => command('activity', { id: activity }))) emit('done')
    return
  }
  if (action.id === 'friend') {
    const view = game.view.value.estate
    messages.prefill = askFriendText(view.cityName, game.state.value.cash, view.home && !view.home.here ? view.home.name : null)
    shell.open('messages'); emit('done'); return
  }
  if (action.id === 'cash-box') { shell.open('business'); emit('done') }
}
</script>

<template>
  <ul class="relief-actions">
    <li v-for="action in orderedActions(props.help.actions)" :key="action.id" :data-relief="action.id" :class="{ 'is-off': Boolean(action.blocked) }">
      <span class="relief-mark" aria-hidden="true"><GameIcon :name="glyph(action)" :size="20" /></span>
      <span class="relief-text">
        <b>{{ action.label }}</b>
        <small v-if="action.id === 'credit-ride' && confirming">You will owe this. Tap again to ride.</small>
        <small v-else>{{ action.blocked ? shortReason(action.blocked) : action.detail }}</small>
      </span>
      <span v-if="action.blocked" class="relief-off">Not now</span>
      <button v-else type="button" class="relief-go" :disabled="pending !== null" @click="run(action)">{{ action.id === 'credit-ride' && confirming ? 'Yes, ride' : actionVerb(action) }}</button>
    </li>
  </ul>
</template>
