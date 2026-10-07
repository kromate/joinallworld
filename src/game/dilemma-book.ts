/**
 * OWNER: career
 * What a life carries about work dilemmas (CareerState.dilemmas), kept apart from the words and rules (src/game/dilemmas.ts, lazy) so the
 * engine every page loads holds only this: the shape of the record, how it is cleaned when a save is read, and how it is updated.
 * The record names dilemmas by id only; whether an id still exists is the pack's question (src/game/features.ts), asked where one is used.
 */
import { isId, isRecord, safeCount } from './util.ts';
import type { DilemmaBook } from '../types/life.ts';

/** How many recent dilemmas are not repeated, and how many memory tags a life keeps. */
export const SEEN_KEPT = 8;
export const MEMORY_KEPT = 12;

export const emptyBook = (): DilemmaBook => ({ pending: null, seen: [], memory: [] });

/** Pushes onto a list that keeps only its last `keep` entries, without repeats of the same entry (it moves to the end). */
function remember(list: string[], value: string, keep: number): string[] {
  return [...list.filter((item) => item !== value), value].slice(-keep);
}
export const markSeen = (book: DilemmaBook, id: string): void => { book.seen = remember(book.seen, id, SEEN_KEPT); };
export const markMemory = (book: DilemmaBook, tag: string): void => { book.memory = remember(book.memory, tag, MEMORY_KEPT); };

/** A saved record made safe, or undefined when it holds nothing worth keeping (the key stays absent, so a save from before it existed loads unchanged). */
export function cleanBook(value: unknown): DilemmaBook | undefined {
  if (!isRecord(value)) return undefined;
  const pending = isRecord(value.pending) && isId(value.pending.id) && safeCount(value.pending.seed) ? { id: value.pending.id, seed: value.pending.seed } : null;
  const seen = (Array.isArray(value.seen) ? value.seen : []).filter(isId).slice(-SEEN_KEPT);
  const memory = (Array.isArray(value.memory) ? value.memory : []).filter(isId).slice(-MEMORY_KEPT);
  return pending || seen.length || memory.length ? { pending, seen, memory } : undefined;
}
