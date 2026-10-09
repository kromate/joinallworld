<script setup lang="ts">
import VoiceComposer from './VoiceComposer.vue'
// The message box: grows to four lines, keeps a draft per conversation on this device, offers an @ picker in groups, an emoji
// picker, :shortcodes:, and the quoted message being answered.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import EmojiPicker from './EmojiPicker.vue'
import { composerLines, createDrafts, insertMention, liveMentions, messageLength, mentionChoices, mentionQuery, shortcodes } from './messagesText.ts'
import type { Picked } from './messagesText.ts'
import type { Message, SendMessageResult } from '../../../types/social.ts'
import { preparePicture, uploadBody } from './pictureModel.ts'
import type { Ready } from './pictureModel.ts'
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
  /** Pictures may be sent here (switched on, and a chat that takes them): the picture button shows. */
  pictures: boolean
  voice?: boolean
  /** Who a picture goes to. */
  target: { to: string } | { conv: string }
  newId: () => string
}>()
const emit = defineEmits<{ send: [body: string, extra: { mentions?: { id: string; start: number }[]; replyTo?: number }]; cancelReply: []; sentVoice: [result: { conv: { id: string } }]; sentPicture: [result: Extract<SendMessageResult, { ok: true }>] }>()

const storage = (() => { try { return globalThis.localStorage ?? null } catch { return null } })()
const actorDrafts = new Map<string, ReturnType<typeof createDrafts>>()
function draftsFor(actor: string): ReturnType<typeof createDrafts> {
  let found = actorDrafts.get(actor)
  if (!found) { found = createDrafts(storage, actor); actorDrafts.set(actor, found) }
  return found
}
let draftActor = props.meId, draftConversation = props.conv, drafts = draftsFor(draftActor)
const text = ref('')
const caret = ref(0)
const field = ref<HTMLTextAreaElement | null>(null)
const picked = ref<Picked[]>([])
const emoji = ref(false)
const active = ref(0)
const count = computed(() => messageLength(text.value))
const tooLong = computed(() => count.value > props.max)
const limitId = computed(() => `message-limit-${props.conv}`)
// ---- a picture: choose, see it, send it (with progress), try again
const fileInput = ref<HTMLInputElement | null>(null)
const photo = ref<{ ready: Ready; caption: string; clientId: string; busy: boolean; progress: number; error: string | null } | null>(null)
let photoGeneration = 0, uploading: XMLHttpRequest | null = null
function photoScope() {
  const generation = photoGeneration, actor = props.meId, conv = props.conv
  return { actor, current: () => generation === photoGeneration && actor === props.meId && conv === props.conv }
}
async function chosen(): Promise<void> {
  const file = fileInput.value?.files?.[0]
  if (fileInput.value) fileInput.value.value = ''
  if (!file || props.disabled) return
  dismissPhoto()
  const scope = photoScope()
  const made = await preparePicture(file)
  if (!scope.current()) { if (made.ok) URL.revokeObjectURL(made.ready.url); return }
  photo.value = made.ok ? { ready: made.ready, caption: '', clientId: props.newId(), busy: false, progress: 0, error: null } : { ready: { blob: file, type: 'image/jpeg', width: 1, height: 1, url: '' }, caption: '', clientId: '', busy: false, progress: 0, error: made.reason }
}
function dismissPhoto(): void {
  photoGeneration++
  uploading?.abort(); uploading = null
  if (photo.value?.ready.url) URL.revokeObjectURL(photo.value.ready.url)
  photo.value = null
}
onBeforeUnmount(dismissPhoto)
async function sendPhoto(): Promise<void> {
  const current = photo.value
  if (!current || current.busy || !current.clientId || props.disabled || !props.meId) return
  const scope = photoScope(), target = { ...props.target }, replyTo = props.reply?.seq
  current.busy = true; current.error = null; current.progress = 0
  try {
    const body = await uploadBody({ target, clientId: current.clientId, ready: current.ready, caption: current.caption.trim(), ...(replyTo ? { replyTo } : {}) })
    if (!scope.current()) return
    // XMLHttpRequest reports upload progress; the actor header binds the write to this draft's character.
    const outcome = await new Promise<{ ok: true; result: Extract<SendMessageResult, { ok: true }> } | { ok: false; reason: string }>((done) => {
      const request = new XMLHttpRequest()
      uploading = request
      request.open('POST', '/api/social/images')
      request.setRequestHeader('Content-Type', 'application/json')
      request.setRequestHeader('X-Allworld-Actor', scope.actor)
      request.upload.onprogress = (event) => { if (scope.current() && event.lengthComputable) current.progress = Math.round(100 * event.loaded / event.total) }
      request.onerror = () => done({ ok: false, reason: 'Delivery is not confirmed. Retry this picture to avoid sending it twice.' })
      request.ontimeout = request.onerror
      request.onabort = () => done({ ok: false, reason: 'Picture upload cancelled.' })
      request.timeout = 60000
      request.onload = () => {
        let answer: { ok?: boolean; reason?: string; error?: string } = {}
        try { answer = JSON.parse(request.responseText) as typeof answer } catch { /* a page that is not ours */ }
        if (request.status === 200 && answer.ok === true) done({ ok: true, result: answer as Extract<SendMessageResult, { ok: true }> })
        else done({ ok: false, reason: answer.reason ?? (request.status === 413 ? 'That picture is too big to send.' : request.status === 429 ? 'Too many requests. Wait a minute and try again.' : 'The picture was not sent. Try again.') })
      }
      request.send(body)
    })
    if (!scope.current()) return
    if (outcome.ok) { emit('sentPicture', outcome.result); emit('cancelReply'); dismissPhoto() } else current.error = outcome.reason
  } catch { if (scope.current()) current.error = 'Delivery is not confirmed. Retry this picture to avoid sending it twice.' }
  finally { if (scope.current()) { current.busy = false; uploading = null } }
}

