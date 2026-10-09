<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { HomewardQuote } from '../../../game/cities/homewardRoute.ts'
import { cityName } from '../../../game/cities/registry.ts'
import { useApp } from '../../state/app.ts'
import { money } from '../../ui/format.ts'

const props = defineProps<{ quote: HomewardQuote }>()
const emit = defineEmits<{ done: [] }>()
const { game, command } = useApp()
const confirmed = ref<string | null>(null)
const sending = ref(false)
const owner = computed(() => game.session.value?.id ?? '')
const held = computed(() => game.pendingAction.value)
const retry = computed(() => held.value?.sessionId === owner.value && held.value.type === 'homeward.accept')
const disabled = computed(() => sending.value || !game.connected.value || Boolean(held.value && !retry.value))
const modeName = { air: 'Flight', road: 'Road', rail: 'Train' }
watch(() => `${owner.value}|${props.quote.key}`, () => { confirmed.value = null }, { flush: 'sync' })

async function accept(): Promise<void> {
  if (disabled.value) return
  if (!retry.value && confirmed.value !== props.quote.key) { confirmed.value = props.quote.key; return }
  const scope = owner.value
  const key = props.quote.key
  sending.value = true
  try {
    const result = retry.value ? await game.retryPendingAction() : await command('homeward.accept', { quote: key })
    if (owner.value !== scope) return
    confirmed.value = null
    if (result.ok) emit('done')
  } finally { sending.value = false }
}
</script>

<template>
  <section class="homeward-offer" aria-label="Ride home on credit" data-homeward-offer>
    <ol v-if="!retry" aria-label="Connections to your original home">
      <li v-for="(leg, index) in quote.legs" :key="index">
        <strong>{{ cityName(leg.from) ?? leg.from }} → {{ cityName(leg.to) ?? leg.to }}</strong>
        <small>{{ modeName[leg.mode] }} · {{ money(leg.fare) }} · {{ leg.seconds }} seconds</small>
      </li>
    </ol>
    <p v-if="!retry">{{ money(quote.totalFare) }} borrowed for the whole ticket. Half of each earning repays it. Your original home stays yours.</p>
    <p v-if="!retry">No cancelling, skipping or stopping between connections. About {{ quote.totalSeconds }} seconds in total.</p>
    <p v-if="retry" role="status">Your earlier booking reply is unconfirmed. This may already be booked. The original terms are not displayed here. This button checks only the same saved request before you review a new offer.</p>
    <p v-else-if="held" role="status">Resolve your previous action before booking this ticket.</p>
    <p v-else-if="!game.connected.value" role="status">Reconnect to review and accept the current ticket.</p>
    <button type="button" class="ui-button is-block" data-visitor="credit" :disabled="disabled" @click="accept">
      <span>{{ sending ? 'Checking booking…' : retry ? 'Check the same booking' : confirmed === quote.key ? `Yes, borrow ${money(quote.totalFare)} and ride home` : `Ride home on credit · ${money(quote.totalFare)} owed` }}</span>
    </button>
  </section>
</template>

<style scoped>
.homeward-offer{display:grid;gap:8px;min-width:0}
.homeward-offer ol{display:grid;gap:8px;margin:0;padding-left:24px}
.homeward-offer li{padding-left:2px;overflow-wrap:anywhere}
.homeward-offer strong,.homeward-offer small{display:block}
.homeward-offer small{color:var(--c-muted);line-height:1.5}
.homeward-offer p{margin:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.homeward-offer button{min-height:44px;white-space:normal;text-align:left}
</style>
