<script setup lang="ts">
// The chat with the companion: its lines, quick-reply chips and a text box. The companion is always labelled as an AI guide, not a
// person. This component only draws and reports what was pressed; CompanionHost.vue answers.
import { computed, nextTick, ref, watch } from 'vue'
import BaseSheet from '../../ui/BaseSheet.vue'
import CompanionFace from './CompanionFace.vue'
import { COMPANION_NAME, COMPANION_TAG } from './identity.ts'
import { MAIN_CHIPS } from './answers.ts'
import type { LogLine, CompanionMode } from './memory.ts'
import type { CompanionAction } from './types.ts'

const props = defineProps<{ lines: readonly LogLine[]; thinking: boolean; mode: CompanionMode; mood: 'idle' | 'happy' | 'think' | 'sleepy' | 'talk' | 'wave'; tours: readonly { id: string; label: string; done: boolean }[] }>()
const emit = defineEmits<{ close: []; send: [text: string]; action: [action: CompanionAction]; mode: [mode: CompanionMode]; clear: [] }>()
const text = ref('')
const box = ref<HTMLElement | null>(null)
const field = ref<HTMLInputElement | null>(null)
const settings = ref(false)
const lastWithActions = computed(() => { for (let at = props.lines.length - 1; at >= 0; at--) { const line = props.lines[at]; if (line?.from === 'lumo') return line.actions?.length ? at : -1; else return -1 } return -1 })
const chips = computed(() => { const last = props.lines[props.lines.length - 1]; return last?.from === 'lumo' && last.actions?.some((action) => action.kind === 'ask') ? [] : MAIN_CHIPS })
function submit(): void { const value = text.value.trim(); if (!value) return; text.value = ''; emit('send', value) }
watch(() => [props.lines.length, props.thinking], () => { void nextTick(() => { const node = box.value; if (node) node.scrollTop = node.scrollHeight }) }, { flush: 'post', immediate: true })
const MODES: { id: CompanionMode; label: string; note: string }[] = [
  { id: 'lively', label: 'Lively', note: 'Speaks up now and then' },
  { id: 'quiet', label: 'Quiet', note: 'Only when you ask' },
  { id: 'off', label: 'Off', note: 'Hidden. Messages still keeps our chat' },
]
</script>

<template>
  <BaseSheet open :label="`Chat with ${COMPANION_NAME}, the AI guide`" @close="emit('close')">
    <header class="cs-head">
      <CompanionFace :size="46" :mood="thinking ? 'think' : mood" />
      <div><h2>{{ COMPANION_NAME }}</h2><p><span class="cs-tag">{{ COMPANION_TAG }}</span> Not a person. The world’s guide.</p></div>
      <button class="cs-gear" type="button" :aria-expanded="settings" aria-label="Guide settings" @click="settings = !settings">⚙</button>
    </header>
    <section v-if="settings" class="cs-settings" aria-label="Guide settings">
      <p><b>Companion on this device</b></p>
      <div role="radiogroup" aria-label="How often I speak up">
        <button v-for="item in MODES" :key="item.id" type="button" role="radio" :aria-checked="mode === item.id" :class="{ 'is-on': mode === item.id }" @click="emit('mode', item.id)">{{ item.label }}<small>{{ item.note }}</small></button>
      </div>
      <p class="cs-tours"><b>Tours</b></p>
      <div class="cs-tourlist"><button v-for="item in tours" :key="item.id" type="button" @click="emit('action', { kind: 'tour', tour: item.id as 'basics', label: item.label })">{{ item.label }}<small v-if="item.done"> ✓</small></button></div>
      <button class="cs-clear" type="button" @click="emit('clear')">Clear our chat</button>
    </section>
    <div ref="box" class="cs-lines" role="log" aria-live="polite" aria-label="Conversation">
      <p v-if="!lines.length" class="cs-empty">Hi! Ask me anything about Allworld, or tap one of these.</p>
      <div v-for="(line, at) in lines" :key="line.id" class="cs-line" :class="line.from === 'you' ? 'is-you' : 'is-lumo'">
        <p>{{ line.text }}</p>
        <div v-if="line.from === 'lumo' && line.actions?.length && at === lastWithActions" class="cs-actions">
          <button v-for="(action, i) in line.actions" :key="i" type="button" :class="action.kind === 'ask' ? 'is-chip' : 'is-act'" @click="emit('action', action)">{{ action.label }}</button>
        </div>
      </div>
      <div v-if="thinking" class="cs-line is-lumo"><p class="cs-dots" aria-label="Thinking"><i /><i /><i /></p></div>
    </div>
    <div v-if="chips.length" class="cs-chips"><button v-for="chip in chips" :key="chip" type="button" @click="emit('send', chip)">{{ chip }}</button></div>
    <form class="cs-form" @submit.prevent="submit">
      <input ref="field" v-model="text" type="text" maxlength="400" :placeholder="`Ask ${COMPANION_NAME} anything…`" :aria-label="`Message to ${COMPANION_NAME}`" autocomplete="off" enterkeyhint="send" />
      <button type="submit" :disabled="!text.trim()">Send</button>
    </form>
  </BaseSheet>
