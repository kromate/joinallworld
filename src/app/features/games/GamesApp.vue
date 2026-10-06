<script setup lang="ts">
// Games: the Phone app for playing on your own, anywhere. Oro is the word of the day (the same for
// everybody, judged by the server) with unlimited practice words; chess and word tiles open a Phone
// table against the computer (the Tables app, with no venue needed). Friends: sit at a table in a
// park or lounge and play for real.
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { useGrowth } from '../growth/useGrowth.ts'
import type { OroView } from '../../../types/growth.ts'
import { dailyLine } from './oroModel.ts'

defineProps<{ params?: unknown }>()
const OroGame = defineAsyncComponent(() => import('./OroGame.vue'))
const { game, shell } = useApp()
const growth = useGrowth()
const view = game.view
const why = computed(() => linkWords(view.value)?.why ?? '')
const screen = ref<'hub' | 'daily' | 'practice'>('hub')
const today = ref<OroView | null>(null)

async function loadToday(): Promise<void> {
  if (!view.value.connected) return
  const result = await growth.call<OroView>('/api/growth/oro/state', {})
  if (result.ok && 'rows' in result) today.value = result
}
onMounted(() => { void loadToday() })
function back(): void { screen.value = 'hub'; void loadToday() }
function onState(next: OroView): void { today.value = next }
const play = (table: 'phone-chess' | 'phone-weave'): void => { shell.open('tables', { table }) }
const dailyCta = computed(() => (today.value?.status === 'playing' || !today.value ? (today.value?.rows.length ? 'Carry on' : 'Play today’s word') : 'See your result'))
</script>

<template>
  <p v-if="!view.connected" class="gm-note">{{ why }}</p>
  <div v-else-if="screen === 'hub'" class="gm">
    <HeroCard label="Games" :figure="today?.stats.streak ? `${today.stats.streak} day streak` : 'Pick a game'">Play on your own, anywhere. Sit at a table in a park or lounge to play with friends.</HeroCard>
    <section class="gm-card" aria-labelledby="gm-oro">
      <div class="gm-icon" aria-hidden="true"><GameIcon name="notes" inline /></div>
      <div class="gm-body">
        <h3 id="gm-oro">Oro <small>a word a day</small></h3>
        <p>{{ dailyLine(today) }}</p>
        <div class="gm-actions">
          <BaseButton variant="primary" @click="screen = 'daily'">{{ dailyCta }}</BaseButton>
          <BaseButton @click="screen = 'practice'">Practice words</BaseButton>
        </div>
      </div>
    </section>
    <section class="gm-card" aria-labelledby="gm-chess">
      <div class="gm-icon" aria-hidden="true"><GameIcon name="tables" inline /></div>
      <div class="gm-body">
        <h3 id="gm-chess">Chess <small>against the computer</small></h3>
        <p>Easy, medium or hard. Or sit at a chess table in a park and play a friend.</p>
        <div class="gm-actions"><BaseButton variant="primary" @click="play('phone-chess')">Play chess</BaseButton></div>
      </div>
    </section>
    <section class="gm-card" aria-labelledby="gm-weave">
      <div class="gm-icon" aria-hidden="true"><GameIcon name="tables" inline /></div>
      <div class="gm-body">
        <h3 id="gm-weave">Weave <small>word tiles</small></h3>
        <p>Weave words across the cloth with your seven tiles, against one to three computer players.</p>
        <div class="gm-actions"><BaseButton variant="primary" @click="play('phone-weave')">Play Weave</BaseButton></div>
      </div>
    </section>
    <SectionTitle>With friends</SectionTitle>
    <BaseButton block @click="shell.open('tables')">Game tables near you</BaseButton>
    <p class="gm-note">A win against a real player is paid by the game; games against the computer and Oro pay nothing, but they count for your missions.</p>
  </div>
  <div v-else class="gm">
    <button class="gm-back" type="button" @click="back">‹ All games</button>
    <OroGame :key="screen" :mode="screen === 'daily' ? 'daily' : 'practice'" @close="back" @state="onState" />
  </div>
</template>

<style scoped>
.gm { display: grid; gap: var(--s-3); }
.gm-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gm-back { justify-self: start; background: none; border: 0; color: var(--c-muted); font: inherit; font-size: 12px; text-decoration: underline; min-height: var(--tap, 44px); cursor: pointer; }
.gm-card { display: grid; grid-template-columns: 40px 1fr; gap: 12px; background: #fff; border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 14px; }
.gm-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: color-mix(in srgb, var(--app-tint, #7a4fb0) 14%, #fff); color: var(--app-tint, #7a4fb0); }
.gm-body h3 { margin: 0 0 2px; font-size: 15px; }
.gm-body h3 small { font-weight: 400; font-size: 12px; color: var(--c-muted); margin-left: 4px; }
.gm-body p { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--c-ink-2); }
.gm-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.gm-actions .base-button { min-height: var(--tap, 44px); }
</style>
