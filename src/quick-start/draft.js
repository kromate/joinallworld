/**
 * OWNER: quick start
 * The draft of the landing screen — the name and the character being chosen — kept on the device as it is edited, so a
 * reload in the middle of the form loses nothing ('joinallworld-quick-start', see ./entry.js). Fetched with the landing
 * screen; the decisions are ./look-model.js (pure).
 */
import { draftFrom } from './look-model.js';
import { kept, store, landedAt } from './entry.js';

/** The draft the landing screen edits (made on first use, then kept). `name`: a name this device already uses. */
export function quickDraft(name) {
  kept.draft ??= draftFrom(store.read(store.KEYS.draft), { random: Math.random, now: landedAt(), name });
  return kept.draft;
}
/** True the first time the landing screen is shown on this device (and false after, across reloads), so 'landed' is reported once. */
export function firstLanding() {
  if (store.read(store.KEYS.landed)) return false;
  store.write(store.KEYS.draft, quickDraft()); // the moment of landing is kept with the draft: `ms` counts from here, also after a reload
  store.write(store.KEYS.landed, 1);
  return true;
}
/** Change the draft and keep it. */
export function keepDraft(changes) { kept.draft = { ...quickDraft(), ...changes }; store.write(store.KEYS.draft, kept.draft); return kept.draft; }
