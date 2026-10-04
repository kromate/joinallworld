<script setup lang="ts">
// The "While you were away" card: a HUD alert shown once when a player returns after three hours
// or more, with at most five lines of what is waiting — a person first, then an invitation, then
// their Sim, then progress (src/game/digest.js). Each line opens the app it belongs to; the X
// dismisses the card for good. It states facts; nothing was taken while the player was gone.
// It draws from data already loaded (the growth hello) and asks for it, at most every five
// minutes, only once a connected player has settled in; for anyone else it draws nothing.
import { computed, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { social } from '../social/useSocial.ts'
import { notificationLines } from '../messages/messagesModel.ts'
import { noticeMarks } from '../messages/messagesState.ts'
import { awayCardFor, awayWanted } from './awayModel.ts'
import { useGrowth } from './useGrowth.ts'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const growth = useGrowth()
const view = game.view
const wanted = computed(() => awayWanted(view.value))
const card = computed(() => {
  void shell.legacyTick.value
  if (!wanted.value) return null
  const v = view.value
  const lines = notificationLines(social.me, { connected: v.connected, now: v.now, notices: v.social?.notices, seen: noticeMarks.seen(v.cityId) })
  return awayCardFor(v, growth.state.hello, growth.awayDismissed.value, lines)
})
watch(wanted, (ready) => { if (ready) void growth.load() }, { immediate: true })

function openLine(app: string | undefined, params: unknown): void {
  growth.dismissAway()
  shell.open(app || 'messages', params)
}
</script>

<template>
  <section v-if="card" class="gr-away is-active" :aria-label="card.title">
    <header>
      <div><b>{{ card.title }}</b><small>{{ card.sub }}</small></div>
      <button type="button" class="gr-x" aria-label="Dismiss" @click="growth.dismissAway()">×</button>
    </header>
    <ul>
      <li v-for="line in card.lines" :key="line.id"><button type="button" @click="openLine(line.app, line.params)">{{ line.text }}</button></li>
    </ul>
    <small v-if="card.more">and {{ card.more }} more in Messages</small>
  </section>
  <span v-else data-away-idle hidden />
</template>

<style scoped>
.gr-away { background: var(--c-surface-solid, #fff); border-radius: 18px; box-shadow: var(--e-2), var(--ring); padding: 12px 14px; display: grid; gap: 6px; max-width: 420px; pointer-events: auto; }
.gr-away header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.gr-away header b { font-size: 14px; }
.gr-away small { display: block; color: var(--c-muted); font-size: 12px; }
.gr-away button.gr-x { background: none; border: 0; min-width: var(--tap, 44px); min-height: var(--tap, 44px); font-size: 20px; line-height: 1; color: var(--c-muted); cursor: pointer; margin: -8px -10px 0 0; }
.gr-away ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.gr-away li button { width: 100%; text-align: left; background: var(--c-fill); border: 0; border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; min-height: 36px; cursor: pointer; color: var(--c-ink); }
.gr-away button:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
