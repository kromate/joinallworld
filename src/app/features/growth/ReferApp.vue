<script setup lang="ts">
// Bring a friend: the Phone app. Your invite link (shared through the phone's own apps — the game
// sends nothing), who came through it and where each of them is on the way to counting. Every
// Share button in the growth apps opens the share sheet (ShareSheet.vue).
// Rules: server/growth/referral.ts; numbers: src/game/content/growth.ts.
import { computed, onMounted } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import BaseChip from '../../ui/BaseChip.vue'
import EmptyState from '../../ui/EmptyState.vue'
import HeroCard from '../../ui/HeroCard.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import ListRow from '../../ui/ListRow.vue'
import ListRows from '../../ui/ListRows.vue'
import RowMark from '../../ui/RowMark.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { byLine, friendState, heroFigure, heroNote, paidLine, referRules, waitingLine } from './referModel.ts'
import { useGrowth } from './useGrowth.ts'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const growth = useGrowth()
const view = game.view
const why = computed(() => linkWords(view.value)?.why ?? '')
const r = computed(() => growth.state.hello?.referral ?? null)
const busy = computed(() => growth.state.busy)

onMounted(() => { void growth.load() })
</script>

<template>
  <div class="refer">
    <p v-if="!view.connected" class="gr-note">{{ why }}</p>
    <p v-else-if="!r" class="gr-note" role="status">{{ waitingLine(growth.state.error) }}</p>
    <template v-else>
      <HeroCard label="Bring a friend" :figure="heroFigure(r.counted)" class="gr-hero"><template v-if="heroNote(r)">{{ heroNote(r) }}</template></HeroCard>
      <div class="gr-card">
        <h3>Your invite link</h3>
        <p>Send it in WhatsApp or anywhere else. Your friend picks a name and is in: no sign-up. When they have been paid for work on {{ r.rules.workDays }} different days, you get {{ money(r.rules.reward) }} and {{ r.rules.stars }} stars. They get {{ money(r.rules.welcome) }} after their first paid day.</p>
        <BaseButton variant="primary" block :disabled="busy !== null" @click="growth.share('invite', { surface: 'phone' })">{{ busy === 'invite' ? 'Preparing…' : 'Share my invite link' }}</BaseButton>
        <BaseButton block :disabled="busy !== null" @click="growth.share('house', { surface: 'phone' })">{{ busy === 'house' ? 'Preparing…' : 'Invite someone to my house' }}</BaseButton>
      </div>
      <div v-if="r.by" class="gr-card">
        <h3>You came through {{ r.by.name }}’s link</h3>
        <p>{{ byLine(r.by, r.rules, money) }}</p>
        <BaseButton @click="shell.open('invite', { host: r.by.id })">Go to their door</BaseButton>
      </div>
      <SectionTitle :note="String(r.invited.length)">Came through your link</SectionTitle>
      <ListRows v-if="r.invited.length" as="ul" label="Friends who came through your link">
        <ListRow v-for="friend in r.invited" :key="friend.id" as="li" :title="friend.name" :sub="friendState(friend)">
          <template #icon><RowMark :name="friend.name" :seed="friend.id" /></template>
          <template v-if="friend.state === 'counted'" #end><BaseChip tone="good">Counted</BaseChip></template>
        </ListRow>
      </ListRows>
      <EmptyState v-else compact icon="people" title="Nobody yet" text="Share your link with one friend to start." />
      <p v-if="r.paid" class="gr-note">{{ paidLine(r.paid, r.owed) }}</p>
      <HowItWorks id="refer-rules" :rules="referRules(r.rules)" />
    </template>
  </div>
</template>

<style scoped>
.gr-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gr-card { background: #fff; border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 14px; margin: 0 0 var(--s-3); }
.gr-card h3 { margin: 0 0 4px; font-size: 15px; text-transform: none; letter-spacing: 0; color: var(--c-ink); }
.gr-card p { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--c-ink-2); }
.gr-card :deep(.base-button) { margin: 4px 0 0; }
.gr-card :deep(.base-button.is-block + .base-button.is-block) { margin-top: 8px; }
</style>
