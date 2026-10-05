<script setup lang="ts">
// The Call button on a player's card. It rings the player and nothing else: no microphone opens until they answer.
// The first call on a device shows one line about what a direct connection reveals and waits for a second tap.
// When it cannot be pressed it says why.
import '../../../ui/controls.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { callStore } from './callState.ts'
import { callReason, useCall } from './useCall.ts'

const props = defineProps<{ id: string; name: string; status?: string; blocked?: boolean; self?: boolean; /** A small button for a header, with the reason as its tooltip only. */ compact?: boolean }>()
const { game, shell } = useApp()
const { request, view } = useCall()
const supported = (): boolean => typeof RTCPeerConnection !== 'undefined' && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
const reason = computed(() => {
  void view.value.phase
  return callReason({ status: props.status, blocked: props.blocked, self: props.self }, game.view.value.connected, supported())
})
async function press(): Promise<void> {
  const rang = await request({ id: props.id, name: props.name })
  // The bar floats over the game: put the card away so the player can see it. A first call waits behind its note instead.
  if (rang && callStore.confirm === null) shell.close()
}
</script>

<template>
  <button type="button" class="ui-button" :class="compact ? 'is-small' : 'is-primary is-block'" data-call="start-call" data-tour="call" :disabled="Boolean(reason)" :title="reason ?? undefined" :aria-label="`Call ${name}${reason ? `. ${reason}` : ''}`" @click="press">Call</button>
  <span v-if="reason && !compact" class="social-why">{{ reason }}</span>
</template>
