<script setup lang="ts">
// "Share my shop": the shop's public address for the seller to send to customers. Only a published shop has one; before that
// the seller is told plainly what is still needed. The address opens a page that needs no account (docs/SHOWCASE.md, "The public link").
import { computed, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { SHOWCASE } from '../../../types/showcase.ts'
import type { ShowcaseStatus } from '../../../types/showcase.ts'
import { shareMessage, shopPath } from '../../../types/showcase-link.ts'
import { copyText, systemShare } from '../../../ui/share.ts'
import { newClientId } from '../social/useSocial.ts'
import { isPlayApp } from '../../playMode.ts'

const props = defineProps<{ shop: { name: string; status: ShowcaseStatus; pub?: string | undefined }; photos: number; blocked: string | null }>()
const { game } = useApp()
const playApp = isPlayApp()
const path = ref(props.shop.pub ? shopPath(props.shop.name, props.shop.pub) : '')
const note = ref('')
const busy = ref(false)
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
let clientId = ''

/** What is still needed, in the seller's words, until the shop is live. */
const needed = computed(() => {
  switch (props.shop.status) {
    case 'draft': return props.photos < SHOWCASE.photosMin ? `Add at least ${SHOWCASE.photosMin} photos (you have ${props.photos}), then send your shop for review.` : 'Send your shop for review.'
    case 'review': return 'A person is looking at your shop. When it is approved, your link appears here.'
    case 'hidden': return 'Show your shop again to get a link.'
    case 'held': return 'Your shop is on hold, so it has no link for now.'
    default: return ''
  }
})
const url = computed(() => (path.value ? `${location.origin}${path.value}` : ''))
const message = computed(() => (url.value ? shareMessage(props.shop.name, url.value) : ''))

/** The link: made by the server the first time (it is not the shop's id), the same one after that. */
async function ensure(): Promise<boolean> {
  if (path.value) return true
  if (busy.value) return false
  busy.value = true; note.value = ''; clientId ||= newClientId()
  try {
    const answer = await game.fetchJson<{ ok?: boolean; path?: string }>('/api/showcase/mine/share', { method: 'POST', body: { clientId } })
    clientId = ''
    if (answer.ok && answer.path) { path.value = answer.path; return true }
    note.value = 'Your link could not be made. Try again.'
  } catch (error) {
    note.value = (error as { code?: string } | null)?.code === 'not_published' ? 'Your shop is not published yet.' : error instanceof Error ? error.message : 'Your link could not be made. Try again.'
  } finally { busy.value = false }
  return false
}
// A live shop shows its link as soon as the card is on screen: made on the server the first time, the same one after that.
watch(() => props.shop.status, (status) => { if (status === 'live') void ensure() }, { immediate: true })
async function share(): Promise<void> {
  if (!(await ensure())) return
  const result = await systemShare({ file: null, text: message.value })
  if (result === 'shared') note.value = 'Shared.'
  else if (result === 'unavailable') await copy('message')
}
async function copy(what: 'link' | 'message'): Promise<void> {
  if (!(await ensure())) return
  note.value = (await copyText(what === 'link' ? url.value : message.value)) ? (what === 'link' ? 'Link copied.' : 'Message copied. Paste it into a chat or a status.') : 'Could not copy. Press and hold the link to copy it.'
}
</script>

<template>
  <section class="ss" aria-label="Share my shop" data-share>
    <template v-if="shop.status === 'live'">
      <h3 class="ss-title">Share my shop</h3>
      <p class="ss-lead">Customers open your link with no sign-up, see your items and prices, and message you. Anyone who has the link can see your contact<template v-if="!playApp"> and payment links</template>.</p>
      <p v-if="url" class="ss-url" data-share-url>{{ url }}</p>
      <p v-if="message" class="ss-msg" data-share-message>{{ message }}</p>
      <div class="ss-go">
        <button v-if="canShare" type="button" class="ui-button is-primary is-block" :disabled="busy" data-share-send @click="share">Share my shop</button>
        <button type="button" class="ui-button is-block" :class="{ 'is-primary': !canShare }" :disabled="busy" data-share-copy-message @click="copy('message')">Copy message and link</button>
        <button type="button" class="ui-button is-block" :disabled="busy" data-share-copy-link @click="copy('link')">Copy link only</button>
      </div>
      <p v-if="note" class="ss-note" role="status" data-share-note>{{ note }}</p>
    </template>
    <template v-else>
      <h3 class="ss-title">Share my shop</h3>
      <p class="ss-lead" data-share-needed>You can share your shop once it is published. {{ needed }}</p>
      <p v-if="blocked" class="ss-lead">You also need to be able to publish: see the note above.</p>
    </template>
  </section>
</template>

<style scoped>
.ss { display: grid; gap: var(--s-2); padding: 12px; border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; min-width: 0; }
.ss-title { margin: 0; font-size: 16px; }
.ss-lead, .ss-note { margin: 0; font-size: var(--t-small); color: var(--c-ink-2); }
.ss-url { margin: 0; padding: 8px 10px; border-radius: var(--r-sm); background: var(--c-fill); font-size: 14px; font-weight: 600; overflow-wrap: anywhere; user-select: all; }
.ss-msg { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.ss-go { display: grid; gap: 8px; }
</style>
