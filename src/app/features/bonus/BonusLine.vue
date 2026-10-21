<script setup lang="ts">
// The launch offer in one honest line, on the landing screen and the sign-up sheet. Fetched with the screen it sits on, never with the first download.
import { computed, onMounted } from 'vue'
import { useApp } from '../../state/app.ts'
import { offerLine } from './bonusModel.ts'
import { bonus, loadOffer } from './bonusStore.ts'
import { isPlayApp } from '../../playMode.ts'

const { game } = useApp()
const playApp = isPlayApp()
const line = computed(() => {
  const words = offerLine(bonus.offer)
  return playApp ? words?.replace(' in the game.', ' of in-game naira.') ?? null : words
})
onMounted(() => { void loadOffer(game.fetchJson) })
</script>

<template>
  <p v-if="line" class="bonus-line" data-bonus-line>{{ line }}</p>
</template>

<style scoped>
.bonus-line { margin: 0; padding: 8px 12px; border-radius: 12px; background: var(--c-green-soft, #e8f5ec); color: var(--c-green-dark, #1d6b43); font-size: 13px; line-height: 1.4; font-weight: 600; overflow-wrap: anywhere; }
</style>
