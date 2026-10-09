<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { Message, MessagePinsView } from '../../../types/social.ts'

const props = defineProps<{ pins: MessagePinsView; kind: 'dm' | 'group' | 'house'; loading: boolean; pending: boolean; retryable: boolean; disabled: boolean; error: string }>()
const emit = defineEmits<{ open: [message: Message | null]; clear: []; retry: []; dismiss: [] }>()
const expanded = ref(true), confirming = ref(false), clearButton = ref<HTMLButtonElement | null>(null)
const label = (message: Message): string => message.body.trim() || (message.image ? 'Picture' : message.voice ? 'Voice message' : 'Message')
const manager = (): string => props.kind === 'group' ? 'Only the group owner can change them.' : props.kind === 'house' ? 'Only the host can change them.' : 'Either person can change them.'
function cancelClear(): void { confirming.value = false; void nextTick(() => clearButton.value?.focus()) }
function confirmClear(): void { emit('clear'); confirming.value = false; void nextTick(() => clearButton.value?.focus()) }
watch(() => props.pins.scope, () => { expanded.value = true; confirming.value = false; emit('open', null) }, { flush: 'sync' })
</script>

<template>
  <section v-if="pins.items.length || pins.canManage" class="pinned" aria-labelledby="pinned-title" @keydown.esc="cancelClear">
    <header>
      <button type="button" class="pinned-toggle" :aria-expanded="expanded" aria-controls="pinned-list" @click="expanded = !expanded">
        <strong id="pinned-title">Pinned messages</strong><span aria-hidden="true">{{ expanded ? '−' : '+' }}</span>
      </button>
      <button v-if="pins.canManage" ref="clearButton" type="button" class="pinned-clear" :disabled="pending || retryable || disabled" :aria-expanded="confirming" @click="confirming = !confirming">Clear all</button>
    </header>
    <div v-if="expanded" id="pinned-list">
      <p v-if="!pins.items.length" class="pinned-empty">No shared pins you can see.</p>
      <button v-for="entry in pins.items.slice(0, 3)" :key="entry.message.seq" type="button" class="pinned-row" @click="emit('open', entry.message)">
        <span>{{ entry.message.from?.name ?? 'Message' }}</span><b>{{ label(entry.message) }}</b>
      </button>
      <p class="pinned-help">Shared with everyone in this chat. {{ manager() }}<template v-if="pins.canManage"> Clear all also removes shared pins you cannot see.</template> Unpinned older messages may leave the kept history.</p>
    </div>
    <div v-if="confirming" class="pinned-confirm" role="alertdialog" aria-modal="false" aria-label="Clear all shared pins">
      <p>Clear all shared pins, including any you cannot see?</p>
      <button type="button" :disabled="pending || disabled" @click="confirmClear">{{ pending ? 'Clearing…' : 'Clear shared pins' }}</button>
      <button type="button" :disabled="pending" @click="cancelClear">Cancel</button>
    </div>
    <p v-if="loading" class="pinned-status" role="status">Refreshing pinned messages…</p>
    <p v-else-if="error" class="pinned-error" role="alert">{{ error }}</p>
    <div v-if="retryable" class="pinned-retry">
      <button type="button" :disabled="pending || disabled" @click="emit('retry')">Retry same change</button>
      <button type="button" :disabled="pending" @click="emit('dismiss')">Dismiss</button>
    </div>
  </section>
</template>

<style scoped>
.pinned { flex: none; margin: 6px 10px 0; border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; font-size: 12px; }
.pinned header { display: flex; align-items: center; min-height: 44px; }
.pinned-toggle, .pinned-clear, .pinned-row, .pinned-confirm button, .pinned-retry button { min-height: 44px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; touch-action: manipulation; }
.pinned-toggle { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 12px; text-align: left; }
.pinned-clear { padding: 0 12px; color: var(--c-red); font-weight: 650; }
.pinned-row { display: grid; grid-template-columns: minmax(72px, 28%) minmax(0, 1fr); gap: 8px; width: 100%; padding: 0 12px; border-top: 1px solid var(--c-line); text-align: left; }
.pinned-row span, .pinned-row b { align-self: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pinned-row span { color: var(--c-muted); }
.pinned-row b { font-weight: 600; }
.pinned-help, .pinned-empty, .pinned-status, .pinned-error, .pinned-confirm p { margin: 0; padding: 8px 12px; line-height: 1.4; }
.pinned-help, .pinned-empty, .pinned-status { color: var(--c-muted); }
.pinned-error { color: var(--c-red); }
.pinned-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; padding: 0 6px 6px; border-top: 1px solid var(--c-line); }
.pinned-confirm p { flex: 1 0 100%; }
.pinned-confirm button:first-of-type { color: var(--c-red); font-weight: 650; }
.pinned-retry { display: flex; gap: 4px; padding: 0 6px 6px; }
.pinned-retry button:first-child { color: var(--c-green-dark); font-weight: 650; }
.pinned-toggle:hover, .pinned-clear:hover, .pinned-row:hover, .pinned-confirm button:hover, .pinned-retry button:hover { background: var(--c-fill-2); }
button:focus-visible { outline: var(--focus); outline-offset: -2px; }
</style>
