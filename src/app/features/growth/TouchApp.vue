<script setup lang="ts">
// Stay in touch: the Phone app where a player decides whether the game may reach them outside the
// game, and reads exactly what it would say. The age question comes first; under 18, no outside
// message is offered at all. Every channel is off until the player turns it on — notifications by
// the browser's own permission, e-mail by a consent tick and a confirmation link — and one tap
// turns each off again and deletes what was stored for it.
// Rules: server/growth/outreach.ts and src/game/outreach.ts; the words: src/game/digest.ts.
//
// The form is bound to a draft kept for the page (touchState.ts), so a state update never touches
// what is being typed. The control that was pressed says so until the server answers.
import { computed, nextTick, onMounted, ref } from 'vue'
import type { ComebackView, ConsentResult, EmailResult } from '../../../types/growth.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import BaseButton from '../../ui/BaseButton.vue'
import HeroCard from '../../ui/HeroCard.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import DigestPreview from './DigestPreview.vue'
import LinkButton from './LinkButton.vue'
import { EMAIL_CONSENT, PUSH_CONSENT, loadPushModule } from './boundary.ts'
import { COMEBACK_ACCOUNT_SENTENCE, COMEBACK_SENTENCE, WEEKLY_RULES, ageCard, devicesLine, emailCard, emailDisabled, emailReason, emailSavedWords, pushCard, pushDeclinedWords, showsChannels } from './touchModel.ts'
import ComebackSwitches from './ComebackSwitches.vue'
import { pushKind, touch } from './touchState.ts'
import { useGrowth } from './useGrowth.ts'

defineProps<{ params?: unknown }>()
const { game } = useApp()
const growth = useGrowth()
const view = game.view
const hello = computed(() => growth.state.hello)
const why = computed(() => linkWords(view.value)?.why ?? '')
const address = computed(() => touch.email.trim())
const sendReason = computed(() => emailReason({ busy: touch.busy === 'email', tick: touch.tick, email: address.value }))
const root = ref<HTMLElement | null>(null)

onMounted(() => {
  void growth.load()
  if (pushKind.value === null) void loadPushModule().then((module) => { pushKind.value = module.pushState() })
})

/** After a card changed, the control that was pressed may be gone: focus goes to the cards, not to nothing. */
async function settle(): Promise<void> {
  touch.busy = null
  await growth.load({ force: true })
  await nextTick()
  const active = document.activeElement
  if (!active || active === document.body || !root.value?.contains(active)) root.value?.querySelector<HTMLElement>('[data-cards]')?.focus()
}

async function saveAge(age: 'adult' | 'minor'): Promise<void> {
  if (touch.busy) return
  touch.busy = 'age'
  const result = await growth.call<ConsentResult>('/api/growth/consent', { age })
  touch.busy = null
  if ('consent' in result && result.consent) growth.setConsent(result.consent)
  // The one stored answer is announced: analytics follows it (under 18 → off) as e-mail and push do.
  growth.announceAge('consent' in result ? result.consent?.age : undefined)
  if (!result.ok && result.code !== 'under_18') game.toast(result.reason || 'That could not be saved.', 'error')
  await nextTick()
  root.value?.querySelector<HTMLElement>('[data-cards]')?.focus()
}

async function switchPushOn(): Promise<void> {
  if (touch.busy) return
  touch.busy = 'push'
  const key = await growth.call<{ ok: true; publicKey: string }>('/api/growth/push/key')
  const outcome = key.ok ? await (await loadPushModule()).enablePush(key.publicKey) : { ok: false as const, code: 'failed' as const }
  if (outcome.ok) {
    const saved = await growth.call<{ ok: true }>('/api/growth/push/subscribe', { subscription: outcome.subscription, consent: true })
    if (saved.ok) { growth.track('push_prompt_accepted'); game.toast('Notifications are on for this phone.', 'good') } else game.toast(saved.reason || 'That could not be saved.', 'error')
  } else {
    growth.track('push_prompt_declined')
    if (outcome.code === 'blocked') pushKind.value = 'blocked'
    game.toast(pushDeclinedWords(outcome.code), 'info')
  }
  touch.pushAsk = false
  await settle()
}
async function switchPushOff(): Promise<void> {
  if (touch.busy) return
  touch.busy = 'push'
  await (await loadPushModule()).disablePush()
  await growth.call('/api/growth/push/unsubscribe', {})
  growth.track('unsubscribed', { channel: 'push' })
  game.toast('Notifications are off. This phone’s subscription was deleted.', 'good')
  await settle()
}
async function askEmail(): Promise<void> {
  if (touch.busy || emailDisabled({ busy: false, tick: touch.tick, email: address.value })) return
  touch.busy = 'email'
  // The e-mail route takes no cityId: it is POSTed as it is.
  const result = await growth.call<EmailResult>('/api/growth/email', { email: address.value, consent: touch.tick })
  if (result.ok) {
    growth.track('email_optin_started')
    touch.note = result; touch.email = ''; touch.tick = false
    game.toast(emailSavedWords('dryRun' in result && result.dryRun === true), 'good')
  } else game.toast(result.reason || 'That address was not accepted.', 'error')
  await settle()
}
const comeback = computed<ComebackView | null>(() => hello.value?.contact.comeback ?? null)
async function removeEmail(): Promise<void> {
  if (touch.busy) return
  touch.busy = 'email'
  await growth.call('/api/growth/email/remove', {})
  touch.note = null
  growth.track('unsubscribed', { channel: 'email' })
  game.toast('Your address was deleted. No more e-mails.', 'good')
  await settle()
}
</script>

