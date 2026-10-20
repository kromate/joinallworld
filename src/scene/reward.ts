/**
 * OWNER: scenes
 * The reward moment's wording and its confetti — kept out of the first download (this file ships
 * with the scene host). The shell only reports the numbers.
 *
 * rewardChips({ cash, needs: { id: change }, skills: { id: xp gained }, order }) → up to four
 *   [{ text, kind: 'money' | 'gain' | 'loss' | 'xp', glyph }] — money first, then gains by size, losses last.
 * cheer(parent) — a finished goal: confetti under the top bar (CSS only, .life-burst in src/ui/shell.css, nothing under reduced
 *   motion) and, with the large tier, one nudge of the camera. All of it comes from feel('goal-done') (./feel/index.ts).
 */
import { money, cap } from '../ui/dom.ts';
import { glyph, hasGlyph } from '../ui/phone/icons.ts';
import { feel } from './feel/index.ts';

export type RewardKind = 'money' | 'gain' | 'loss' | 'xp';
export interface RewardChip { text: string; kind: RewardKind; glyph: string }
export interface RewardInput {
  cash?: number;
  needs?: Record<string, number>;
  skills?: Record<string, number>;
  order?: string[];
}
export interface RewardLayout {
  x: number
  y: number
  width: number
  height: number
  topInset: number
  bottomInset: number
}
interface RewardDraft { text: string; kind: RewardKind; icon: string; size: number }

export function rewardChips({ cash = 0, needs = {}, skills = {}, order = Object.keys(needs) }: RewardInput = {}): RewardChip[] {
  const chips: RewardDraft[] = [];
  if (cash) chips.push({ text: `${cash > 0 ? '+' : '−'}${money(Math.abs(cash))}`, kind: cash > 0 ? 'money' : 'loss', icon: 'bank', size: Infinity });
  for (const need of order) {
    const change = Math.round(needs[need] || 0);
    if (change) chips.push({ text: `${change > 0 ? '+' : '−'}${Math.abs(change)} ${cap(need)}`, kind: change > 0 ? 'gain' : 'loss', icon: need, size: Math.abs(change) });
  }
  for (const [skill, gained] of Object.entries(skills)) {
    const change = Math.round(gained);
    if (change >= 1) chips.push({ text: `+${change} ${cap(skill)} XP`, kind: 'xp', icon: 'skills', size: change });
  }
  chips.sort((a, b) => Number(b.kind !== 'loss') - Number(a.kind !== 'loss') || b.size - a.size);
  return chips.slice(0, 4).map(({ text, kind, icon }) => ({ text, kind, glyph: hasGlyph(icon) ? glyph(icon) : '' }));
}

/** Render the reward chips at a precomputed avatar projection without asking for another frame. */
export function showReward(parent: Element | null | undefined, detail: RewardInput = {}, layout: RewardLayout): boolean {
  const chips = rewardChips(detail)
  const doc = globalThis.document
  if (!doc?.createElement || !parent || !chips.length) return false
  parent.querySelector('.scene-reward')?.remove()
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
  const node = doc.createElement('div')
  node.className = 'scene-reward'; node.setAttribute('aria-hidden', 'true')
  node.style.left = `${Math.round(clamp(layout.x, 84, Math.max(84, layout.width - 84)))}px`
  node.style.top = `${Math.round(clamp(layout.y, layout.topInset + 28 * chips.length + 12, Math.max(layout.topInset + 60, layout.height - layout.bottomInset - 20)))}px`
  for (const chip of chips) {
    const item = doc.createElement('span')
    item.className = `is-${['gain', 'loss', 'money', 'xp'].includes(chip.kind) ? chip.kind : 'gain'}`
    if (typeof chip.glyph === 'string' && chip.glyph.startsWith('<svg')) item.innerHTML = chip.glyph
    item.append(String(chip.text || ''))
    node.append(item)
  }
  node.lastChild!.addEventListener('animationend', () => node.remove(), { once: true })
  parent.append(node)
  // Money coming in makes the chips pop (medium tier). Money has its own sound already, and a pay chip alone gets no confetti.
  if ((detail.cash ?? 0) > 0) feel('pay-received', { pop: node, burst: false })
  return true
}

/** A finished goal's moment (large tier): confetti and one nudge of the camera. Its sound already plays with the toast (src/app/state/toasts.ts). */
export function cheer(parent: Element | null | undefined = globalThis.document?.body) {
  feel('goal-done', { parent });
}
