<script setup lang="ts">
// The select of the control kit as a component (src/ui/controls.js): a button that opens a
// listbox in the game's own style, with the same keys.
//
// KEYBOARD  on the button: Enter, Space, ↓ or ↑ open. In the list: ↑ ↓ move, Home / End jump,
// typing letters goes to the next option that starts with them, Enter or Space chooses, Escape
// closes without choosing, Tab closes and moves on. Focus stays on the button (role="combobox",
// aria-activedescendant names the active option, aria-selected the chosen one), which is the
// pattern screen readers announce correctly. While the list is open its keys never reach the
// game's shortcuts.
//
// On a small touch screen (coarse pointer, at most 720px wide) the platform's own picker is the
// better control, so there a plain <select> is drawn instead, styled like every other field.
//
// The list is placed once when it opens (inside the dialog when there is one, so that it is above
// it) and closed by a scroll, a resize, a press elsewhere, or the component going away. Nothing
// here keeps time.
import { nextTick, onBeforeUnmount, ref, useId } from 'vue'
import { keepsNative, listboxKey, nextEnabled, opensList, typeAhead } from './listboxModel.ts'
import type { ListboxOption } from './listboxModel.ts'

const model = defineModel<string>({ required: true })
const props = withDefaults(defineProps<{
  options: readonly ListboxOption[]
  /** The accessible name of the control. */
  label: string
  disabled?: boolean
}>(), { disabled: false })

const native = keepsNative()
const id = `ui-select-${useId()}`
const button = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLUListElement | null>(null)
const open = ref(false)
const active = ref(-1)
const host = ref<HTMLElement | null>(null)
let typed = ''
let typedAt = 0
let detach: (() => void) | null = null

const selectedIndex = (): number => props.options.findIndex((option) => option.value === model.value)
const chosen = (): ListboxOption | undefined => props.options[selectedIndex()]
const optionId = (index: number): string => `${id}-${index}`

function close(focus = false): void {
  if (!open.value) return
  open.value = false
  active.value = -1
  detach?.()
  detach = null
  if (focus) button.value?.focus()
}

function mark(index: number): void {
  active.value = index
  void nextTick(() => list.value?.children[index]?.scrollIntoView({ block: 'nearest' }))
}

async function show(start?: number): Promise<void> {
  const trigger = button.value
  if (!trigger || props.disabled) return
  // In a modal sheet the list must live inside the dialog to be above it.
  host.value = trigger.closest('dialog') ?? document.body
  open.value = true
  mark(start ?? Math.max(0, selectedIndex()))
  await nextTick()
  const box = trigger.getBoundingClientRect()
  const element = list.value
  if (!element) return
  const tall = Math.min(element.scrollHeight + 2, 320, window.innerHeight * 0.46)
  const below = window.innerHeight - box.bottom - 12
  const up = below < Math.min(tall, 180) && box.top > below
  element.style.left = `${Math.round(box.left)}px`
  element.style.width = `${Math.round(box.width)}px`
  element.style.maxHeight = `${Math.round(Math.max(120, Math.min(tall, up ? box.top - 12 : below)))}px`
  if (up) element.style.bottom = `${Math.round(window.innerHeight - box.top + 6)}px`
  else element.style.top = `${Math.round(box.bottom + 6)}px`
  const outside = (event: Event): void => {
    const target = event.target instanceof Node ? event.target : null
    if (target && !element.contains(target) && !trigger.contains(target)) close()
  }
  const away = (event: Event): void => { if (!(event.target instanceof Node && element.contains(event.target))) close() }
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('scroll', away, true)
  window.addEventListener('resize', away)
  detach = () => {
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('scroll', away, true)
    window.removeEventListener('resize', away)
  }
}

function choose(index: number): void {
  const option = props.options[index]
  if (!option || option.disabled) return
  const changed = option.value !== model.value
  close(true)
  if (changed) model.value = option.value
}

function onClick(): void { if (open.value) close(); else void show() }
function onKeydown(event: KeyboardEvent): void {
  if (!open.value) {
    if (opensList(event.key)) { event.preventDefault(); void show() }
    return
  }
  // While the list is open its keys are its own: they never reach the game's shortcuts.
  event.stopPropagation()
  const action = listboxKey(event)
  if (action === 'close') { event.preventDefault(); close(true) }
  else if (action === 'next') { event.preventDefault(); mark(nextEnabled(props.options, active.value, 1)) }
  else if (action === 'previous') { event.preventDefault(); mark(nextEnabled(props.options, active.value, -1)) }
  else if (action === 'first') { event.preventDefault(); mark(nextEnabled(props.options, -1, 1)) }
  else if (action === 'last') { event.preventDefault(); mark(nextEnabled(props.options, props.options.length, -1)) }
  else if (action === 'choose') { event.preventDefault(); choose(active.value) }
  else if (action === 'leave') close()
  else if (action === 'type') {
    const at = Date.now()
    typed = at - typedAt > 700 ? event.key : typed + event.key
    typedAt = at
    mark(typeAhead(props.options, typed.length > 1 ? active.value - 1 : active.value, typed))
  }
}
const optionOf = (event: Event): number => {
  const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[role=option]') : null
  return item ? Number(item.dataset.index) : -1
}
function onListClick(event: MouseEvent): void { const index = optionOf(event); if (index >= 0) choose(index) }
function onListMove(event: PointerEvent): void { const index = optionOf(event); if (index >= 0 && index !== active.value) mark(index) }
function onNative(event: Event): void { if (event.target instanceof HTMLSelectElement) model.value = event.target.value }

onBeforeUnmount(() => { detach?.(); detach = null })
defineExpose({ focus: (): void => { button.value?.focus() } })
</script>

<template>
  <select v-if="native" :value="model" :aria-label="label" :disabled="disabled" @change="onNative">
    <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option>
  </select>
  <template v-else>
    <button
      ref="button" type="button" class="ui-select" :class="{ 'is-empty': !chosen() || chosen()?.value === '' }" role="combobox"
      aria-haspopup="listbox" :aria-expanded="open" :aria-controls="id" :aria-label="label"
      :aria-activedescendant="open && active >= 0 ? optionId(active) : undefined" :disabled="disabled" @click="onClick" @keydown="onKeydown" @blur="close()"
    >
      <span>{{ chosen()?.label ?? '' }}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <Teleport v-if="open && host" :to="host">
      <ul :id="id" ref="list" class="ui-listbox" role="listbox" :aria-label="label" @pointerdown.prevent @click="onListClick" @pointermove="onListMove">
        <li v-for="(option, index) in options" :id="optionId(index)" :key="option.value" :data-index="index" role="option" :class="{ 'is-active': index === active }" :aria-selected="index === selectedIndex()" :aria-disabled="option.disabled ? 'true' : undefined">{{ option.label }}</li>
      </ul>
    </Teleport>
  </template>
</template>
