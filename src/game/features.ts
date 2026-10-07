// Engine-level feature switches. Every switch is OFF until the host that runs the engine turns it on at startup.
//
//   dilemmas   work dilemmas after a shift (src/game/dilemmas.ts) and the place actions of src/game/place-actions.ts.
//              Host: the server reads DILEMMAS=1 (server/server.ts createServer option `dilemmas`, deploy/local.ts, the Worker).
//              Browser: `?models=dilemmas` (src/models/integration/flags.ts) fetches the kit below (startExtras) and turns the switch on, so
//              the page lists place actions and draws the card; the life is always played by the server, whose switch is the authority.
//
// THE KIT. The words and rules of dilemmas and place actions (about 30 kB) are not part of the engine every page downloads: they sit in
// their own chunk (vite.config.ts, `dilemmas`) behind src/game/dilemma-pack.ts, which installs the kit when it is imported. The servers
// import it; the browser fetches it only with `?models=dilemmas`. With no kit installed a switch that is on does nothing. What a life needs
// to carry a dilemma (src/game/dilemma-book.ts) and this file are all the engine keeps.
//
// With a switch off the engine behaves exactly as before: no new state is written, no new activity exists.
// A switch is set once, before the first life is loaded (the activity catalogue notices a flip, so a test may flip one later).
import type { DilemmaChoice, DilemmaDefinition, DilemmaOutcome, DilemmaStats, NpcDefinition, PlaceAction } from '../types/content.ts';

/** What the lazy pack gives the engine. Every member is pure. */
export interface DilemmaKit {
  /** Percent chance that a finished shift leaves a dilemma. */
  readonly chance: number
  byId(id: unknown): DilemmaDefinition | undefined
  pick(stats: DilemmaStats, seed: number, seen: readonly string[], placeKind: string | null): DilemmaDefinition | null
  resolve(dilemma: DilemmaDefinition, choiceId: string, stats: DilemmaStats, seed: number): DilemmaOutcome
  choiceOf(dilemma: DilemmaDefinition, choiceId: unknown): DilemmaChoice | undefined
  placeKindOf(cityId: string, venueId: string): string | null
  /** The place actions a regular offers at its own venue; `now` null ignores the hour. */
  placeActionsFor(npc: NpcDefinition, cityId: string, now: number | null): PlaceAction[]
  placeActionById(id: unknown): PlaceAction | undefined
  isAfterService(kind: string | null, now: number): boolean
}

const switches = { dilemmas: false };
let kit: DilemmaKit | null = null;
export type FeatureSwitch = keyof typeof switches;

/** The kit, only while the switch is on and a kit is installed. */
export const dilemmaKit = (): DilemmaKit | null => (switches.dilemmas ? kit : null);
/** The kit whether or not the switch is on: for finishing what a life already started (a place action begun before the switch went off). */
export const loadedDilemmaKit = (): DilemmaKit | null => kit;
export const dilemmasEnabled = (): boolean => dilemmaKit() !== null;
export const featureEnabled = (name: FeatureSwitch): boolean => (name === 'dilemmas' ? dilemmasEnabled() : switches[name]);
export function setFeature(name: FeatureSwitch, on: boolean): void { switches[name] = on === true; }
/** Called by src/game/dilemma-pack.ts when it loads. Does not turn the switch on. */
export function installDilemmaKit(next: DilemmaKit): void { kit = next; }

/** Reads an on/off environment value: only `1`, `true`, `on` or `yes` (any case) turn a feature on. */
export function flagFromEnv(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase());
}
