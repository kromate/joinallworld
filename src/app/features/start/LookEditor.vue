<script setup lang="ts">
// The look editor: a row of tabs (Body, Hair, Outfit, Colours, Extras) and the open tab's options.
// It changes nothing itself: a tap on an option says `choose(field, value)` and the screen decides
// (it calls chooseLook with the wardrobe it wants). With `owned` (a wardrobe) styles not owned are
// disabled and say where to buy them.
import '../../../ui/panels/look-ui.css'
import { computed, defineAsyncComponent, h, ref } from 'vue'
import { APPEARANCE, BOUTIQUE_PRICES } from '../../../game/content/traits.ts'
import type { AvatarLook } from '../../../game/wardrobe/look.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { money } from '../../ui/format.ts'
import { SECTIONS, chosen, lookUi, openLookTab, optionsOf, swatchLabel, titled, worn } from './lookModel.ts'
import type { ChipsGroup, LookField, Owned, SwatchGroup } from './lookModel.ts'

const props = withDefaults(defineProps<{
  look: AvatarLook
  owned?: Owned | null
}>(), { owned: null })
const emit = defineEmits<{ choose: [field: LookField, value: string]; replace: [look: AvatarLook] }>()
const LayerControls = defineAsyncComponent({
  loader: () => import('./AvatarLayerControls.vue'),
  loadingComponent: { render: () => h('p', { role: 'status' }, 'Loading appearance options…') },
  errorComponent: { render: () => h('div', { role: 'alert' }, [
    h('p', 'Appearance options could not load. Check your connection, then reload. Unsaved choices will be reset.'),
    h('button', { type: 'button', class: 'ui-button', onClick: () => window.location.reload() }, 'Reload appearance options'),
  ]) },
  onError(_error, retry, fail, attempts) { if (attempts < 2) retry(); else fail() },
})
const appearanceOpen = ref(false)
const layered = computed(() => props.owned?.wearables !== undefined || props.look.wearables !== undefined || props.look.appearance !== undefined)
const sections = computed(() => layered.value ? [...SECTIONS, { id: 'layers', title: 'Layers', icon: 'boutique', focus: 'body', groups: [] }] : SECTIONS)
function openTab(id: string): void { if (id === 'layers') { lookUi.section = id; lookUi.lastField = 'body'; lookUi.zoomOverride = null } else openLookTab(id) }
function appearanceToggle(event: Event): void { appearanceOpen.value = event.target instanceof HTMLDetailsElement && event.target.open }

const current = computed(() => sections.value.find((item) => item.id === lookUi.section) ?? sections.value[0])
const carrying = computed(() => worn(props.look).length)

/** Why an option cannot be chosen: where to buy it. '' when it can. */
function lockedBecause(field: LookField, id: string): string {
  const owns = props.owned?.[field as keyof Owned] as readonly string[] | undefined
  if (!props.owned || !owns || owns.includes(id) || chosen(props.look, field, id)) return ''
  const prices = BOUTIQUE_PRICES[field as 'hair' | 'outfit' | 'fabric' | 'accessories']
  return `Boutique · ${money(prices?.[id])}`
}
const swatches = (group: SwatchGroup) => APPEARANCE[group]
const colourOf = (field: LookField): string => String(props.look[field as 'skin'] ?? '')
const chips = (group: ChipsGroup): string[] => optionsOf(group.field, props.look)
</script>

<template>
  <div v-if="current" class="look-editor">
    <div class="look-tabs" :style="{ '--look-tab-count': sections.length }" role="tablist" aria-label="What to change">
      <button v-for="item in sections" :id="`look-tab-${item.id}`" :key="item.id" type="button" role="tab" class="look-tab" :data-look-tab="item.id" :data-key="`tab:${item.id}`" :aria-selected="item.id === current.id" aria-controls="look-panel" @click="openTab(item.id)">
        <span aria-hidden="true"><GameIcon :name="item.icon" inline /></span>{{ item.title }}<b v-if="item.id === 'extras' && carrying">{{ carrying }}</b>
      </button>
    </div>
    <div id="look-panel" class="look-panel" role="tabpanel" :aria-labelledby="`look-tab-${current.id}`">
      <LayerControls v-if="current.id === 'layers'" :look="look" :owned="owned?.wearables ?? []" mode="layers" @replace="emit('replace', $event)" />
      <template v-for="group in current.groups" :key="group.field">
        <fieldset v-if="group.kind === 'chips'" class="look-group">
          <legend>{{ group.title }}</legend>
          <div class="look-chips">
            <button v-for="id in chips(group)" :key="id" type="button" class="look-chip" :data-look="group.field" :data-value="id" :data-key="`${group.field}:${id}`" :aria-pressed="chosen(look, group.field, id)" :disabled="Boolean(lockedBecause(group.field, id))" :title="lockedBecause(group.field, id) || undefined" @click="emit('choose', group.field, id)">{{ titled(id) }}<small v-if="lockedBecause(group.field, id)"><GameIcon name="lock" inline /> {{ lockedBecause(group.field, id) }}</small></button>
          </div>
        </fieldset>
        <fieldset v-else class="look-group">
          <legend>{{ group.title }} <b>{{ swatchLabel(group.group, colourOf(group.field)) }}</b></legend>
          <div class="look-swatches">
            <button v-for="swatch in swatches(group.group)" :key="swatch.id" type="button" class="look-swatch" :data-look="group.field" :data-value="swatch.id" :data-key="`${group.field}:${swatch.id}`" :aria-pressed="colourOf(group.field) === swatch.id" :aria-label="`${group.title}: ${swatch.label}`" :style="{ '--swatch': swatch.hex }" @click="emit('choose', group.field, swatch.id)"><i aria-hidden="true">{{ colourOf(group.field) === swatch.id ? '✓' : '' }}</i><span>{{ swatch.label }}</span></button>
          </div>
        </fieldset>
      </template>
      <details v-if="layered && current.id === 'body'" class="look-group" @toggle="appearanceToggle">
        <summary>Height, build and age appearance</summary>
        <LayerControls v-if="appearanceOpen" :look="look" :owned="owned?.wearables ?? []" mode="appearance" @replace="emit('replace', $event)" />
      </details>
    </div>
  </div>
</template>
