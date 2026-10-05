<script setup lang="ts">
// The first call on a device: one plain line about what a direct connection reveals, then Call.
import type { PlayerRef } from '../../../types/protocol.ts'
import { DISCLOSURE } from './callState.ts'
import { cancelConfirm, confirmCall } from './useCall.ts'

defineProps<{ peer: PlayerRef }>()
</script>

<template>
  <section class="call-card" role="dialog" aria-label="Before you call" data-call="confirm">
    <p class="call-title">Call {{ peer.name }}?</p>
    <p class="call-note">{{ DISCLOSURE }}</p>
    <div class="call-actions">
      <button type="button" class="call-btn is-primary" @click="confirmCall">Call</button>
      <button type="button" class="call-btn" @click="cancelConfirm">Not now</button>
    </div>
  </section>
</template>
