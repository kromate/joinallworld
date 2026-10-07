<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { newClientId } from '../social/useSocial.ts'
const emit = defineEmits<{ done: []; cancel: [] }>()
const { game } = useApp()
const consent = ref(false), busy = ref(false), started = ref(false), note = ref(''), sandbox = ref(false)
let reference = '', interval: ReturnType<typeof setInterval> | null = null, gone = false, reading = false
let connect: { setup(): void; open(): void; close?(): void } | null = null
let requestId = newClientId()
async function readResult(): Promise<void> {
  if (!reference || document.hidden || gone || reading) return
  reading = true
  try {
    const result = await game.fetchJson<{ status: string; environment: string }>(`/api/trust/id/result?ref=${encodeURIComponent(reference)}`)
    if (gone) return
    if (result.status === 'passed') { note.value = sandbox.value ? 'Sandbox check passed. No real badge was granted.' : 'Your ID and age check passed.'; if (interval) clearInterval(interval); if (!sandbox.value) emit('done') }
    else if (result.status === 'failed' || result.status === 'expired') { note.value = 'This check did not pass or has expired. Close it and start again.'; if (interval) clearInterval(interval) }
    else note.value = 'Waiting for the verified result from Dojah. You can return to the game and check again later.'
  } catch { if (!gone) note.value = 'The result could not be checked. Try again.' }
  finally { reading = false }
}
async function start(): Promise<void> {
  if (busy.value || !consent.value) return
  busy.value = true; note.value = ''
  try {
    const result = await game.fetchJson<{ ref: string; appId: string; publicKey: string; widgetId: string; environment: string }>('/api/trust/id/start', { method: 'POST', body: { clientId: requestId, consent: true } })
    if (gone) return
    reference = result.ref; sandbox.value = result.environment === 'sandbox'
    if (typeof Reflect.get(globalThis, 'Connect') !== 'function') await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script'), timer = setTimeout(() => { script.remove(); reject(Error('Verification could not load.')) }, 12000)
      script.src = 'https://widget.dojah.io/widget.js'; script.async = true
      script.onload = () => { clearTimeout(timer); resolve() }; script.onerror = () => { clearTimeout(timer); script.remove(); reject(Error('Verification could not load.')) }; document.head.append(script)
    })
    if (gone) return
    const Constructor: unknown = Reflect.get(globalThis, 'Connect')
    if (typeof Constructor !== 'function') throw Error('Verification could not load.')
    connect = Reflect.construct(Constructor, [{ app_id: result.appId, p_key: result.publicKey, type: 'custom', config: { widget_id: result.widgetId }, reference_id: reference,
      onSuccess: () => { void readResult() }, onClose: () => { void readResult() }, onError: () => { note.value = 'Dojah could not complete this check. Try again later.' } }]) as typeof connect
    connect?.setup(); connect?.open(); started.value = true
    interval = setInterval(() => { void readResult() }, 10000)
  } catch { note.value = 'ID verification could not start. Try again later.' }
  finally { busy.value = false }
}
onBeforeUnmount(() => { gone = true; if (interval) clearInterval(interval); connect?.close?.(); connect = null; reference = ''; requestId = '' })
</script>

<template>
  <section class="ui-card" aria-label="Verify your ID">
    <h3>Verify your ID</h3>
    <p>Dojah checks your ID, selfie and whether you are 18 or older. Enter those details only in Dojah's verification window. Allworld keeps the outcome and a check reference.</p>
    <label v-if="!started"><input v-model="consent" type="checkbox"> I agree to Dojah processing my identity information for this check.</label>
    <button v-if="!started" type="button" class="ui-button" :disabled="busy || !consent" @click="start">Open secure ID check</button>
    <p v-if="sandbox" class="ui-note">Sandbox verification. This will not grant a real badge.</p>
    <p v-if="note" role="status">{{ note }}</p>
    <button v-if="started" type="button" class="ui-button" @click="readResult">Check result</button>
    <button type="button" class="ui-button" :disabled="busy" @click="emit('cancel')">Back to trust settings</button>
  </section>
</template>