<template>
  <div ref="root" class="touch">
    <p v-if="!view.connected" class="gr-note">{{ why }}</p>
    <p v-else-if="!hello" class="gr-note" role="status">{{ growth.state.error ?? 'Loading…' }}</p>
    <template v-else>
      <HeroCard label="Stay in touch" figure="Only if you ask">The game never contacts you outside the game unless you ask: here, or when you make an account, which says so. Every switch is here, and one tap turns it off.</HeroCard>

      <div data-cards tabindex="-1" class="gr-cards">
        <div v-if="ageCard(hello.consent) === 'ask'" class="gr-card">
          <h3>First, how old are you?</h3>
          <p>Messages outside the game are only for players who are 18 or older. Your answer is kept with this life and shown to nobody.</p>
          <BaseButton variant="primary" :disabled="touch.busy !== null" @click="saveAge('adult')">{{ touch.busy === 'age' ? 'Saving…' : 'I am 18 or older' }}</BaseButton>
          <BaseButton :disabled="touch.busy !== null" @click="saveAge('minor')">I am under 18</BaseButton>
        </div>
        <div v-else-if="ageCard(hello.consent) === 'minor'" class="gr-card">
          <h3>You are all set</h3>
          <p>You told us you are under 18, so the game will never message you outside the game. Everything inside it works the same: Updates, Missions and Events are right here on your Phone.</p>
        </div>

        <!-- An account's verified address is where the character's e-mails go, whatever was said about Stay in touch. -->
        <div v-if="comeback && comeback.source === 'account'" class="gr-card" data-account-mail>
          <h3>E-mails about your character</h3>
          <p>They go to <b>{{ comeback.address }}</b>, the address of your account. At most one a day and three a week. {{ COMEBACK_ACCOUNT_SENTENCE }}</p>
          <ComebackSwitches :view="comeback" />
        </div>

        <template v-if="showsChannels(hello.consent)">
          <!-- Notifications -->
          <div v-if="pushCard(hello.consent, pushKind, touch.pushAsk) === 'on'" class="gr-card">
            <h3>Notifications are on</h3>
            <p>{{ devicesLine(hello.contact.push.devices) }}</p>
            <BaseButton :disabled="touch.busy === 'push'" @click="switchPushOff">{{ touch.busy === 'push' ? 'Working…' : 'Switch off' }}</BaseButton>
          </div>
          <div v-else-if="pushCard(hello.consent, pushKind, touch.pushAsk) === 'needs-install'" class="gr-card">
            <h3>Notifications on iPhone and iPad</h3>
            <p>Apple only allows them for a game added to the Home Screen. In Safari, tap Share, then “Add to Home Screen”, open Allworld from there and come back to this screen.</p>
          </div>
          <div v-else-if="pushCard(hello.consent, pushKind, touch.pushAsk) === 'unsupported'" class="gr-card">
            <h3>Notifications</h3>
            <p>This browser cannot receive them. Chrome on Android can.</p>
          </div>
          <div v-else-if="pushCard(hello.consent, pushKind, touch.pushAsk) === 'blocked'" class="gr-card">
            <h3>Notifications are blocked</h3>
            <p>This browser was told not to allow notifications from the game. You can change that in the browser’s site settings; the game cannot ask again.</p>
          </div>
          <div v-else-if="pushCard(hello.consent, pushKind, touch.pushAsk) === 'intro'" class="gr-card">
            <h3>Notifications on this phone</h3>
            <p>A short note when someone is looking for you or something is on, even when the game is closed.</p>
            <BaseButton variant="primary" @click="touch.pushAsk = true; growth.track('push_prompt_shown')">Tell me more</BaseButton>
          </div>
          <div v-else class="gr-card">
            <h3>Switch notifications on?</h3>
            <p>{{ PUSH_CONSENT }}</p>
            <p>Your phone will now ask you to allow them. If you say no there, nothing is switched on.</p>
            <BaseButton variant="primary" :disabled="touch.busy === 'push'" @click="switchPushOn">{{ touch.busy === 'push' ? 'Asking…' : 'Yes, ask me' }}</BaseButton>
            <BaseButton :disabled="touch.busy === 'push'" @click="touch.pushAsk = false; growth.track('push_prompt_declined')">Not now</BaseButton>
          </div>

          <!-- E-mail -->
          <div v-if="emailCard(hello.contact.email) === 'on' && hello.contact.email" class="gr-card">
            <h3>E-mail is on</h3>
            <p>{{ hello.contact.email.address }} · confirmed. At most one message a day and three a week.</p>
            <p v-if="!hello.contact.live.email" class="gr-note">E-mail is not switched on for this server yet: messages are composed and shown here, and nothing is sent.</p>
            <template v-if="comeback">
              <p>{{ COMEBACK_SENTENCE }}</p>
              <ComebackSwitches :view="comeback" />
            </template>
            <template v-if="hello.contact.email.preview">
              <div class="gr-preview"><b>{{ hello.contact.email.preview.subject }}</b><span class="gr-text">{{ hello.contact.email.preview.text }}</span></div>
              <p class="gr-note">The last message composed for you.</p>
            </template>
            <BaseButton :disabled="touch.busy === 'email'" @click="removeEmail">{{ touch.busy === 'email' ? 'Working…' : 'Delete my address' }}</BaseButton>
          </div>
          <div v-else-if="emailCard(hello.contact.email) === 'confirm' && hello.contact.email" class="gr-card">
            <h3>Confirm your address</h3>
            <p>{{ hello.contact.email.address }} is waiting. Open the e-mail we sent and press the button in it. Nothing else is sent until you do.</p>
            <p v-if="!hello.contact.live.email" class="gr-note">E-mail is not switched on for this server yet: messages are composed and shown here, and nothing is sent.</p>
            <p v-if="touch.note && 'confirmPath' in touch.note && touch.note.confirmPath"><LinkButton :href="touch.note.confirmPath">Open the confirmation page</LinkButton></p>
            <BaseButton :disabled="touch.busy === 'email'" @click="removeEmail">{{ touch.busy === 'email' ? 'Working…' : 'Delete my address' }}</BaseButton>
          </div>
          <form v-else class="gr-card" novalidate @submit.prevent="askEmail">
            <h3>E-mail</h3>
            <p>A few e-mails a week at most about your character: when someone is waiting, when something finished, and a weekly summary.</p>
            <label class="gr-field">Your e-mail address
              <input v-model="touch.email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" name="email">
            </label>
            <label class="gr-check"><input v-model="touch.tick" type="checkbox" name="consent"><span>{{ EMAIL_CONSENT }}</span></label>
            <BaseButton variant="primary" type="submit" :disabled="touch.busy === 'email'" :reason="sendReason">{{ touch.busy === 'email' ? 'Sending…' : 'Send the confirmation' }}</BaseButton>
            <p v-if="sendReason" class="gr-note">{{ sendReason }}</p>
            <p v-if="!hello.contact.live.email" class="gr-note">E-mail is not switched on for this server yet: messages are composed and shown here, and nothing is sent.</p>
          </form>
        </template>
      </div>

      <div v-if="growth.channel.value" class="gr-card">
        <h3>Allworld on WhatsApp</h3>
        <p>The owner posts what is on tonight in a WhatsApp Channel. Following it is between you and WhatsApp: the game learns nothing and sends nothing.</p>
        <LinkButton :href="growth.channel.value">Follow Allworld on WhatsApp</LinkButton>
      </div>
      <div class="gr-card">
        <h3>In the game</h3>
        <p>Updates, the “While you were away” card and the badges on your Phone are always here. They need no permission and leave the game for nowhere.</p>
      </div>
      <SectionTitle note="preview">What a weekly message says</SectionTitle>
      <DigestPreview :digest="hello.digest" />
      <p class="gr-note">Drawn from your own life as it is now.</p>
      <HowItWorks id="touch-rules" :rules="WEEKLY_RULES" />
    </template>
  </div>
