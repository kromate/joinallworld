/**
 * The campus rules are not part of the first download (a chunk of their own). A host that registered stand-ins for them
 * (systems/browser.ts) must have them in place before it rebuilds a life that uses the campus, or the stand-in refuses it
 * (campus/unilag/slices.ts). Callers say so with `campusFor(raw)`: it answers null when nothing has to be fetched (always,
 * on a host with the full set), otherwise a promise that settles when the campus rules are registered.
 *
 * A failed fetch is not remembered: the next call asks again, and the life that needed it is not accepted meanwhile.
 */
import { isStandIn } from './registry.ts';
import { needsCampusRules } from '../campus/unilag/slices.ts';

let loading: Promise<void> | null = null;

/** Fetch and register the campus rules (once). */
export function loadCampus(): Promise<void> {
  if (!isStandIn('unilagStudent')) return Promise.resolve();
  loading ??= import('../campus/unilag/register.ts').then(() => undefined, (error: unknown) => { loading = null; throw error; });
  return loading;
}

/** Null when `raw` can be rebuilt now; otherwise the promise to wait for first. */
export function campusFor(raw: unknown): Promise<void> | null {
  return isStandIn('unilagStudent') && needsCampusRules(raw) ? loadCampus() : null;
}
