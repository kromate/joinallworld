<script setup lang="ts">
// The Skills tab of the Sim sheet: ten segments per skill, and how far the next level is.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { cap } from '../../ui/format.ts'
import { SEGMENTS, skillRow } from './simModel.ts'

defineProps<{ params?: unknown }>()

const { game } = useApp()
const rows = computed(() => Object.entries(game.view.value.skills).map(([skill, info]) => ({ skill, level: info.level, ...skillRow(info) })))
</script>

<template>
  <div class="sim-skills">
    <div v-for="row in rows" :key="row.skill" class="sim-skill">
      <span><strong>{{ cap(row.skill) }}</strong><small>Level {{ row.level }}/{{ SEGMENTS }} · {{ row.detail }}</small></span>
      <div class="sim-segments" role="meter" :aria-label="`${cap(row.skill)} level`" aria-valuemin="0" :aria-valuemax="SEGMENTS" :aria-valuenow="row.level" :aria-valuetext="`Level ${row.level} of ${SEGMENTS}, ${row.detail}`"><i v-for="(fill, index) in row.segments" :key="index"><b :style="{ width: `${fill}%` }" /></i></div>
    </div>
    <p class="preview-note">Skills grow by doing related activities. Traits, your birth lottery outcome and perks change how fast.</p>
  </div>
</template>

<style scoped src="../../../ui/panels/sim.css"></style>