</template>

<style scoped>
.gr-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
.gr-cards:focus { outline: none; }
.gr-card { background: #fff; border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 14px; margin: 0 0 var(--s-3); }
.gr-card h3 { margin: 0 0 4px; font-size: 15px; text-transform: none; letter-spacing: 0; color: var(--c-ink); }
.gr-card p { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--c-ink-2); }
.gr-card p.gr-note { color: var(--c-muted); font-size: 12px; margin: var(--s-2) 0; }
.gr-card :deep(.base-button) { margin: 4px 6px 0 0; }
.gr-card :deep(.link-button) { margin: 4px 6px 0 0; }
.gr-check { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.45; margin: 8px 0; min-height: var(--tap, 44px); }
.gr-check input { width: 22px; height: 22px; flex: none; margin-top: 2px; }
.gr-field { display: grid; gap: 4px; margin: 8px 0; font-size: 13px; }
.gr-field input { min-height: var(--tap, 44px); box-sizing: border-box; border-radius: 12px; border: 1px solid var(--c-line); padding: 0 12px; font: inherit; }
.gr-field input:focus-visible, .gr-check input:focus-visible { outline: var(--focus); outline-offset: 2px; }
.gr-preview { border: 1px dashed var(--c-line); border-radius: 14px; padding: 12px; background: var(--c-fill); font-size: 13px; line-height: 1.5; }
.gr-preview b { display: block; margin-bottom: 4px; }
.gr-text { white-space: pre-line; }
</style>
