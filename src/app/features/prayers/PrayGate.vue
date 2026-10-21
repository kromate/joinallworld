<script setup lang="ts">
// Decides whether this venue is a place of worship (a church, a mosque, a shrine: faiths are treated alike) and only then fetches the Pray panel.
// It is fetched by the venue's activity rail, so none of it is in the first download.
import { computed, defineAsyncComponent } from 'vue'
import { cachedCityContent } from '../../../game/cities/registry.ts'
import { useApp } from '../../state/app.ts'
import { isWorship } from './prayModel.ts'

const PrayRow = defineAsyncComponent(() => import('./PrayRow.vue'))
const { game } = useApp()
const worship = computed(() => isWorship(cachedCityContent(game.view.value.cityId)?.venues.find(item => item.id === game.state.value.location)?.kind))
</script>

<template>
  <PrayRow v-if="worship" />
</template>
