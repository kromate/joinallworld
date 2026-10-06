<script setup lang="ts">
// The few glyphs the call screens use, drawn inline so nothing is fetched.
defineProps<{ name: 'phone' | 'hangup' | 'mic' | 'mic-off' | 'speaker' }>()
</script>

<template>
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path v-if="name === 'phone'" d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z" />
    <path v-else-if="name === 'hangup'" transform="rotate(135 12 12)" d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z" />
    <path v-else-if="name === 'speaker'" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12z" />
    <template v-else>
      <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.93V21h2v-3.07A7 7 0 0019 11h-2z" />
      <path v-if="name === 'mic-off'" d="M4 4.5L5.5 3 21 18.5 19.5 20z" />
    </template>
  </svg>
</template>
