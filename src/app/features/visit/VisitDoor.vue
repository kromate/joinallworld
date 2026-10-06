<script setup lang="ts">
// "Who can come into my home": Friends walk in, Friends knock first, Only people I invite, Nobody — and the separate switch
// "Friends can visit while I am out" (off unless chosen). Used on the Home tab and in Settings. The server holds the choice and
// applies the rules that hold whatever it says (src/game/visit.ts, server/social/visit.ts).
import '../../../ui/controls.css'
import { computed, ref } from 'vue'
import { DOOR_CHOICES } from '../../../game/visit.ts'
import type { DoorWho } from '../../../game/visit.ts'
import { social } from '../social/useSocial.ts'
import { chooseDoor } from './visitStore.ts'

const door = computed(() => social.me?.door ?? { who: 'knock' as DoorWho, out: false, chosen: false })
const problem = ref<string | null>(null)
const busy = ref(false)
async function pick(who: DoorWho): Promise<void> { busy.value = true; problem.value = await chooseDoor(who); busy.value = false }
async function away(out: boolean): Promise<void> { busy.value = true; problem.value = await chooseDoor(undefined, out); busy.value = false }
</script>

<template>
  <section v-if="social.me" class="visit-door" aria-labelledby="visit-door-title" data-visit="door">
    <h3 id="visit-door-title" class="ui-section">Who can come into my home</h3>
    <div class="ui-rows" role="radiogroup" aria-labelledby="visit-door-title">
      <label v-for="choice in DOOR_CHOICES" :key="choice.id" class="ui-row visit-choice" :class="{ 'is-on': door.who === choice.id && door.chosen }">
        <span class="ui-row-body"><b>{{ choice.label }}</b><small>{{ choice.hint }}</small></span>
        <input type="radio" name="visit-door" :value="choice.id" :checked="door.who === choice.id" :disabled="busy" :data-door="choice.id" @change="pick(choice.id)">
      </label>
    </div>
    <label class="ui-row settings-row visit-out" :class="{ 'is-off': door.who !== 'walk' }">
      <span class="ui-row-body"><b>Friends can visit while I am out</b><small>Off by default: nobody is let into an empty home unless you turn this on. Links and invitations always need you home.</small></span>
      <span class="settings-state">{{ door.out ? 'On' : 'Off' }}</span>
      <input type="checkbox" role="switch" aria-label="Friends can visit while I am out" data-door="out" :checked="door.out" :disabled="busy || door.who !== 'walk'" @change="away(($event.target as HTMLInputElement).checked)"><i class="ui-switch" aria-hidden="true" />
    </label>
    <p v-if="problem" class="ui-error" role="alert">{{ problem }}</p>
  </section>
</template>

<style scoped>
.visit-choice input { width: 22px; height: 22px; flex: none; }
.visit-choice.is-on b { color: var(--c-green-dark); }
.visit-out.is-off { opacity: .6; }
</style>
