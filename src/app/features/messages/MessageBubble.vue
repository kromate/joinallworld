<script setup lang="ts">
import VoiceNote from './VoiceNote.vue'
// One message: its name and time, the quoted message it answers, its words with mention chips (or large emoji), a gift's money
// line, reactions as counted chips, and the actions (Reply, react) behind a small button, a right-click or a long press.
import { computed, onBeforeUnmount, ref } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import EmojiPicker from './EmojiPicker.vue'
import PictureView from './PictureView.vue'
import { QUICK_REACTIONS } from './emojiData.ts'
import { emojiOnly, giftDetail, giftLine, pieces } from './messagesText.ts'
import type { Message } from '../../../types/social.ts'

const props = defineProps<{ item: Message; meId: string; group: boolean; head: boolean; tail: boolean; time: string; canReact: boolean; voiceEnabled?: boolean }>()
const emit = defineEmits<{ reply: [item: Message]; react: [item: Message, emoji: string | null]; player: [id: string]; jump: [seq: number]; reportVoice: [item: Message]; picture: [item: Message]; edit: [item: Message]; remove: [item: Message]; forward: [item: Message] }>()
const mine = computed(() => props.item.from?.id === props.meId)
const parts = computed(() => pieces(props.item.body, props.item.mentions))
const big = computed(() => (props.item.mentions?.length || props.item.replyTo || props.item.image || props.item.voice ? 0 : emojiOnly(props.item.body)))
const open = ref(false)
const more = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
const mineReaction = computed(() => props.item.reactions?.find((entry) => entry.mine)?.emoji ?? null)
function show(): void { open.value = true; more.value = false }
function hide(): void { open.value = false; more.value = false }
let pointer: { x: number; y: number; id: number } | null = null
function press(event: PointerEvent): void {
  cancel()
  if (!props.canReact || !event.isPrimary || props.item.deleted || (event.target instanceof Element && event.target.closest('button, input, textarea, select, audio'))) return
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId)
  pointer = { x: event.clientX, y: event.clientY, id: event.pointerId }
  if (props.canReact) timer = setTimeout(show, 450)
}
function move(event: PointerEvent): void {
  if (pointer && (Math.abs(event.clientY - pointer.y) > 12 || Math.abs(event.clientX - pointer.x) > 12)) cancel()
}
function release(event: PointerEvent): void {
  cancel()
  if (pointer && event.pointerId === pointer.id && event.clientX - pointer.x > 65 && Math.abs(event.clientY - pointer.y) < 25 && !props.item.deleted) reply()
  pointer = null
}
function action(kind: 'edit' | 'remove' | 'forward'): void {
  if (kind === 'edit') emit('edit', props.item)
  else if (kind === 'remove') emit('remove', props.item)
  else emit('forward', props.item)
  hide()
}
function cancel(): void { if (timer) clearTimeout(timer); timer = null }
function react(emoji: string): void { emit('react', props.item, mineReaction.value === emoji ? null : emoji); hide() }
function reply(): void { emit('reply', props.item); hide() }
onBeforeUnmount(cancel)
</script>

