/**
 * OWNER: civic
 * What the State House sheet says and what an advert may look like. Plain data only. Apart from civic.ts on purpose: the
 * rules engine reads none of it — the Ads and Governor screens and the servers do — so it is not part of the first
 * download (vite.config.ts).
 */
import type { AdColour, AdIcon } from '../../types/content.ts'

/** Text on the State House sheet (Lagos). */
export const STATE_HOUSE_TEXT = {
  title: 'Lagos State House',
  empty: 'Lagos has no Chairman yet. Sign up to vote, or run for office yourself.',
};

/** Fixed creative choices for billboards and sea plots: no uploads and no links in this wave. */
export const AD_COLOURS: AdColour[] = [
  { id: 'green', label: 'Green', bg: '#256b45', ink: '#ffffff' },
  { id: 'gold', label: 'Gold', bg: '#e8a643', ink: '#20232c' },
  { id: 'red', label: 'Red', bg: '#b23a2e', ink: '#ffffff' },
  { id: 'blue', label: 'Blue', bg: '#2b5fa8', ink: '#ffffff' },
  { id: 'purple', label: 'Purple', bg: '#6a3fa0', ink: '#ffffff' },
  { id: 'teal', label: 'Teal', bg: '#1f8a86', ink: '#ffffff' },
  { id: 'night', label: 'Night', bg: '#182a25', ink: '#ffffff' },
  { id: 'white', label: 'White', bg: '#ffffff', ink: '#20232c' },
];

export const AD_ICONS: AdIcon[] = [
  { id: 'star', icon: '⭐' }, { id: 'shop', icon: '🛍️' }, { id: 'food', icon: '🍲' }, { id: 'music', icon: '🎵' },
  { id: 'phone', icon: '📱' }, { id: 'car', icon: '🚗' }, { id: 'house', icon: '🏠' }, { id: 'heart', icon: '❤️' },
  { id: 'crown', icon: '👑' }, { id: 'fire', icon: '🔥' }, { id: 'ball', icon: '⚽' }, { id: 'book', icon: '📚' },
  { id: 'scissors', icon: '✂️' }, { id: 'camera', icon: '📷' }, { id: 'palm', icon: '🌴' }, { id: 'megaphone', icon: '📣' },
];

export const AD_TEXT = { min: 2, max: 40 };
