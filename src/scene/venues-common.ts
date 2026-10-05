/**
 * OWNER: scenes
 * Helpers shared by the cities' own scenes (src/scene/venues-ogun-a.ts, venues-ogun-b.ts, venues-rivers.ts, venues-fct.ts,
 * venues-kano.ts and their second files): a seeded generator, lettering that fits a board, rust-roofed houses and sheds, rock,
 * a talking drum, a horse and resist-dyed cloth. Each city's scenes are fetched on their own (src/scene/city-scenes.ts); what
 * several of them draw with is here, so that no city's scenes are fetched for another's.
 */
import type { Batch, Colour, SceneWalkSpec } from './types.ts';
import { sign, WOOD_DARK } from './props.ts';

export const PI = Math.PI, HALF = Math.PI / 2;
export const OPEN: SceneWalkSpec = { bounds: [-14.2, -12.2, 14.2, 12.2], entrance: [0, 11.4], open: true };

/** A small deterministic generator, so a scene is the same every time it is built. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
/** Block lettering has only capitals, digits and a few marks: a label is cleaned to those. */
export const plain = (label: string): string => label.replace(/['’]s\b/gi, '').replace(/[’']/g, '').replace(/[^A-Za-z0-9 .\-]/g, ' ').replace(/\s+/g, ' ').trim();
/** The largest letter height (at most `max`) at which a label fits `width`. */
export const fit = (label: string, width: number, max: number): number => Math.min(max, (width * 5) / Math.max(1, label.length * 4 - 1));
/** A sign on a board that fits the label, centred on x. */
export function labelled(b: Batch, label: string, x: number, y: number, z: number, width: number, max: number, color: Colour, board: Colour, lit = false, ry = 0): void {
  const text = plain(label);
  sign(b, x, y, z, text, { size: fit(text, width, max), color, board, lit, pad: 0.22, ry });
}
/** The shared crowd of the open front of a scene. */
export const FRONT_CROWD: [number, number, number][] = [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [7.6, 6.2, 2.4], [-6, 6.6, 1.2], [8.6, 8.8, -0.8], [-8.4, 9, 0.8], [3, 10.4, 2.8], [-5.2, 10.2, 2.4], [-11, 7.4, 1.6], [11, 9.6, -0.4], [0.2, 9, 3.1], [5.4, 4.6, 0.6]];
export const FRONT_SPARE: [number, number][] = [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]];