watch([() => props.meId, () => props.conv], ([actor, conv], previous) => {
  const changedActor = previous?.[0] !== undefined && previous[0] !== actor
  dismissPhoto()
  draftActor = actor; draftConversation = conv; drafts = draftsFor(actor)
  text.value = (!changedActor && props.prefill) || drafts.get(conv)
  picked.value = []; emoji.value = false; caret.value = 0
  void nextTick(grow)
}, { immediate: true, flush: 'sync' })
watch(text, (value) => drafts.set(draftConversation, value), { flush: 'sync' })

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
  if (!body || props.disabled || tooLong.value) return
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
    <div v-if="photo" class="composer-photo" role="group" aria-label="Picture to send">
      <img v-if="photo.ready.url" :src="photo.ready.url" alt="The picture you are about to send">
      <div class="composer-photo-side">
        <input v-if="photo.clientId" v-model="photo.caption" name="caption" maxlength="200" placeholder="Add a caption (optional)" aria-label="Caption" autocomplete="off" :disabled="photo.busy">
        <progress v-if="photo.busy" max="100" :value="photo.progress" aria-label="Sending">{{ photo.progress }}%</progress>
        <p v-if="photo.error" class="composer-photo-error" role="alert">{{ photo.error }}</p>
        <span class="composer-photo-actions">
          <button v-if="photo.clientId" type="button" class="composer-photo-send" :disabled="photo.busy" @click="sendPhoto">{{ photo.busy ? 'Sending…' : photo.error ? 'Try again' : 'Send' }}</button>
          <button type="button" :disabled="photo.busy" @click="dismissPhoto">Cancel</button>
        </span>
      </div>
    </div>
    <VoiceComposer v-if="voice" :target="target" :conv="conv" :me-id="meId" :disabled="disabled || Boolean(photo)" :new-id="newId" :reply-to="reply?.seq" @sent="(result) => { emit('sentVoice', result); emit('cancelReply') }" />
    <EmojiPicker v-if="emoji" class="composer-emoji" @pick="insertEmoji" />
    <form class="composer-form" @submit.prevent="submit">
      <input v-if="pictures" ref="fileInput" type="file" accept="image/*" class="composer-file" aria-label="Choose a picture" tabindex="-1" @change="chosen">
      <button v-if="pictures" type="button" class="composer-side" aria-label="Send a picture" title="Send a picture" :disabled="disabled" @click="fileInput?.click()">📷</button>
      <button type="button" class="composer-side" :aria-pressed="emoji" aria-label="Emoji" :disabled="disabled" @click="emoji = !emoji">☺</button>
      <textarea ref="field" v-model="text" name="body" :rows="lines" :maxlength="max * 2" autocomplete="off" enterkeyhint="send" placeholder="Message" aria-label="Message" :aria-describedby="limitId" :aria-invalid="tooLong || undefined" :disabled="disabled" @input="onInput" @keydown="onKey" @keyup="track" @click="track" @focus="emoji = false" />
      <button type="submit" class="composer-send" aria-label="Send" :title="tooLong ? `Shorten your message to ${max} characters.` : 'Send'" :disabled="disabled || !count || tooLong"><GameIcon name="earn" :size="22" /></button>
    </form>
    <p :id="limitId" class="composer-count" :class="{ 'is-over': tooLong }" :role="tooLong ? 'alert' : undefined">{{ tooLong ? `Remove ${count - max} characters to send.` : `${count} / ${max} characters` }}</p>
  </div>