</template>

<style scoped>
.cs-head { display: flex; align-items: center; gap: 10px; padding: 12px 64px 10px 16px; border-bottom: 1px solid var(--c-line); }
.cs-head h2 { margin: 0; font-size: var(--t-title); line-height: 1.1; }
.cs-head p { margin: 2px 0 0; color: var(--c-muted); font-size: var(--t-small); }
.cs-tag { display: inline-block; padding: 1px 8px; border-radius: var(--r-pill); background: var(--c-green-soft); color: var(--c-green-dark); font-weight: 700; }
.cs-gear { margin-left: auto; position: absolute; right: 58px; top: 9px; width: var(--tap); height: var(--tap); border: 0; border-radius: 50%; background: var(--c-fill); font-size: 18px; cursor: pointer; }
.cs-settings { padding: 10px 16px; background: var(--c-canvas); border-bottom: 1px solid var(--c-line); font-size: var(--t-body); }
.cs-settings p { margin: 0 0 6px; }
.cs-settings [role='radiogroup'], .cs-tourlist { display: flex; flex-wrap: wrap; gap: 6px; }
.cs-settings button { min-height: 40px; padding: 4px 12px; border: 1.5px solid var(--c-line); border-radius: var(--r-sm); background: #fff; font: 700 13px var(--font); text-align: left; cursor: pointer; }
.cs-settings button small { display: block; font-weight: 400; color: var(--c-muted); font-size: var(--t-micro); }
.cs-settings button.is-on { border-color: var(--c-green); background: var(--c-green-soft); }
.cs-tours { margin-top: 10px !important; }
.cs-clear { margin-top: 10px; background: none !important; border: 0 !important; color: var(--c-muted); text-decoration: underline; min-height: 32px !important; }
.cs-lines { flex: 1 1 auto; min-height: 180px; max-height: 52vh; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: #fbfcfb; }
.cs-empty { margin: auto; color: var(--c-muted); text-align: center; }
.cs-line { max-width: 86%; display: grid; gap: 6px; }
.cs-line p { margin: 0; padding: 9px 12px; border-radius: 16px; font-size: 14px; line-height: 1.4; white-space: pre-line; }
.is-lumo { align-self: flex-start; }
.is-lumo p { background: #fff; border: 1px solid var(--c-line); border-bottom-left-radius: 5px; box-shadow: var(--e-1); }
.is-you { align-self: flex-end; }
.is-you p { background: var(--c-green-dark); color: #fff; border-bottom-right-radius: 5px; }
.cs-actions, .cs-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cs-chips { padding: 6px 16px 0; }
.cs-actions button, .cs-chips button { min-height: 38px; padding: 0 14px; border-radius: var(--r-pill); font: 700 13px var(--font); cursor: pointer; }
.cs-actions .is-act { border: 0; background: var(--c-green-dark); color: #fff; }
.cs-actions .is-chip, .cs-chips button { border: 1.5px solid var(--c-line); background: #fff; color: var(--c-ink); }
.cs-form { display: flex; gap: 8px; padding: 10px 16px 14px; }
.cs-form input { flex: 1; min-width: 0; min-height: var(--tap); padding: 0 14px; border: 1.5px solid var(--c-line); border-radius: var(--r-pill); font: 15px var(--font); }
.cs-form input:focus-visible { outline: var(--focus); outline-offset: 1px; }
.cs-form button { min-height: var(--tap); padding: 0 18px; border: 0; border-radius: var(--r-pill); background: var(--c-green-dark); color: #fff; font: 700 14px var(--font); cursor: pointer; }
.cs-form button:disabled { opacity: .45; cursor: default; }
.cs-dots { display: inline-flex; gap: 4px; }
.cs-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--c-muted); animation: cs-dot 1s infinite ease-in-out; }
.cs-dots i:nth-child(2) { animation-delay: .15s } .cs-dots i:nth-child(3) { animation-delay: .3s }
@keyframes cs-dot { 0%, 80%, 100% { opacity: .25; transform: none } 40% { opacity: 1; transform: translateY(-3px) } }
@media (prefers-reduced-motion: reduce) { .cs-dots i { animation: none; opacity: .6 } }
</style>
