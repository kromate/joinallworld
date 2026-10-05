<script setup lang="ts">
// Under the Ping button once a ping is out: what the server answered, and the other ways to reach the friend — all of
// them the player's own hand. "Share a join link" opens the device's share sheet (or copies the link), and WhatsApp opens
// the player's own WhatsApp with the message written; nothing is sent by the game, and no number is asked for.
// The link is the same join link the ping made: it works for that friend only, and signs nobody in.
import '../../../ui/controls.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import LinkButton from '../growth/LinkButton.vue'
import { shareWords, whatsappUrl } from './pingModel.ts'
import { cancelPing, pingState } from './pingStore.ts'

const props = defineProps<{ id: string; name: string; inset?: boolean }>()
const { game } = useApp()
const sent = computed(() => { const found = pingState.sent.get(props.id); return found && found.expiresAt > game.view.value.now ? found : null })
const url = computed(() => (sent.value ? `${globalThis.location?.origin ?? ''}${sent.value.link}` : ''))
const words = computed(() => shareWords(props.name, sent.value?.place?.label ?? null))
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
async function copy(): Promise<void> {
  try { await navigator.clipboard.writeText(url.value); game.toast('Join link copied.', 'good') }
  catch { game.toast('Could not copy. Press and hold the link to copy it.', 'error') }
}
async function share(): Promise<void> {
  if (!canShare) { await copy(); return }
  try { await navigator.share({ text: words.value, url: url.value }) } catch { /* the sheet was closed */ }
}
async function cancel(): Promise<void> { if (await cancelPing(props.id)) game.toast(`Ping to ${props.name} taken back.`) }
</script>

<template>
  <section v-if="sent" class="ping-strip" :class="{ 'is-inset': inset }" :aria-label="`Your ping to ${name}`" data-ping="strip">
    <p class="ping-strip-said" role="status">{{ sent.words }}</p>
    <p class="ping-strip-more">Other ways to reach {{ name }}. The link works for {{ name }} only.</p>
    <div class="ping-strip-row">
      <button type="button" class="ui-button is-small" data-ping="share" @click="share">{{ canShare ? 'Share a join link' : 'Copy join link' }}</button>
      <LinkButton :href="whatsappUrl(words, url)" data-ping="whatsapp">WhatsApp</LinkButton>
      <button v-if="canShare" type="button" class="ui-button is-small" data-ping="copy" @click="copy">Copy link</button>
      <button type="button" class="ui-button is-small is-quiet" data-ping="cancel" @click="cancel">Take back</button>
    </div>
  </section>
</template>

<style scoped>
.ping-strip { margin: 8px 0 0; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: var(--r-md); background: #f3faf5; font-family: var(--font); }
.ping-strip.is-inset { margin: 8px 12px 0; }
.ping-strip-said { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.35; color: var(--c-ink); }
.ping-strip-more { margin: 2px 0 8px; font-size: 12px; line-height: 1.4; color: var(--c-muted); }
.ping-strip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.ping-strip-row > * { min-height: 36px; padding: 0 14px; font-size: 13px; }
</style>