</template>

<style scoped>
.composer { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; max-width: 100%; gap: 6px; }
.composer-form { display: flex; min-width: 0; width: 100%; align-items: flex-end; gap: 8px; margin: 0; }
/* The id selectors beat the panel-wide textarea rule (controls.css), which makes every textarea 96px tall. */
.composer-form textarea, #life-dialog .composer-form textarea, .life-ui .composer-form textarea { flex: 1; width: auto; min-width: 0; box-sizing: border-box; min-height: var(--tap); max-height: 108px; resize: none; padding: 11px 16px; border: 1px solid var(--c-line); border-radius: 12px; background: var(--c-fill); font: 400 16px/22px var(--font); overflow-y: auto; }
.composer-count { margin: 0; font-size: 12px; line-height: 1.4; color: var(--c-muted); text-align: right; }
.composer-count.is-over { color: var(--c-red-dark); }
.composer-send, .composer-side { flex: none; display: grid; place-items: center; width: var(--tap); height: var(--tap); border: 0; border-radius: 10px; cursor: pointer; }
.composer-send { background: #176347; color: #fff; }
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
.composer-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.composer-photo { display: flex; gap: 10px; padding: 8px; border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; }
.composer-photo img { flex: none; width: 96px; height: 96px; object-fit: cover; border-radius: 10px; background: var(--c-fill-2); }
.composer-photo-side { flex: 1; min-width: 0; display: grid; align-content: start; gap: 6px; }
.composer-photo-side input { box-sizing: border-box; width: 100%; min-height: 36px; padding: 6px 10px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); font: inherit; font-size: 14px; }
.composer-photo-side progress { width: 100%; height: 8px; }
.composer-photo-error { margin: 0; font-size: 12px; line-height: 1.4; color: var(--c-red); }
.composer-photo-actions { display: flex; gap: 6px; }
.composer-photo-actions button { min-height: 36px; padding: 0 14px; border: 0; border-radius: 18px; background: var(--c-fill); font: 600 13px var(--font); cursor: pointer; }
.composer-photo-actions .composer-photo-send { background: var(--app-tint, var(--c-green-dark)); color: #fff; }
.composer-photo-actions button:disabled { opacity: .5; cursor: not-allowed; }
.composer-emoji { position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 3; }
</style>
