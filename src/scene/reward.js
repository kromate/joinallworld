/**
 * OWNER: scenes
 * The reward moment's wording and its confetti — kept out of the first download (this file ships
 * with the scene host). The shell only reports the numbers.
 *
 * rewardChips({ cash, needs: { id: change }, skills: { id: xp gained }, order }) → up to four
 *   [{ text, kind: 'money' | 'gain' | 'loss' | 'xp', glyph }] — money first, then gains by size, losses last.
 * cheer(parent) — a short burst of confetti under the top bar for a finished goal: CSS only
 *   (.life-burst in src/ui/shell.css), removed when its last piece has faded, nothing under reduced motion.
 */
import { money, cap } from '../ui/dom.js';
import { glyph, hasGlyph } from '../ui/phone/icons.js';

export function rewardChips({ cash = 0, needs = {}, skills = {}, order = Object.keys(needs) } = {}) {
  const chips = [];
  if (cash) chips.push({ text: `${cash > 0 ? '+' : '−'}${money(Math.abs(cash))}`, kind: cash > 0 ? 'money' : 'loss', icon: 'bank', size: Infinity });
  for (const need of order) {
    const change = Math.round(needs[need] || 0);
    if (change) chips.push({ text: `${change > 0 ? '+' : '−'}${Math.abs(change)} ${cap(need)}`, kind: change > 0 ? 'gain' : 'loss', icon: need, size: Math.abs(change) });
  }
  for (const [skill, gained] of Object.entries(skills)) {
    const change = Math.round(gained);
    if (change >= 1) chips.push({ text: `+${change} ${cap(skill)} XP`, kind: 'xp', icon: 'skills', size: change });
  }
  chips.sort((a, b) => (b.kind !== 'loss') - (a.kind !== 'loss') || b.size - a.size);
  return chips.slice(0, 4).map(({ text, kind, icon }) => ({ text, kind, glyph: hasGlyph(icon) ? glyph(icon) : '' }));
}

const COLOURS = ['#f2b01e', '#2fa866', '#2a5bd7', '#e2572b', '#7a3fb0', '#ffffff'];
export function cheer(parent = globalThis.document?.body) {
  const doc = globalThis.document;
  if (!doc?.createElement || !parent || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  doc.querySelector('.life-burst')?.remove();
  const box = doc.createElement('div');
  box.className = 'life-burst'; box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 22; i += 1) {
    const piece = doc.createElement('i'), angle = (i / 22) * Math.PI * 2, far = 70 + ((i * 37) % 60);
    piece.style.setProperty('--c', COLOURS[i % COLOURS.length]);
    piece.style.setProperty('--x', `${Math.round(Math.cos(angle) * far)}px`);
    piece.style.setProperty('--y', `${Math.round(Math.sin(angle) * far * 0.7 + 50)}px`);
    piece.style.setProperty('--r', `${(i % 2 ? 1 : -1) * (120 + i * 9)}deg`);
    piece.style.animationDelay = `${(i % 5) * 18}ms`;
    box.append(piece);
  }
  box.lastChild.addEventListener('animationend', () => box.remove(), { once: true });
  parent.append(box);
}
