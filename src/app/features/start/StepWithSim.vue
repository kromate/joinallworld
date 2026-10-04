<script setup lang="ts">
// A later step of settling in: the Sim stays beside the choices, as a small preview with the name
// and what they wear.
import type { Look } from '../../../types/life.ts'
import LookStage from './LookStage.vue'
import { lookSummary } from './lookModel.ts'

defineProps<{ look: Look; name: string }>()
</script>

<template>
  <div class="ob-with-sim">
    <aside class="ob-sim">
      <LookStage :look="look" variant="mini" :name="name" />
      <p><strong>{{ name }}</strong><small>{{ lookSummary(look) }}</small></p>
    </aside>
    <div class="ob-step"><slot /></div>
  </div>
</template>
