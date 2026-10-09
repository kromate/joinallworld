import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import type { Look } from '../../../src/scene/avatar-look.ts';
import { normalizeAvatarAppearance } from '../../../src/types/avatar.ts';
import type { CompleteCharacter, CompleteCharacterExpression } from './rig.ts';

export interface AuthoredLookSkinPort {
  isReady(): boolean;
  setColor(color: string): void;
}

export interface AuthoredLookPresentationPort {
  isReady(): boolean;
  setColors(shirt: string, trousers: string, hairColor: string): void;
}

export interface AuthoredLookCharacterPort {
  readonly body: Look['body'];
  isReady(): boolean;
  updateIdentity(look: unknown, seed?: unknown): boolean;
  setExpression(name: CompleteCharacterExpression, seconds: number): void;
}

export interface AuthoredLookBridgeOptions {
  readonly character: AuthoredLookCharacterPort;
  readonly skin: AuthoredLookSkinPort;
  readonly presentation: AuthoredLookPresentationPort;
  readonly initialLook: unknown;
  /** Must be the same identity seed used to prepare the actor's body, hair and outfit. */
  readonly seed: unknown;
}

export interface AuthoredLookApplyResult {
  readonly accepted: boolean;
  readonly reasons: readonly string[];
  readonly look: Look;
}

export interface AuthoredLookBridge {
  readonly currentLook: Look;
  readonly seedKey: string;
  apply(look: unknown, seed?: unknown): AuthoredLookApplyResult;
}

const REQUIRED_LOOK_FIELDS = [
  'body', 'hair', 'outfit', 'fabric', 'skin', 'hairColor', 'outfitColor', 'bottomsColor',
  'accessories', 'face', 'expression',
] as const;
const STRUCTURAL_FIELDS = ['body', 'hair', 'outfit', 'fabric', 'accessories', 'wearables'] as const;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function copyLook(look: Look): Look {
  return Object.freeze({ ...look, accessories: Object.freeze([...look.accessories]) as unknown as string[] });
}

function readinessReasons(options: AuthoredLookBridgeOptions): string[] {
  const reasons: string[] = [];
  for (const [name, port] of [
    ['character', options.character], ['skin', options.skin], ['presentation', options.presentation],
  ] as const) {
    if (!port || typeof port.isReady !== 'function') {
      reasons.push(`${name}-not-ready`);
    } else {
      try { const ready: unknown = port.isReady(); if (typeof ready !== 'boolean' || !ready) reasons.push(`${name}-not-ready`); }
      catch { reasons.push(`${name}-not-ready`); }
    }
  }
  if (typeof options.character?.updateIdentity !== 'function' || typeof options.character?.setExpression !== 'function') {
    reasons.push('character-update-capability-missing');
  }
  if (typeof options.skin?.setColor !== 'function') reasons.push('skin-color-capability-missing');
  if (typeof options.presentation?.setColors !== 'function') reasons.push('presentation-color-capability-missing');
  return reasons;
}

function normalizeComplete(value: unknown, seed: unknown): { look?: Look; reasons: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { reasons: ['look-must-be-an-object'] };
  const raw = value as Record<string, unknown>;
  const missing = REQUIRED_LOOK_FIELDS.filter((field) => !Object.hasOwn(raw, field));
  if (missing.length) return { reasons: [`incomplete-look:${missing.join(',')}`] };
  try {
    return { look: normalizeLook(value, seed), reasons: [] };
  } catch (error) {
    return { reasons: [`look-normalization-failed:${error instanceof Error ? error.message : String(error)}`] };
  }
}

function structuralReasons(current: Look, wanted: Look): string[] {
  const reasons: string[] = [];
  for (const field of STRUCTURAL_FIELDS) {
    if (stableJson(current[field]) !== stableJson(wanted[field])) reasons.push(`requires-new-prepared-${field}`);
  }
  const beforeAppearance = normalizeAvatarAppearance(current.appearance);
  const afterAppearance = normalizeAvatarAppearance(wanted.appearance);
  for (const field of ['ageAppearance', 'build', 'height'] as const) {
    if (beforeAppearance[field] !== afterAppearance[field]) reasons.push(`requires-new-prepared-appearance-${field}`);
  }
  return reasons;
}

