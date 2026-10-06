<script setup lang="ts">
// The message box: grows to four lines, keeps a draft per conversation on this device, offers an @ picker in groups, an emoji
// picker, :shortcodes:, and the quoted message being answered.
import { computed, nextTick, ref, watch } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import EmojiPicker from './EmojiPicker.vue'
import { composerLines, createDrafts, insertMention, liveMentions, mentionChoices, mentionQuery, shortcodes } from './messagesText.ts'
import type { Picked } from './messagesText.ts'
import type { Message } from '../../../types/social.ts'
import type { PlayerRef } from '../../../types/protocol.ts'

const props = defineProps<{
  conv: string
  /** Group members, for the @ picker; empty in a direct chat (an @ means nothing there). */
  members: readonly PlayerRef[]
  meId: string
  admin: boolean
  max: number
  disabled: boolean
  reply: Message | null
  /** Text another screen has ready for the next conversation opened. */
  prefill: string
}>()
const emit = defineEmits<{ send: [body: string, extra: { mentions?: { id: string; start: number }[]; replyTo?: number }]; cancelReply: [] }>()

const drafts = createDrafts((() => { try { return globalThis.localStorage ?? null } catch { return null } })())
const text = ref('')
const caret = ref(0)
const field = ref<HTMLTextAreaElement | null>(null)
const picked = ref<Picked[]>([])
const emoji = ref(false)
const active = ref(0)

watch(() => props.conv, () => { text.value = props.prefill || drafts.get(props.conv); picked.value = []; emoji.value = false; void nextTick(grow) }, { immediate: true })
watch(text, (value) => drafts.set(props.conv, value))

const query = computed(() => (props.members.length ? mentionQuery(text.value, caret.value) : null))
const choices = computed(() => (query.value ? mentionChoices(props.members, props.meId, query.value.query, props.admin).slice(0, 8) : []))
watch(choices, () => { active.value = 0 })

function grow(): void {
  const box = field.value
  if (!box) return
  box.style.height = 'auto'
  box.style.height = `${Math.min(box.scrollHeight, 4 * 22 + 20)}px`
}
function onInput(): void {
  const box = field.value
  if (box) {
    caret.value = box.selectionStart
    const swapped = shortcodes(text.value)
    if (swapped !== text.value) { text.value = swapped; void nextTick(() => { box.setSelectionRange(swapped.length, swapped.length); caret.value = swapped.length }) }
  }
  void nextTick(grow)
}
const track = (): void => { caret.value = field.value?.selectionStart ?? text.value.length }
function choose(index: number): void {
  const choice = choices.value[index], found = query.value
  if (!choice || !found) return
  const done = insertMention(text.value, caret.value, found.start, choice)
  picked.value = [...picked.value.filter((item) => item.id !== choice.id), { id: choice.id, name: choice.name }]
  text.value = done.text
  void nextTick(() => { field.value?.focus(); field.value?.setSelectionRange(done.caret, done.caret); caret.value = done.caret; grow() })
}
function insertEmoji(char: string): void {
  const box = field.value, at = box?.selectionStart ?? text.value.length
  text.value = text.value.slice(0, at) + char + text.value.slice((box?.selectionEnd ?? at))
  void nextTick(() => { box?.focus(); box?.setSelectionRange(at + char.length, at + char.length); caret.value = at + char.length; grow() })
}
function submit(): void {
  const body = text.value.trim()
  if (!body || props.disabled) return
  // Only the mentions still written in the text go along; the server checks each against the group.
  const mentions = props.members.length ? liveMentions(text.value.trimStart(), picked.value) : []
  emit('send', body, { ...(mentions.length ? { mentions } : {}), ...(props.reply ? { replyTo: props.reply.seq } : {}) })
  text.value = ''; picked.value = []; emoji.value = false
  void nextTick(() => { grow(); field.value?.focus() })
}
function onKey(event: KeyboardEvent): void {
  if (choices.value.length) {
    if (event.key === 'ArrowDown') { event.preventDefault(); active.value = (active.value + 1) % choices.value.length; return }
    if (event.key === 'ArrowUp') { event.preventDefault(); active.value = (active.value + choices.value.length - 1) % choices.value.length; return }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(active.value); return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); caret.value = -1; return }
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit() }
}
defineExpose({ focus: () => field.value?.focus(), setText(value: string) { text.value = value; void nextTick(grow) } })
const lines = computed(() => composerLines(text.value))
</script>

