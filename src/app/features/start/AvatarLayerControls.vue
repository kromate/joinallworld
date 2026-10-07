<script setup lang="ts">
import { computed } from 'vue'
import { AVATAR_WEARABLE_IDS, normalizeAvatarAppearance } from '../../../types/avatar.ts'
import type { AvatarAppearance, AvatarWearableId } from '../../../types/avatar.ts'
import { AVATAR_WEARABLES } from '../../../scene/wardrobe/catalogue.ts'
import type { AvatarWearableSlot } from '../../../scene/wardrobe/catalogue.ts'
import { AVATAR_WEARABLE_PRICES } from '../../../scene/wardrobe/prices.ts'
import { money } from '../../ui/format.ts'
import { chooseAvatarAppearance, chooseAvatarWearable } from '../../../scene/wardrobe/look.ts'
import type { AvatarLook } from '../../../scene/wardrobe/look.ts'

const props = defineProps<{ look: AvatarLook; owned: readonly AvatarWearableId[]; mode: 'layers' | 'appearance' }>()
const emit = defineEmits<{ replace: [look: AvatarLook] }>()
const worn = computed(() => props.look.wearables ?? [])
const appearance = computed(() => normalizeAvatarAppearance(props.look.appearance))
const sections: { slot: AvatarWearableSlot; label: string }[] = [
  { slot: 'head', label: 'Head coverings' }, { slot: 'full', label: 'Full outfits' },
  { slot: 'neck', label: 'Scarves and necklaces' }, { slot: 'wrist', label: 'Wristwear' },
  { slot: 'shoes', label: 'Footwear' },
]
const groups = sections.map(section => ({ ...section, ids: AVATAR_WEARABLE_IDS.filter(id => AVATAR_WEARABLES[id].slot === section.slot) }))
const shapes: { field: keyof AvatarAppearance; label: string; options: { id: string; label: string }[] }[] = [
  { field: 'height', label: 'Height', options: [{ id: 'short', label: 'Short' }, { id: 'average', label: 'Average' }, { id: 'tall', label: 'Tall' }] },
  { field: 'build', label: 'Build', options: [{ id: 'slim', label: 'Slim' }, { id: 'average', label: 'Average' }, { id: 'broad', label: 'Broad' }] },
  { field: 'ageAppearance', label: 'Age appearance', options: [{ id: 'adult', label: 'Adult' }, { id: 'mature', label: 'Mature' }, { id: 'elder', label: 'Elder' }] },
]
function choose(id: AvatarWearableId): void {
  if (props.owned.includes(id) || worn.value.includes(id)) emit('replace', chooseAvatarWearable(props.look, id))
}
</script>

<template>
  <div v-if="mode === 'layers'" class="avatar-layers">
    <p class="layer-help">Choose one item in each group. Tap a worn item to take it off. Glasses, earrings and bags are in Extras.</p>
    <fieldset v-for="group in groups" :key="group.slot" class="look-group">
      <legend>{{ group.label }}</legend>
      <div class="look-chips">
        <button v-for="id in group.ids" :key="id" type="button" class="look-chip" :aria-pressed="worn.includes(id)" :disabled="!owned.includes(id) && !worn.includes(id)" @click="choose(id)">
          {{ AVATAR_WEARABLES[id].label }}
          <small v-if="!owned.includes(id) && !worn.includes(id)">Boutique · {{ money(AVATAR_WEARABLE_PRICES[id]) }}</small>
        </button>
      </div>
    </fieldset>
  </div>
  <div v-else>
    <fieldset v-for="group in shapes" :key="group.field" class="look-group">
      <legend>{{ group.label }}</legend>
      <div class="look-chips">
        <button v-for="option in group.options" :key="option.id" type="button" class="look-chip" :aria-pressed="appearance[group.field] === option.id" @click="emit('replace', chooseAvatarAppearance(look, group.field, option.id))">{{ option.label }}</button>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.layer-help { margin: 0 0 1rem; line-height: 1.5; }
</style>