<template>
  <div class="bubble-wrap" :class="{ 'is-mine': mine, 'is-tail': tail }" :data-seq="item.seq" @keydown.esc="hide" @contextmenu.prevent="canReact && !item.deleted && show()" @pointerdown="press" @pointermove="move" @pointerup="release" @pointerleave="cancel(); pointer = null" @pointercancel="cancel(); pointer = null">
    <div v-if="item.gift" class="bubble is-gift" :class="{ 'is-mine': mine }">
      <span class="gift-row"><GameIcon name="coin" :size="22" /><b>{{ giftLine(item, meId) }}</b></span>
      <span v-if="giftDetail(item, meId)" class="gift-detail">{{ giftDetail(item, meId) }}</span>
      <small>{{ time }}</small>
    </div>
    <div v-else class="bubble" :class="{ 'is-mine': mine, 'is-big': big > 0, 'is-head': head }">
      <small v-if="item.forwarded && !item.deleted">Forwarded</small>
      <b v-if="group && head && !mine && item.from" class="bubble-name">{{ item.from.name }}</b>
      <button v-if="item.replyTo" type="button" class="bubble-quote" :aria-label="`Show the message from ${item.replyTo.from?.name ?? 'someone'}`" @click="emit('jump', item.replyTo.seq)">
        <b>{{ item.replyTo.from?.name ?? 'Message' }}</b><span>{{ item.replyTo.text || 'Picture' }}</span>
      </button>
      <PictureView v-if="item.image" class="bubble-pic" :image="item.image" @open="emit('picture', item)" />
      <span v-if="item.body || !item.image" class="bubble-text" :class="{ 'is-big': big > 0 }" :style="big ? { fontSize: `${big === 1 ? 44 : big === 2 ? 36 : 30}px` } : undefined"><template v-for="(piece, index) in parts" :key="index"><button v-if="piece.mention && piece.mention.id !== 'everyone'" type="button" class="chip" :aria-label="`Open ${piece.text.slice(1)}'s card`" @click.stop="emit('player', piece.mention.id)">{{ piece.text }}</button><span v-else-if="piece.mention" class="chip is-all">{{ piece.text }}</span><template v-else>{{ piece.text }}</template></template></span>
      <VoiceNote v-if="item.voice" :voice="item.voice" :off="!mine && voiceEnabled === false" />
      <small v-if="tail">{{ time }}<template v-if="item.editedAt && !item.deleted"> · Edited</template><template v-if="mine && !item.deleted"> · Sent</template></small>
    </div>
    <div v-if="item.reactions?.length" class="reactions" role="group" aria-label="Reactions">
      <button v-for="entry in item.reactions" :key="entry.emoji" type="button" class="reaction" :class="{ 'is-mine': entry.mine }" :aria-pressed="Boolean(entry.mine)" :aria-label="`${entry.emoji} ${entry.count}${entry.mine ? ', yours' : ''}`" :disabled="!canReact" @click="react(entry.emoji)">{{ entry.emoji }}<small>{{ entry.count }}</small></button>
    </div>
    <button v-if="canReact && !item.deleted" type="button" class="bubble-more" aria-label="Message actions" :aria-expanded="open" @click.stop="open ? hide() : show()">⋯</button>
    <div v-if="open" class="menu" role="menu" @click.stop>
      <div v-if="canReact && !more" class="menu-row">
        <button v-for="emoji in QUICK_REACTIONS" :key="emoji" type="button" role="menuitem" class="menu-emoji" :class="{ 'is-on': mineReaction === emoji }" :aria-label="`React ${emoji}`" @click="react(emoji)">{{ emoji }}</button>
        <button type="button" role="menuitem" class="menu-emoji" aria-label="More reactions" @click="more = true">＋</button>
      </div>
      <EmojiPicker v-else-if="canReact && more" @pick="react" />
      <button type="button" role="menuitem" class="menu-item" @click="reply">Reply</button>
      <button v-if="!item.image && !item.voice && !item.gift" type="button" role="menuitem" class="menu-item" @click="action('forward')">Forward</button>
      <button v-if="mine && !item.image && !item.voice && !item.gift" type="button" role="menuitem" class="menu-item" @click="action('edit')">Edit</button>
      <button v-if="mine && !item.gift" type="button" role="menuitem" class="menu-item" @click="action('remove')">Delete for everyone</button>
      <button v-if="item.voice && !mine" type="button" role="menuitem" class="menu-item" @click="emit('reportVoice', item); hide()">Report voice note</button>
      <button type="button" role="menuitem" class="menu-item is-quiet" @click="hide">Close</button>
    </div>
  </div>
</template>

