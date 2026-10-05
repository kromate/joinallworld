<script setup lang="ts">
// Ping: "I am here, come and join me" — where Call is for a friend who is in the game. One tap, no form. It says why
// when it cannot be pressed, and never anything about how (or whether) the friend can be reached outside the game.
// `compact` is the small button of a chat's header, with the reason as its tooltip only.
import '../../../ui/controls.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { PING_HINT, pingButton } from './pingModel.ts'
import { loadControl, pingState, sendPing } from './pingStore.ts'

const props = defineProps<{ id: string; name: string; /** Not a friend of the reader: the button says what is missing. */ stranger?: boolean; blocked?: boolean; self?: boolean; compact?: boolean }>()
const { game } = useApp()
const clock = ref(0)
let tick: ReturnType<typeof setInterval> | null = null
// "You can ping again in 12 minutes" counts down without a request.
onMounted(() => { tick = setInterval(() => { clock.value += 1 }, 20000) })
onBeforeUnmount(() => { if (tick !== null) clearInterval(tick) })
watch([() => props.id, () => game.view.value.connected, () => props.stranger], ([id, connected, stranger]) => { if (connected && !stranger && !props.self) void loadControl(id, props.name) }, { immediate: true })

const view = computed(() => {
  void clock.value
  return pingButton({ connected: game.view.value.connected, self: props.self === true, friend: !props.stranger, blocked: props.blocked === true, name: props.name,
    control: pingState.controls.get(props.id) ?? null, busy: pingState.busy.has(props.id), now: game.view.value.now, compact: props.compact })
})
async function press(): Promise<void> {
  const done = await sendPing(props.id, props.name)
  if (done.words) game.toast(done.words, done.ok ? 'good' : 'error')
}
</script>

<template>
  <button type="button" class="ui-button" :class="compact ? 'is-small' : 'is-primary is-block'" data-ping="send" :disabled="view.disabled" :title="view.reason ?? (compact ? PING_HINT : undefined)" :aria-label="`Ping ${name}. ${view.reason ?? PING_HINT}`" @click="press"><GameIcon v-if="!compact" name="bell" inline /> {{ view.label }}</button>
  <span v-if="!compact" class="ping-hint" :class="{ 'is-why': view.reason && !view.waiting }" data-ping="hint">{{ view.reason ?? PING_HINT }}</span>
</template>

<style scoped>
/* Under the card's Chat button, where Call stands for a friend who is in the game. */
.ui-button.is-block { margin-top: 8px; }
.ping-hint { display: block; margin: 4px 2px 0; font-size: 12px; line-height: 1.4; color: var(--c-muted); }
.ping-hint.is-why { color: var(--c-red); }
</style>
