<script setup lang="ts">
// The share sheet: a modal panel every Share button in the growth apps opens. The card's picture
// (a blob URL, revoked by the store when it is replaced), the text that goes with it, the phone's
// own share sheet, WhatsApp, X, Copy and Save picture. The game sends nothing; the player
// chooses who sees it. The text is shown as text, never as markup.
//
// For an invitation (the invite link, the house, a table) it also offers Copy link, Telegram and a
// QR code, says what the inviter gets (the referral rules, with their conditions) and how many
// friends have joined. The QR encoder is only fetched when the code is asked for.
import { computed, defineAsyncComponent, nextTick, onMounted, ref } from 'vue'
import { input } from '../../state/inputMode.ts'
import { REFERRAL } from '../../../game/content/growth.ts'
import { channelLinks } from '../../../ui/share-links.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import LinkButton from './LinkButton.vue'
import { friendGetsLine, inviterLimitLine, inviterRewardLine, isInviteSheet, progressLine } from './inviteModel.ts'
import type { InviteRules, ShareChannel } from './inviteModel.ts'
import { useGrowth } from './useGrowth.ts'

defineProps<{ params?: unknown }>()
const ShareQr = defineAsyncComponent(() => import('./ShareQr.vue'))
const growth = useGrowth()
const sharing = growth.state
const working = ref<'share' | 'copy' | 'link' | null>(null)
const showQr = ref(false)
/** Set when the browser refused the clipboard: the text is shown in a read-only field, selected, for the player to copy. */
const manual = ref<'link' | 'text' | null>(null)
const manualField = ref<HTMLTextAreaElement | null>(null)
const manualHelp = computed(() => (input.touch && !input.keys ? 'Press and hold to copy.' : 'Press ⌘C (Ctrl+C on Windows) to copy.'))
async function offerManual(what: 'link' | 'text'): Promise<void> {
  manual.value = what
  await nextTick()
  const field = manualField.value
  if (field) { field.focus({ preventScroll: true }); field.select(); field.setSelectionRange(0, field.value.length) }
}
const canNative = ref(false)
const invite = computed(() => isInviteSheet(sharing.sharing?.facts.kind))
const links = computed(() => { const made = sharing.sharing; return made ? channelLinks(made.prepared.text, made.prepared.link) : null })
const referral = computed(() => sharing.hello?.referral ?? null)
const fallback: InviteRules = { welcome: REFERRAL.welcome, reward: REFERRAL.reward, stars: REFERRAL.rewardStars, perWeek: REFERRAL.paidPerWeek, lifetime: REFERRAL.paidLifetime, workDays: REFERRAL.countWorkDays, linkWithinDays: REFERRAL.linkWithinDays }
const rules = computed<InviteRules>(() => referral.value?.rules ?? fallback)
const progress = computed(() => progressLine(referral.value))

function channel(name: ShareChannel): void { growth.track('share_channel', { channel: name }) }
async function run(what: 'share' | 'copy'): Promise<void> {
  if (working.value) return
  working.value = what
  channel(what === 'share' ? 'native' : 'copy')
  try { if (what === 'share') await growth.shareNow(); else if (!(await growth.copyShare())) await offerManual('text') } finally { working.value = null }
}
async function copyLink(): Promise<void> {
  const made = sharing.sharing
  if (working.value || !made) return
  working.value = 'link'
  channel('copy')
  try { if (!(await growth.copyLink())) await offerManual('link') } finally { working.value = null }
}
function toggleQr(): void { showQr.value = !showQr.value; if (showQr.value) channel('qr') }
onMounted(() => {
  canNative.value = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  if (invite.value) void growth.load()
})
</script>