export const RUST: readonly Colour[] = ['#9b5a3a', '#a8653f', '#8a4e34', '#b0704a'];
/** A gable roof of two tilted slabs over a w by d footprint, its eaves at height y. */
export function gable(b: Batch, x: number, y: number, z: number, w: number, d: number, tone = 0, a = 0.4): void {
  const slope = d / 2 / Math.cos(a) + 0.2, rise = Math.tan(a) * d / 4 + 0.04;
  b.box(x, y + rise, z - d / 4, w + 0.5, 0.14, slope, RUST[tone % 4]!, { rx: -a });
  b.box(x, y + rise, z + d / 4, w + 0.5, 0.14, slope, RUST[(tone + 2) % 4]!, { rx: a });
  b.box(x, y + rise * 2 + 0.06, z, w + 0.56, 0.14, 0.3, '#7a4530');
}
/** A small house under a rust-brown roof. */
export function house(b: Batch, x: number, z: number, w: number, d: number, h: number, tone: number, ry = 0, wall: Colour = '#e0d3b6'): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, h / 2, 0, w, h, d, wall);
    gable(b, 0, h, 0, w, d, tone);
    b.box(-w / 4, h * 0.55, d / 2 + 0.02, 0.5, 0.55, 0.04, '#5d7488');
    b.box(w / 4, 0.6, d / 2 + 0.02, 0.6, 1.2, 0.04, '#6b4a30');
  });
}
/** A flat-topped, corrugated iron shed on posts. */
export function shed(b: Batch, x: number, z: number, w: number, d: number, tone = 0, h = 3.1): void {
  for (const sx of [-1, 1]) { b.box(x + sx * (w / 2 - 0.1), h / 2, z + d / 2 - 0.1, 0.12, h, 0.12, WOOD_DARK); b.box(x + sx * (w / 2 - 0.1), (h + 0.5) / 2, z - d / 2 + 0.1, 0.12, h + 0.5, 0.12, WOOD_DARK); }
  b.box(x, h + 0.3, z, w + 0.5, 0.12, d + 0.5, RUST[tone % 4]!, { rx: 0.14 });
  for (let i = 0; i < Math.round(w / 0.7); i++) b.box(x - w / 2 + 0.35 + i * 0.7, h + 0.38, z, 0.06, 0.06, d + 0.5, '#7a4530', { rx: 0.14 });
}
/** Grass and loose rock around a scene's edge. */
export function boulder(b: Batch, x: number, y: number, z: number, r: number, tone = 0): void {
  b.ico(x, y + r * 0.5, z, r * 1.2, r * 0.8, r, ['#8d8883', '#9c958d', '#7c7873', '#a59d94'][tone % 4]!);
}
/** An hourglass-shaped talking drum standing on the ground. */
export function drum(b: Batch, x: number, z: number, colour: Colour = '#6a3f27'): void {
  b.cyl(x, 0.28, z, 0.34, 0.56, colour, { seg: 8, top: 0.45 });
  b.cyl(x, 0.78, z, 0.15, 0.5, colour, { seg: 8, top: 2.3 });
  b.disc(x, 1.04, z, 0.34, '#e8d9b0', { seg: 8 });
  b.disc(x, 0.04, z, 0.38, '#e8d9b0', { seg: 8 });
}
/** A horse standing, drawn as simple blocks: a static prop. */
export function horse(b: Batch, x: number, z: number, ry: number, coat: Colour, blanket: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.ball(0, 1.5, 0, 0.55, 0.62, 1.15, coat, { seg: 7 });
    b.box(0, 2.15, 1.0, 0.36, 1.0, 0.5, coat, { rx: 0.6 });
    b.ball(0, 2.7, 1.45, 0.24, 0.26, 0.5, coat, { seg: 6 });
    b.box(0, 3.0, 1.2, 0.08, 0.34, 0.5, '#2f2420');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.3, 0.7, sz * 0.8, 0.2, 1.4, 0.2, coat);
    b.box(0, 1.5, -1.2, 0.12, 0.9, 0.18, '#2f2420', { rx: -0.3 });
    b.box(0, 2.16, 0, 1.2, 0.08, 1.1, blanket);
    b.box(0, 2.0, 0, 0.16, 0.5, 1.0, blanket);
  });
}
/** A bolt of resist-dyed cloth hung flat: an indigo ground with white motifs. Pattern 0..3 differ. */
export function adireCloth(b: Batch, x: number, y: number, z: number, w: number, h: number, pattern: number, ry = 0, base: Colour = '#233c7c', motif: Colour = '#eae4d0'): void {
  b.at(x, y, z, ry, () => {
    b.quad(0, 0, 0, w, h, base);
    b.quad(0, h / 2 - 0.08, 0.012, w, 0.1, motif); b.quad(0, -h / 2 + 0.08, 0.012, w, 0.1, motif);
    const p = ((pattern % 4) + 4) % 4;
    if (p === 0) { for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) if ((i + j) % 2 === 0) b.quad(-w * 0.375 + i * w * 0.25, -h * 0.36 + j * h * 0.18, 0.014, w * 0.2, h * 0.14, motif); }
    else if (p === 1) { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) b.quad(-w / 3 + i * w / 3, -h / 3 + j * h / 3, 0.014, w * 0.2, w * 0.2, motif, { rz: PI / 4 }); }
    else if (p === 2) { for (let i = 0; i < 5; i++) b.quad(-w * 0.4 + i * w * 0.2, 0, 0.014, w * 0.07, h * 0.8, i % 2 ? '#6f8fc7' : motif); }
    else { for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { b.quad(-w / 3 + i * w / 3, -h * 0.34 + j * h * 0.23, 0.014, w * 0.17, w * 0.17, motif, { rz: PI / 4 }); b.quad(-w / 3 + i * w / 3, -h * 0.34 + j * h * 0.23, 0.016, w * 0.07, w * 0.07, '#6f8fc7'); } }
  });
}
