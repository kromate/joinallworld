<script setup lang="ts">
// Skip the trip: pay game money and arrive now ('travel.skip'). Shown wherever a trip's progress is (the progress chip,
// the Map's trip bar) while the server offers it. The price is the server's and falls as the trip goes on; the price on
// the button when it is pressed is sent along, so what is charged is what was shown. A large price asks once more first.
import { computed, nextTick, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { money } from '../../ui/format.ts'
import { skipButton } from './skipModel.ts'

const { game, command } = useApp()
const offer = computed(() => game.view.value.travel.skip)
const pending = ref(false)
const asking = ref(false)
const pay = ref<HTMLButtonElement | null>(null)
const button = computed(() => skipButton(offer.value, { known: game.state.value.travel.skipped === true, pending: pending.value, connected: game.connected.value }))
// The trip ended, or the price fell below the amount that is asked about: the question goes away with it.
watch(() => button.value?.confirm === true && !button.value.disabled, (can) => { if (!can) asking.value = false })

async function skip(): Promise<void> {
  const now = button.value
  if (!now || now.disabled || pending.value) return
  pending.value = true
  asking.value = false
  try { await command('travel.skip', { quote: now.fee }) } finally { pending.value = false }
}
async function press(): Promise<void> {
  const now = button.value
  if (!now || now.disabled) return
  if (!now.confirm) { await skip(); return }
  asking.value = true
  await nextTick()
  pay.value?.focus()
}
</script>

<template>
  <div v-if="button" class="trip-skip">
    <div v-if="asking" class="ui-confirm" role="group" aria-label="Confirm skipping the trip" @keydown.esc.stop="asking = false">
      <p>Pay {{ money(button.fee) }} to arrive now? The rest of the journey is skipped.</p>
      <div>
        <button ref="pay" type="button" class="ui-button is-primary" :disabled="button.disabled" @click="skip">Pay {{ money(button.fee) }}</button>
        <button type="button" class="ui-button" @click="asking = false">Keep waiting</button>
      </div>
    </div>
    <button v-else type="button" class="ui-button is-primary trip-skip-go" :disabled="button.disabled" :aria-label="button.aria" @click="press">{{ button.label }}</button>
    <p v-if="button.note && !asking" class="trip-skip-note" role="status">{{ button.note }}</p>
  </div>
</template>
