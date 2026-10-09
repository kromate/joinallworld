<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, ref, type Component } from 'vue'
import { useApp } from '../../state/app.ts'
import type { PanelExposed } from '../../types/panel.ts'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ params?: unknown }>()
const { shell } = useApp()
const child = ref<PanelExposed | null>(null)
const driving = defineAsyncComponent(() => import('./DrivingApp.vue'))
const barber = defineAsyncComponent(() => import('./BarberApp.vue'))
const clerk = defineAsyncComponent(() => import('./ClerkApp.vue'))
const unavailable: Component = defineComponent({
  name: 'PracticeGatewayUnavailable',
  setup: () => () => null,
})
const activeId = computed(() => shell.showing()?.id ?? null)
const practiceView = computed<Component>(() => {
  switch (activeId.value) {
    case 'driving-practice': return driving
    case 'barber-practice': return barber
    case 'clerk-practice': return clerk
    default: return unavailable
  }
})

defineExpose({
  keys: (action: string): boolean => child.value?.keys?.(action) === true,
})
</script>

<template>
  <component
    :is="practiceView"
    :key="activeId ?? 'unavailable'"
    ref="child"
    v-bind="$attrs"
    :params="props.params"
  />
</template>
