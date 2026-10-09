<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import AppBar from '../../ui/AppBar.vue'
import PanelHost from './PanelHost.vue'
import type PhoneDeviceType from './PhoneDevice.vue'

defineProps<{ fullscreen: boolean; lockReason?: string }>()
const PhoneDevice = defineAsyncComponent(() => import('./PhoneDevice.vue'))
const SimSheet = defineAsyncComponent(() => import('../sim/SimSheet.vue'))
const HelpBody = defineAsyncComponent(() => import('../help/HelpBody.vue'))
const { shell } = useApp()
const sheet = shell.sheet
const inPhone = shell.inPhone
const panel = computed(() => (sheet.value?.kind === 'panel' ? shell.byId.get(sheet.value.id) ?? null : null))
const phone = ref<InstanceType<typeof PhoneDeviceType> | null>(null)
const content = ref<HTMLElement | null>(null)
function back(): boolean {
  if (!inPhone.value || !phone.value) return false
  phone.value.back()
  return true
}
defineExpose({ back })
watch(() => (sheet.value ? `${sheet.value.kind}:${sheet.value.kind === 'panel' ? sheet.value.id : sheet.value.kind === 'sim' ? sheet.value.tab : ''}` : ''), () => { void nextTick(() => { if (content.value) content.value.scrollTop = 0 }) })
</script>

<template>
  <div v-if="sheet" id="life-dialog-content" ref="content">
    <PhoneDevice v-if="inPhone" ref="phone" />
    <template v-else-if="sheet.kind === 'help'">
      <AppBar title="How to play" />
      <div class="sheet-body"><HelpBody /></div>
    </template>
    <SimSheet v-else-if="sheet.kind === 'sim'" :tab="sheet.tab" :params="sheet.params" />
    <PanelHost v-else-if="panel && fullscreen" :key="panel.id" class="sheet-fullscreen" :panel="panel" :params="sheet.kind === 'panel' ? sheet.params : null" />
    <template v-else-if="panel">
      <AppBar :title="panel.title" :back="sheet.kind === 'panel' && sheet.from === 'phone' ? 'Back to phone' : null" @back="shell.open('phone')" />
      <p v-if="lockReason" class="sheet-lock" role="note">🔒 {{ lockReason }}</p>
      <PanelHost :key="panel.id" class="sheet-body" :panel="panel" :params="sheet.kind === 'panel' ? sheet.params : null" />
    </template>
  </div>
</template>
