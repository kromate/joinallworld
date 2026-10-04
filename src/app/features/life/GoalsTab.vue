<script setup lang="ts">
// The Goals tab of the Sim sheet (also a Phone app): current starter goal, lifetime dream, wishes,
// stars and perks. The goal chip in the HUD is goalChip. All rules live in
// src/game/systems/goals.ts; this draws view.goals.
import { computed } from 'vue'
import type { DreamId, PerkId } from '../../../types/life.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import GlyphText from '../kit/GlyphText.vue'
import { useAct } from '../kit/act.ts'
import { loanLine, offlineWhy, perkReason, perkState, rerollLine, rerollReason, wishProgress } from './goalsModel.ts'

defineProps<{ params?: unknown }>()

const { game, shell, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const goals = computed(() => view.value.goals)
const offline = computed(() => offlineWhy(view.value.connected, linkWords(view.value)?.short))
const loan = computed(() => loanLine(view.value.economy?.loan))
const rerolls = computed(() => goals.value.rerolls)
const wishWhy = computed(() => rerollReason(offline.value, rerolls.value.blocked))
const wait = computed(() => pending.value !== null)

const setDream = (dream: DreamId): Promise<boolean> => act(`dream:${dream}`, () => command('goals.set-dream', { dream }))
const reroll = (slot: number): Promise<boolean> => act(`reroll:${slot}`, () => command('goals.reroll-wish', { slot }))
const buyPerk = (id: PerkId): Promise<boolean> => act(`perk:${id}`, () => command('goals.buy-perk', { id }))
</script>

<template>
  <div class="goals-root">
    <p class="goals-stars"><b><GameIcon inline name="star" /> {{ goals.stars }}</b> {{ goals.stars === 1 ? 'star' : 'stars' }} · goals give +1, wishes +3</p>

    <section v-if="goals.chain.current" class="goals-current">
      <h3><GameIcon inline kind="goal" :id="goals.chain.current.id" :emoji="goals.chain.current.icon" /> {{ goals.chain.current.title }}</h3>
      <p>{{ goals.chain.current.hint }}</p>
      <p class="goals-dream-meta">Starter goal {{ goals.chain.index + 1 }} of {{ goals.chain.total }} · reward {{ money(goals.chain.current.cash) }} and {{ goals.chain.current.stars }} <GameIcon inline name="star" /></p>
    </section>
    <section v-else class="goals-current">
      <h3><GameIcon inline kind="goal" :id="goals.chip.kind === 'goal' ? goals.chip.id : undefined" :emoji="goals.chip.icon" /> {{ goals.chip.title }}</h3>
      <p><GlyphText :text="goals.chip.hint" /></p>
      <p class="goals-dream-meta">{{ goals.chain.finished ? 'Starter goals complete. ' : '' }}Your next step.</p>
    </section>

    <section v-if="!goals.dream" class="goals-dream">
      <h3>Lifetime dream</h3>
      <p>This life has no dream yet. Choose one — it is picked once.</p>
      <div class="goals-dream-pick">
        <button v-for="item in goals.dreams" :key="item.id" type="button" class="ui-button" :disabled="Boolean(offline) || wait" :title="offline || undefined" @click="setDream(item.id)"><GameIcon inline kind="dream" :id="item.id" :emoji="item.icon" /> {{ item.label }}<small>{{ item.goal }}</small></button>
      </div>
      <p v-if="offline" class="goals-why">{{ offline }}</p>
    </section>
    <section v-else class="goals-dream">
      <h3><GameIcon inline kind="dream" :id="goals.dream.id" :emoji="goals.dream.icon" /> {{ goals.dream.label }}{{ goals.dream.done ? ' · achieved' : '' }}</h3>
      <p>{{ goals.dream.goal }}</p>
      <div class="goals-bar" role="meter" aria-label="Dream progress" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="goals.dream.percent"><i :style="{ width: `${goals.dream.percent}%` }" /></div>
      <p class="goals-dream-meta"><b>{{ goals.dream.percent }}%</b> · {{ goals.dream.measure }}</p>
      <p class="goals-dream-meta">{{ goals.dream.done ? 'Reward paid' : 'Reward' }}: {{ money(goals.dream.reward.cash) }} and {{ goals.dream.reward.stars }} <GameIcon inline name="star" /> (original beta values).</p>
    </section>

    <section v-if="loan" class="goals-loan">
      <h3><GameIcon inline name="statement" /> {{ loan.label }}</h3>
      <p><b>{{ money(loan.left) }}</b> left<template v-if="loan.weekly"> · {{ money(loan.weekly) }} a week</template></p>
      <button type="button" class="ui-button" @click="shell.open('bank')">Pay in Bank</button>
    </section>

    <section>
      <h3>Wishes</h3>
      <ul v-if="goals.wishes.length" class="goals-wishes">
        <li v-for="wish in goals.wishes" :key="wish.slot" class="goals-wish">
          <span class="goals-wish-icon" aria-hidden="true"><GameIcon inline kind="wish" :id="wish.id" :emoji="wish.icon" /></span>
          <div>
            <strong>{{ wish.label }}</strong><small>{{ wish.hint }}</small>
            <small v-if="wishProgress(wish, money)" class="goals-progress">{{ wishProgress(wish, money) }}</small>
          </div>
          <b>+{{ wish.stars }} <GameIcon inline name="star" /></b>
          <button type="button" class="goals-reroll" :aria-label="`Re-roll wish: ${wish.label}`" :disabled="Boolean(wishWhy) || wait" :title="wishWhy || 'Swap this wish for another'" @click="reroll(wish.slot)"><GameIcon inline name="refresh" /></button>
        </li>
      </ul>
      <p v-else class="preview-note">No wishes are available right now. New ones appear as the city grows.</p>
      <p class="goals-why">{{ rerollLine(wishWhy, rerolls) }}</p>
    </section>

    <section>
      <h3>Perks</h3>
      <div class="goals-perks">
        <article v-for="perk in goals.perks" :key="perk.id" class="goals-perk" :class="perkState(perk, perkReason(perk, offline))">
          <span class="goals-perk-icon" aria-hidden="true"><GameIcon inline kind="perk" :id="perk.id" :emoji="perk.icon" /></span>
          <strong>{{ perk.label }}</strong>
          <small>{{ perk.effect }}{{ perk.beta ? ' · Original' : '' }}</small>
          <em v-if="perk.owned" class="goals-owned"><GameIcon inline name="check" /> Owned</em>
          <template v-else>
            <button type="button" class="ui-button" :class="{ 'is-primary': !perkReason(perk, offline) }" :disabled="Boolean(perkReason(perk, offline)) || wait" @click="buyPerk(perk.id)">Unlock · {{ perk.cost }} <GameIcon inline name="star" /></button>
            <small v-if="perkReason(perk, offline)" class="goals-why"><GlyphText :text="perkReason(perk, offline)" /></small>
          </template>
        </article>
      </div>
      <p class="preview-note">Perks last for this whole life. Perks marked Original are beta additions of our own.</p>
    </section>
  </div>
</template>

<style scoped src="../../../ui/panels/goals.css"></style>
