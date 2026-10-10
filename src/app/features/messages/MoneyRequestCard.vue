<script setup lang="ts">
// A request for money, drawn in the thread in place of words: who asked, the amount and note, how it stands, and the buttons that
// fit the viewer. Paying asks once more ("Pay ₦500 to Ada?") before anything moves. The card only says what was chosen; the chat
// screen makes the call (one client id per choice) and the card is redrawn from the server's answer.
import { computed, ref, watch } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import { money } from '../../ui/format.ts'
import { cardButtons, cardState, cardTitle, STATE_WORDS } from './moneyRequestModel.ts'
import type { RequestOp } from './moneyRequestModel.ts'
import type { Message } from '../../../types/social.ts'

const props = defineProps<{ item: Message; time: string; now: number; busy?: boolean; offline?: boolean }>()
const emit = defineEmits<{ answer: [id: string, op: RequestOp] }>()
const request = computed(() => props.item.request!)
const name = computed(() => props.item.from?.name ?? 'Someone')
const state = computed(() => cardState(request.value, props.now))
const buttons = computed(() => cardButtons(request.value, props.now))
const confirming = ref(false)
// A card that stops being open (answered here, on another device, or out of time) leaves the confirm step.
watch(state, (next) => { if (next !== 'open') confirming.value = false })
const label = computed(() => `${cardTitle(request.value.mine, name.value)} ${money(request.value.amount)}${request.value.note ? `: ${request.value.note}` : ''}. ${STATE_WORDS[state.value]}.`)
function pick(op: RequestOp): void {
  if (props.busy || props.offline) return
  if (op === 'pay' && !confirming.value) { confirming.value = true; return }
  confirming.value = false
  emit('answer', request.value.id, op)
}
</script>

<template>
  <div class="bubble is-request" role="group" :aria-label="label" :data-request-state="state">
    <span class="request-title">{{ cardTitle(request.mine, name) }}</span>
    <span class="request-row"><GameIcon name="coin" :size="22" /><b>{{ money(request.amount) }}</b><span class="request-state" :class="`is-${state}`">{{ STATE_WORDS[state] }}</span></span>
    <span v-if="request.note" class="request-note">{{ request.note }}</span>
    <span v-if="confirming" class="request-confirm" role="alert">Pay {{ money(request.amount) }} to {{ name }}? The money leaves your cash now and counts as a gift.</span>
    <span v-if="buttons.length" class="request-actions">
      <template v-for="op in buttons" :key="op">
        <button v-if="op === 'pay'" type="button" class="request-btn is-primary" :disabled="busy || offline" @click="pick('pay')">{{ busy ? 'Working…' : confirming ? `Confirm: pay ${money(request.amount)}` : 'Pay' }}</button>
        <button v-else-if="op === 'decline'" type="button" class="request-btn" :disabled="busy || offline" @click="pick('decline')">Decline</button>
        <button v-else type="button" class="request-btn" :disabled="busy || offline" @click="pick('cancel')">{{ busy ? 'Working…' : 'Cancel request' }}</button>
      </template>
      <button v-if="confirming" type="button" class="request-btn" :disabled="busy" @click="confirming = false">Back</button>
    </span>
    <small>{{ time }}</small>
  </div>
</template>

<style scoped>
.bubble.is-request { display: grid; gap: 4px; min-width: 190px; max-width: 100%; box-sizing: border-box; padding: 10px 14px 6px; border: 1.5px solid #9ec5ee; border-radius: 18px; background: #eef6ff; color: var(--c-ink); font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; white-space: normal; }
.request-title { font-size: 12px; color: var(--c-ink-2); }
.request-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 15px; }
.request-state { margin-left: auto; padding: 1px 8px; border-radius: 10px; background: var(--c-fill-2); font-size: 12px; font-weight: 650; }
.request-state.is-open { background: #dcecff; }
.request-state.is-paid { background: #d9f2e3; }
.request-note { font-size: 13px; color: var(--c-ink-2); }
.request-confirm { font-size: 12px; color: var(--c-ink-2); }
.request-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.request-btn { flex: 1 1 96px; min-height: 44px; padding: 0 12px; border: 1px solid var(--c-line); border-radius: 12px; background: #fff; color: var(--c-ink); font: 650 14px var(--font); cursor: pointer; touch-action: manipulation; }
.request-btn.is-primary { border-color: #176347; background: #176347; color: #fff; }
.request-btn:disabled { opacity: .55; cursor: default; }
.request-btn:focus-visible { outline: var(--focus); outline-offset: 2px; }
.bubble.is-request small { margin-top: 2px; font-size: 10px; color: var(--c-muted); text-align: right; }
</style>