<template>
  <div class="gr-share">
    <p v-if="!sharing.sharing" class="gr-note">Nothing to share yet.</p>
    <template v-else-if="!invite">
      <img v-if="sharing.sharing.prepared.url" class="gr-share-img" :src="sharing.sharing.prepared.url" alt="Your Allworld card" width="320" height="320">
      <p class="gr-share-text">{{ sharing.sharing.prepared.text }}</p>
      <div class="gr-share-acts">
        <BaseButton variant="primary" class="is-wide" :disabled="working !== null" @click="run('share')"><GameIcon name="share" :size="18" /> {{ working === 'share' ? 'Sharing…' : 'Share…' }}</BaseButton>
        <LinkButton :href="sharing.sharing.prepared.whatsapp">WhatsApp</LinkButton>
        <LinkButton :href="sharing.sharing.prepared.x">X</LinkButton>
        <BaseButton :disabled="working !== null" @click="run('copy')">{{ working === 'copy' ? 'Copying…' : 'Copy text' }}</BaseButton>
        <LinkButton v-if="sharing.sharing.prepared.url" :href="sharing.sharing.prepared.url" download="allworld.jpg">Save picture</LinkButton>
      </div>
      <div v-if="manual" class="gr-manual" data-manual-copy>
        <textarea ref="manualField" class="gr-manual-field" readonly rows="3" :aria-label="manual === 'link' ? 'Your link' : 'The text to copy'" :value="manual === 'link' ? sharing.sharing.prepared.link : sharing.sharing.prepared.text" @focus="($event.target as HTMLTextAreaElement).select()" />
        <p role="status" class="gr-note">{{ manualHelp }}</p>
      </div>
      <p class="gr-note">You choose who sees this. The link is the last line: delete it if you only want the result. Sharing pays nothing; a friend who really plays does.</p>
    </template>
    <template v-else>
      <img v-if="sharing.sharing.prepared.url" class="gr-share-img" :src="sharing.sharing.prepared.url" alt="Your Allworld card" width="320" height="320">
      <p class="gr-share-text gr-share-link" data-invite-link>{{ sharing.sharing.prepared.link }}</p>
      <div class="gr-share-acts">
        <BaseButton variant="primary" class="is-wide" :disabled="working !== null" @click="copyLink">{{ working === 'link' ? 'Copying…' : 'Copy link' }}</BaseButton>
        <BaseButton v-if="canNative" class="is-wide" :disabled="working !== null" @click="run('share')">{{ working === 'share' ? 'Sharing…' : 'Share…' }}</BaseButton>
        <LinkButton v-if="links" :href="links.whatsapp" @click="channel('whatsapp')">WhatsApp</LinkButton>
        <LinkButton v-if="links" :href="links.telegram" @click="channel('telegram')">Telegram</LinkButton>
        <LinkButton v-if="links" :href="links.x" @click="channel('x')">X</LinkButton>
        <BaseButton :aria-expanded="showQr" @click="toggleQr">{{ showQr ? 'Hide QR code' : 'Show QR code' }}</BaseButton>
      </div>
      <div v-if="manual" class="gr-manual" data-manual-copy>
        <textarea ref="manualField" class="gr-manual-field" readonly rows="3" :aria-label="manual === 'link' ? 'Your link' : 'The text to copy'" :value="manual === 'link' ? sharing.sharing.prepared.link : sharing.sharing.prepared.text" @focus="($event.target as HTMLTextAreaElement).select()" />
        <p role="status" class="gr-note">{{ manualHelp }}</p>
      </div>
      <ShareQr v-if="showQr" :link="sharing.sharing.prepared.link" />
      <p class="gr-progress" role="status" data-invite-progress>{{ progress || 'Your link is ready.' }}</p>
      <div class="gr-reward" data-invite-reward>
        <p>{{ inviterRewardLine(rules, money) }}</p>
        <p>{{ friendGetsLine(rules, money) }}</p>
        <p>{{ inviterLimitLine(rules) }}</p>
      </div>
      <p class="gr-note">You choose who sees this: the game sends nothing. A friend who opens the link sees your name and goes straight to making their Sim.</p>
    </template>
  </div>
</template>

<style scoped>
.gr-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gr-share-img { display: block; width: 100%; max-width: 320px; margin: 0 auto var(--s-3); border-radius: 18px; box-shadow: var(--e-2); }
:global(.ph.is-wide) .gr-share-img { max-width: 380px; }
.gr-share-text { white-space: pre-wrap; background: var(--c-fill); border-radius: 12px; padding: 10px 12px; font-size: 13px; line-height: 1.45; margin: 0 0 var(--s-3); user-select: all; overflow-wrap: anywhere; }
.gr-share-acts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2); margin-bottom: var(--s-3); }
.gr-share-acts > * { min-height: var(--tap, 44px); text-align: center; }
.gr-share-acts .is-wide { grid-column: 1 / -1; }
.gr-manual { margin: 0 0 var(--s-3); }
.gr-manual-field { display: block; width: 100%; box-sizing: border-box; min-height: 64px; resize: none; font: inherit; font-size: 13px; line-height: 1.45; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--c-line); background: #fff; color: var(--c-ink); user-select: text; -webkit-user-select: text; }
.gr-progress { margin: 0 0 var(--s-2); font-size: 14px; font-weight: 700; color: var(--c-green-dark); }
.gr-reward { background: var(--c-fill); border-radius: 12px; padding: 8px 12px; }
.gr-reward p { margin: 4px 0; font-size: 12.5px; line-height: 1.45; color: var(--c-ink-2); }
</style>
