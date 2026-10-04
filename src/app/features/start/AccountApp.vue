<script setup lang="ts">
// Landing: sign up / log in / continue / new life.
//
// Placeholder panel, registered but not opened by anything: the device-session flow (the landing
// screen, the nickname sheet) remains the only way in until an accounts design has been reviewed.
// To take over the entry flow later, give this panel `role: 'session-gate'` (register.ts) — the shell
// then opens it instead of the landing screen with params { reason: 'new' | 'expired' }.
</script>

<template>
  <div class="ui-placeholder"><h3>Account</h3><p>Accounts are not available yet. Your progress is saved to this device session.</p></div>
</template>
