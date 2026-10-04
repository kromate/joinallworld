<script setup lang="ts">
// The share sheet: a modal panel every Share button in the growth apps opens. The card's picture
// (a blob URL, revoked by the store when it is replaced), the text that goes with it, the phone's
// own share sheet, WhatsApp, X, Copy and Save picture. The game sends nothing; the player
// chooses who sees it. The text is shown as text, never as markup.
import { ref } from 'vue'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import LinkButton from './LinkButton.vue'
import { useGrowth } from './useGrowth.ts'

defineProps<{ params?: unknown }>()
const growth = useGrowth()
const sharing = growth.state
const working = ref<'share' | 'copy' | null>(null)
async function run(what: 'share' | 'copy'): Promise<void> {
  if (working.value) return
  working.value = what
  try { await (what === 'share' ? growth.shareNow() : growth.copyShare()) } finally { working.value = null }
}
</script>

<template>
  <div class="gr-share">
    <p v-if="!sharing.sharing" class="gr-note">Nothing to share yet.</p>
    <template v-else>
      <img v-if="sharing.sharing.prepared.url" class="gr-share-img" :src="sharing.sharing.prepared.url" alt="Your Allworld card" width="320" height="320">
      <p class="gr-share-text">{{ sharing.sharing.prepared.text }}</p>
      <div class="gr-share-acts">
        <BaseButton variant="primary" class="is-wide" :disabled="working !== null" @click="run('share')"><GameIcon name="share" :size="18" /> {{ working === 'share' ? 'Sharing…' : 'Share…' }}</BaseButton>
        <LinkButton :href="sharing.sharing.prepared.whatsapp">WhatsApp</LinkButton>
        <LinkButton :href="sharing.sharing.prepared.x">X</LinkButton>
        <BaseButton :disabled="working !== null" @click="run('copy')">{{ working === 'copy' ? 'Copying…' : 'Copy text' }}</BaseButton>
        <LinkButton v-if="sharing.sharing.prepared.url" :href="sharing.sharing.prepared.url" download="allworld.jpg">Save picture</LinkButton>
      </div>
      <p class="gr-note">You choose who sees this. The link is the last line: delete it if you only want the result. Sharing pays nothing; a friend who really plays does.</p>
    </template>
  </div>
</template>

<style scoped>
.gr-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gr-share-img { display: block; width: 100%; max-width: 320px; margin: 0 auto var(--s-3); border-radius: 18px; box-shadow: var(--e-2); }
:global(.ph.is-wide) .gr-share-img { max-width: 380px; }
.gr-share-text { white-space: pre-wrap; background: var(--c-fill); border-radius: 12px; padding: 10px 12px; font-size: 13px; line-height: 1.45; margin: 0 0 var(--s-3); user-select: all; overflow-wrap: anywhere; }
.gr-share-acts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2); }
.gr-share-acts > * { min-height: var(--tap, 44px); text-align: center; }
.gr-share-acts .is-wide { grid-column: 1 / -1; }
</style>