function assertSamePreparedColorFamilies(look: Look): void {
  if (!/^#[0-9a-f]{6}$/i.test(look.skin) || !/^#[0-9a-f]{6}$/i.test(look.hairColor)
    || !/^#[0-9a-f]{6}$/i.test(look.outfitColor) || !/^#[0-9a-f]{6}$/i.test(look.bottomsColor)) {
    throw new Error('Normalized look did not produce canonical hex colors');
  }
}

/**
 * Updates only controls already represented by this actor's prepared assets. Structural changes
 * are rejected during preflight, before any actor or palette callback can run.
 */
export function createAuthoredLookBridge(options: AuthoredLookBridgeOptions): AuthoredLookBridge {
  const setupReasons = readinessReasons(options);
  if (setupReasons.length) throw new Error(`Cannot create authored look bridge: ${setupReasons.join('; ')}`);
  const initialSource = options.initialLook && typeof options.initialLook === 'object'
    ? options.initialLook as Record<string, unknown> : {};
  const fixedSeed = options.seed ?? initialSource.seed ?? initialSource.id ?? 'joinallworld';
  const seedKey = String(fixedSeed);
  const initial = normalizeComplete(options.initialLook, fixedSeed);
  if (!initial.look) throw new Error(`Cannot create authored look bridge: ${initial.reasons.join('; ')}`);
  assertSamePreparedColorFamilies(initial.look);
  if (initial.look.body !== options.character.body) {
    throw new Error('Cannot create authored look bridge: character body does not match the prepared actor');
  }
  let current = copyLook(initial.look);

  return {
    get currentLook() { return copyLook(current); },
    seedKey,
    apply(input, nextSeed = fixedSeed) {
      const parsed = normalizeComplete(input, nextSeed);
      if (!parsed.look) return Object.freeze({ accepted: false, reasons: Object.freeze(parsed.reasons), look: copyLook(current) });
      const wanted = parsed.look;
      const reasons = readinessReasons(options);
      if (String(nextSeed ?? 'joinallworld') !== seedKey) reasons.push('requires-original-identity-seed');
      reasons.push(...structuralReasons(current, wanted));
      try { assertSamePreparedColorFamilies(wanted); }
      catch { reasons.push('invalid-normalized-color'); }
      if (reasons.length) return Object.freeze({ accepted: false, reasons: Object.freeze([...new Set(reasons)]), look: copyLook(current) });

      // Preflight is complete. These calls target live, actor-private adapters supplied by the
      // integration host. This bridge guarantees preflight rejection is mutation-free; it does
      // not claim rollback for an arbitrary callback that throws after a commit has begun.
      const identityChanged = current.face !== wanted.face;
      const expressionChanged = current.expression !== wanted.expression;
      if (identityChanged) {
        if (!options.character.updateIdentity(wanted, fixedSeed)) {
          return Object.freeze({ accepted: false, reasons: Object.freeze(['character-rejected-identity-update']), look: copyLook(current) });
        }
      } else if (expressionChanged) {
        options.character.setExpression(wanted.expression as CompleteCharacterExpression, 0);
      }
      if (current.skin !== wanted.skin) options.skin.setColor(wanted.skin);
      if (current.outfitColor !== wanted.outfitColor || current.bottomsColor !== wanted.bottomsColor
        || current.hairColor !== wanted.hairColor) {
        options.presentation.setColors(wanted.outfitColor, wanted.bottomsColor, wanted.hairColor);
      }
      current = copyLook(wanted);
      return Object.freeze({ accepted: true, reasons: Object.freeze([]), look: copyLook(current) });
    },
  };
}
