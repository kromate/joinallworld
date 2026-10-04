<script setup lang="ts">
// The coach line above the venue panel: for the first starter goals it names the next control, and the
// attention system (useAttention.ts) rings that control — or, for the situational pointers (Go on the
// map, the trip card, a roadside prompt), shows a small bubble when it is far from where the player
// last clicked. It stops by itself after the first goals and can be switched off for good on this device.
import { watch } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import { useApp } from '../../state/app.ts'
import { useAttention } from './useAttention.ts'

const { shell } = useApp()
const { coach, dismiss } = useAttention()
// One line of guidance at a time: while the coach is talking, a phone's HUD drops the goal chip that says the same thing.
watch(coach, (now) => { shell.ui.coaching = Boolean(now) }, { immediate: true })
</script>

<template>
  <div v-if="coach" class="life-coach" role="note">
    <span aria-hidden="true"><GameIcon inline name="pointer" /></span>
    <p><b>{{ coach.title }}</b>{{ coach.text }}</p>
    <button type="button" aria-label="Hide these tips" @click="dismiss"><GameIcon name="close" /></button>
  </div>
</template>
