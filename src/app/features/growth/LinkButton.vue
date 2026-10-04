<script setup lang="ts">
// An ordinary link that looks like a button: opened in a new tab (or downloaded), with nothing
// sent from the game. Used for the WhatsApp Channel, the share sheet's WhatsApp / X / Save picture
// and the e-mail confirmation page. `href` is whatever the caller has already checked.
withDefaults(defineProps<{ href: string; variant?: 'default' | 'primary'; block?: boolean; download?: string; sameTab?: boolean }>(), { variant: 'default', block: false, download: undefined, sameTab: false })
</script>

<template>
  <a class="link-button" :class="[`is-${variant}`, { 'is-block': block }]" :href="href" :download="download" :target="download || sameTab ? undefined : '_blank'" :rel="download || sameTab ? undefined : 'noopener noreferrer'"><slot /></a>
</template>

<style scoped>
.link-button { display: inline-grid; place-items: center; box-sizing: border-box; border: 0; background: var(--c-fill); color: var(--c-ink); border-radius: var(--r-pill); padding: 10px 18px; min-height: var(--tap, 44px); font: 600 13px var(--font); text-align: center; text-decoration: none; cursor: pointer; }
.link-button:hover { filter: brightness(.96); }
.link-button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.link-button.is-primary { background: var(--c-green-dark); color: #fff; }
.link-button.is-block { display: grid; width: 100%; }
</style>
