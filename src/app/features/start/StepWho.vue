<script setup lang="ts">
// Step 1, "Who are you?": a starting character from large cards, the body, a shuffle and a name. It
// changes nothing itself: the creator keeps the draft and the device.
import { computed } from 'vue'
import { nativeRecipeForLook } from '../../../character/native-migration.ts'
import { NATIVE_CHARACTER_CATALOG } from '../../../character/native-catalog.ts'
import type { Look } from '../../../types/life.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { PRESETS } from './startBoundary.ts'

const props = defineProps<{ look: Look; preset: string | null; name: string; error: string }>()
const emit = defineEmits<{ preset: [id: string]; body: [id: string]; shuffle: []; dice: []; name: [value: string]; submit: [] }>()
const body = computed(() => nativeRecipeForLook(props.look, 'who').appearance.body)
const label = (id: string): string => [...NATIVE_CHARACTER_CATALOG.hair, ...NATIVE_CHARACTER_CATALOG.garments].find((item) => item.id === id)?.label ?? id
const nativeOf = (look: Look) => nativeRecipeForLook(look, 'preset')
</script>

<template>
  <div class="cr-who">
    <fieldset class="cr-group">
      <legend>Choose a starting look</legend>
      <div class="cr-presets">
        <button v-for="item in PRESETS" :key="item.id" type="button" class="cr-preset" :data-qs-preset="item.id" :data-key="`preset:${item.id}`" :aria-pressed="preset === item.id" :aria-label="`${item.label}: ${label(nativeOf(item.look).appearance.hair)}, ${label(nativeOf(item.look).appearance.garments[0] ?? '')}`" @click="emit('preset', item.id)">
          <span class="cr-preset-swatches" aria-hidden="true">
            <i class="cr-preset-hair" :style="{ backgroundColor: nativeOf(item.look).appearance.colors.hair }" />
            <i class="cr-preset-outfit" :style="{ backgroundColor: nativeOf(item.look).appearance.colors.upper }" />
          </span>
          <span>{{ item.label }}</span>
          <small class="cr-preset-details">{{ label(nativeOf(item.look).appearance.hair) }} · {{ label(nativeOf(item.look).appearance.garments[0] ?? '') }}</small>
        </button>
      </div>
    </fieldset>
    <div class="cr-row">
      <div class="cr-body-choice">
        <span>Body</span>
        <div class="cr-seg" role="group" aria-label="Body">
          <button v-for="item in NATIVE_CHARACTER_CATALOG.bodies" :key="item.id" type="button" :data-qs-body="item.id" :data-key="`body:${item.id}`" :aria-pressed="body === item.id" @click="emit('body', item.id)">{{ item.label }}</button>
        </div>
      </div>
      <button type="button" class="cr-btn" data-qs="shuffle" data-key="shuffle" @click="emit('shuffle')"><GameIcon name="game" inline /> Surprise me</button>
    </div>
    <label class="cr-field">Your name
      <span class="cr-input">
        <input name="name" data-qs-name minlength="3" maxlength="24" autocomplete="nickname" autocapitalize="words" spellcheck="false" enterkeyhint="next" :value="name" :aria-invalid="error ? 'true' : undefined" @input="emit('name', ($event.target as HTMLInputElement).value)" @keydown.enter.prevent="emit('submit')">
        <button type="button" class="cr-icon" data-qs="dice" data-key="dice" aria-label="Suggest another name" title="Suggest another name" @click="emit('dice')"><GameIcon name="game" :size="22" /></button>
      </span>
    </label>
  </div>
</template>

<style scoped>
.cr-preset-swatches{display:flex;align-items:center;gap:4px;height:30px}
.cr-preset-swatches i{display:block;border:1px solid #ffffffd9;box-shadow:0 0 0 1px #10323d28}
.cr-preset-hair{width:15px;height:15px;border-radius:50%}
.cr-preset-outfit{width:28px;height:22px;border-radius:5px 5px 3px 3px}
.cr-preset-details{max-width:100%;color:#56717a;font-size:12px;line-height:1.25;text-align:left}
.cr-body-choice{display:grid;gap:6px;flex:1;min-width:180px;font-size:13px;font-weight:650;color:#56717a}
/* The row sits on the segment's bottom edge, and the button is the segment's height: the two line up, not the label. */
.cr-row{align-items:flex-end}
.cr-row>.cr-btn{min-height:54px}

</style>