<style scoped>
.bubble-wrap { touch-action: pan-y; position: relative; display: flex; flex-direction: column; align-items: flex-start; max-width: 86%; align-self: flex-start; -webkit-touch-callout: none; }
.bubble-wrap.is-mine { align-items: flex-end; align-self: flex-end; }
.bubble { max-width: 100%; box-sizing: border-box; padding: 8px 12px 6px; border-radius: 18px 18px 18px 5px; background: #fff; box-shadow: var(--ring); font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; white-space: pre-wrap; }
.bubble.is-mine { border-radius: 18px 18px 5px 18px; background: #176347; color: #fff; box-shadow: none; }
.bubble.is-big { background: none; box-shadow: none; padding: 2px 4px; color: inherit; }
.bubble-name { display: block; font-size: 11px; color: var(--app-tint, var(--c-green-dark)); }
.bubble small { display: block; margin-top: 2px; font-size: 10px; color: var(--c-muted); text-align: right; }
.bubble.is-mine small { color: #ffffffcc; }
.bubble.is-big small { color: var(--c-muted); }
.bubble-text.is-big { line-height: 1.15; }
.bubble-pic { margin: 2px 0 4px; }
.bubble-quote { display: grid; width: 100%; margin: 2px 0 4px; padding: 4px 8px; border: 0; border-left: 3px solid currentColor; border-radius: 6px; background: rgba(0, 0, 0, .07); color: inherit; font: inherit; font-size: 12px; text-align: left; opacity: .85; cursor: pointer; white-space: normal; }
.bubble-quote b { font-size: 11px; }
.bubble-quote span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip { display: inline; padding: 0 5px; border: 0; border-radius: 8px; background: rgba(36, 112, 86, .16); color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
.chip.is-all { cursor: default; background: rgba(232, 166, 67, .28); }
.bubble.is-mine .chip { background: rgba(255, 255, 255, .24); }
.bubble.is-gift { display: grid; gap: 2px; min-width: 190px; padding: 10px 14px 6px; border: 1.5px solid #e8c36a; background: #fff8e1; color: var(--c-ink); }
.bubble.is-gift.is-mine { background: #fff8e1; color: var(--c-ink); }
.bubble.is-gift small { color: var(--c-muted); }
.gift-row { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.gift-detail { font-size: 12px; color: var(--c-ink-2); }
.reactions { display: flex; flex-wrap: wrap; gap: 4px; margin: -4px 6px 0; position: relative; z-index: 1; }
.reaction { display: inline-flex; align-items: center; gap: 3px; min-height: 26px; padding: 0 8px; border: 1px solid var(--c-line); border-radius: 13px; background: #fff; font-size: 14px; cursor: pointer; }
.reaction small { margin: 0; font-size: 11px; color: var(--c-ink-2); }
.reaction.is-mine { border-color: var(--app-tint, var(--c-green-dark)); background: #eef8f1; }
.bubble-more { position: absolute; top: 2px; right: -30px; min-width: 28px; min-height: 28px; border: 0; border-radius: 50%; background: none; color: var(--c-muted); font-size: 18px; line-height: 1; opacity: 0; cursor: pointer; }
.bubble-wrap.is-mine .bubble-more { right: auto; left: -30px; }
.bubble-wrap:hover .bubble-more, .bubble-more:focus-visible, .bubble-more[aria-expanded='true'] { opacity: 1; }
@media (hover: none) { .bubble-more { opacity: .55; } }
.menu { position: absolute; z-index: 6; top: 100%; left: 0; display: grid; gap: 2px; min-width: 240px; max-width: min(320px, 92vw); padding: 6px; border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-2, var(--e-1)); }
.bubble-wrap.is-mine .menu { left: auto; right: 0; }
.menu-row { display: flex; gap: 2px; }
.menu-emoji { flex: 1; min-height: 40px; border: 0; border-radius: 10px; background: none; font-size: 22px; cursor: pointer; }
.menu-emoji.is-on { background: var(--c-fill-2); }
.menu-item { min-height: 40px; padding: 0 10px; border: 0; border-radius: 10px; background: none; font: 600 14px var(--font); text-align: left; cursor: pointer; }
.menu-item:hover, .menu-emoji:hover { background: var(--c-fill-2); }
.menu-item.is-quiet { color: var(--c-muted); }
</style>
