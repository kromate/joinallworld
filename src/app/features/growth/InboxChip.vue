<script setup lang="ts">
// The inbox chip in the HUD: unread chats and Updates at a glance, and a knock at the door as an
// alert. It opens Messages (or the door). The numbers are from what the social client already
// holds; mounting the chip starts that client (idempotent), as the existing chip does.
import { computed, onMounted } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { social, start as startSocial } from '../social/useSocial.ts'
import { unreadChats, unreadUpdates } from '../messages/messagesModel.ts'
import { noticeMarks } from '../messages/messagesState.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { inboxChip } from './awayModel.ts'

defineProps<{ params?: unknown }>()
const { game, shell, api } = useApp()
const view = game.view
const chip = computed(() => {
  void shell.legacyTick.value
  const v = view.value
  return inboxChip({
    connected: v.connected, onboardingRequired: Boolean(v.onboarding?.required), me: social.me, error: social.error,
    unreadChats: unreadChats(social.me), unreadUpdates: unreadUpdates(social.me), freshNotices: noticeMarks.fresh(v.cityId, v.social?.notices),
    short: linkWords(v)?.short ?? '',
  })
})
onMounted(() => startSocial(api))
</script>

<template>
  <button v-if="chip.kind === 'offline'" type="button" class="life-job" disabled><span aria-hidden="true"><GameIcon name="messages" :size="17" /></span><div><strong>Messages</strong><small>{{ chip.short }}</small></div></button>
  <button v-else-if="chip.kind === 'knock'" type="button" class="life-job is-active" @click="shell.open('invite')"><span aria-hidden="true"><GameIcon name="invite" :size="17" /></span><div><strong>{{ chip.name }} is knocking</strong><small>Let them in or not now</small></div></button>
  <button v-else-if="chip.kind === 'inbox'" type="button" class="life-job" :class="{ 'is-active': chip.active }" @click="shell.open('messages')"><span aria-hidden="true"><GameIcon name="messages" :size="17" /></span><div><strong>Messages</strong><small>{{ chip.hint }}</small></div></button>
</template>
