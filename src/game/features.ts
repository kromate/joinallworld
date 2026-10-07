// The engine's seam for work dilemmas and place actions. They are on for every player: there is no switch. What there is, is the kit.
//
// THE KIT. The words and rules of dilemmas and place actions (about 30 kB) are not part of the engine every page downloads: they sit in
// their own chunk (vite.config.ts, `dilemmas`) behind src/game/dilemma-pack.ts, which installs the kit when it is imported. The servers
// and the Worker import it, so every life they play has dilemmas and place actions. The browser fetches it once the game is ready
// (src/app/startExtras.ts), never in the first download, and the page lists place actions and draws the card once it is in. An engine that
// has no kit installed (a test of the bare engine, a page before the chunk arrives) simply has none: no state is written and no activity
// exists. What a life needs to carry a dilemma (src/game/dilemma-book.ts) and this file are all the engine keeps.
// The activity catalogue notices the kit arriving, so a catalogue built before it is built again.
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

let kit: DilemmaKit | null = null;

/** The kit, or null while none is installed. */
export const dilemmaKit = (): DilemmaKit | null => kit;
export const dilemmasEnabled = (): boolean => kit !== null;
/** Called by src/game/dilemma-pack.ts when it loads. */
export function installDilemmaKit(next: DilemmaKit): void { kit = next; }
/** Removes the kit: for a test of the bare engine only. */
export function uninstallDilemmaKit(): void { kit = null; }