<template>
  <div class="composer">
    <div v-if="reply" class="composer-reply">
      <span><b>{{ reply.from?.name ?? 'Message' }}</b> {{ reply.body || (reply.image ? 'Picture' : '') }}</span>
      <button type="button" aria-label="Cancel reply" @click="emit('cancelReply')">✕</button>
    </div>
    <ul v-if="choices.length" class="composer-picker" role="listbox" aria-label="Mention someone">
      <li v-for="(choice, index) in choices" :key="choice.id" role="option" :aria-selected="index === active" :class="{ 'is-on': index === active }" @pointerdown.prevent="choose(index)">
        <b>@{{ choice.name }}</b><small v-if="choice.id === 'everyone'">notify the whole group</small>
      </li>
    </ul>
    <EmojiPicker v-if="emoji" class="composer-emoji" @pick="insertEmoji" />
    <form class="composer-form" @submit.prevent="submit">
      <button type="button" class="composer-side" :aria-pressed="emoji" aria-label="Emoji" :disabled="disabled" @click="emoji = !emoji">☺</button>
      <textarea ref="field" v-model="text" name="body" :rows="lines" :maxlength="max * 2" autocomplete="off" enterkeyhint="send" placeholder="Message" aria-label="Message" :disabled="disabled" @input="onInput" @keydown="onKey" @keyup="track" @click="track" @focus="emoji = false" />
      <button type="submit" class="composer-send" aria-label="Send" title="Send" :disabled="disabled || !text.trim()"><GameIcon name="earn" :size="22" /></button>
    </form>
  </div>
</template>

<style scoped>
.composer { position: relative; display: grid; gap: 6px; }
.composer-form { display: flex; align-items: flex-end; gap: 8px; margin: 0; }
/* The id selectors beat the panel-wide textarea rule (controls.css), which makes every textarea 96px tall. */
.composer-form textarea, #life-dialog .composer-form textarea, .life-ui .composer-form textarea { flex: 1; width: auto; min-width: 0; box-sizing: border-box; min-height: var(--tap); max-height: 108px; resize: none; padding: 11px 16px; border: 1px solid transparent; border-radius: 22px; background: var(--c-fill); font: 400 15px/22px var(--font); overflow-y: auto; }
.composer-send, .composer-side { flex: none; display: grid; place-items: center; width: var(--tap); height: var(--tap); border: 0; border-radius: 50%; cursor: pointer; }
.composer-send { background: var(--app-tint, var(--c-green-dark)); color: #fff; }
.composer-side { background: var(--c-fill); font-size: 22px; }
.composer-side[aria-pressed='true'] { background: var(--c-fill-2); }
.composer-send:disabled, .composer-side:disabled { opacity: .45; cursor: not-allowed; }
.composer-reply { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-left: 3px solid var(--app-tint, var(--c-green-dark)); border-radius: 8px; background: var(--c-fill); font-size: 12px; color: var(--c-ink-2); }
.composer-reply span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-reply button { flex: none; min-width: 32px; min-height: 32px; border: 0; background: none; cursor: pointer; }
.composer-picker { position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 3; display: grid; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1); max-height: 220px; overflow-y: auto; }
.composer-picker li { display: flex; align-items: baseline; gap: 8px; min-height: 40px; padding: 8px 10px; border-radius: 10px; font-size: 14px; cursor: pointer; }
.composer-picker li.is-on { background: var(--c-fill-2); }
.composer-picker small { color: var(--c-muted); font-size: 11px; }
.composer-emoji { position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 3; }
</style>
