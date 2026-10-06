<script setup lang="ts">
// The landing's line for a short address, and "Find my city" (never asked for until it is tapped). The city is found on this device
// (findCity.ts): the position is never sent or stored.
import { computed, ref } from 'vue'
import type { PathIntent } from '../../../paths.ts'
import GameIcon from '../../ui/GameIcon.vue'
import type { CityFind } from './findCity.ts'
import { introFor, offersFind } from './pathIntroModel.ts'

const props = defineProps<{ intent: PathIntent | null; busy: boolean }>()
const emit = defineEmits<{ start: [city: string | null]; signup: []; login: [] }>()
const line = computed(() => introFor(props.intent))
const finder = computed(() => offersFind(props.intent))
const finding = ref(false)
const found = ref<CityFind | null>(null)

function press(): void {
  const current = line.value
  if (!current) return
  if (current.action === 'signup') emit('signup'); else if (current.action === 'login') emit('login'); else emit('start', current.city)
}
async function find(): Promise<void> {
  finding.value = true
  try { found.value = await (await import('./findCity.ts')).findCity() } finally { finding.value = false }
}
</script>

<template>
  <section v-if="line || finder" class="cr-path-intro" aria-label="Where to start" data-cr-path>
    <template v-if="line">
      <p class="cr-banner is-good" role="status"><span aria-hidden="true"><GameIcon name="pin" inline /></span><span><strong>{{ line.strong }}</strong> {{ line.text }}</span></p>
      <div class="cr-actions"><button type="button" class="cr-btn is-primary" data-key="path-start" :disabled="busy" @click="press">{{ line.button }}</button></div>
    </template>
    <template v-if="finder">
      <p v-if="found" class="cr-banner is-info" role="status" data-cr-found><span aria-hidden="true"><GameIcon name="pin" inline /></span><span>{{ found.line }}</span></p>
      <div v-if="found && found.kind !== 'none'" class="cr-actions"><button type="button" class="cr-btn is-primary" data-key="found-start" :disabled="busy" @click="emit('start', found.city)">Start in {{ found.name }}</button></div>
      <button v-if="!found || found.kind === 'none'" type="button" class="cr-link" data-key="find-city" :disabled="finding" @click="find">{{ finding ? 'Finding…' : 'Find my city' }}</button>
      <p v-if="!found" class="cr-note">Worked out on this device. Your position is never sent or stored.</p>
    </template>
  </section>
</template>
