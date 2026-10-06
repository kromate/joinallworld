/**
 * OWNER: social
 * Shortening a line of chat to a preview without breaking a character: a quote, the last line of a chat, a notification.
 * Portable: no Node imports. It cuts between grapheme clusters, so a flag, a skin-tone emoji, a family joined with zero-width
 * joiners or a letter with its accent is never cut in half, and counts those as the characters a person sees.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The first `max` characters a person would count, as they were written. Text no longer than that is returned as it is. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '', count = 0;
  for (const { segment } of segmenter.segment(text)) {
    // One run of marks without end cannot make a preview of any size.
    if (count >= max || out.length + segment.length > max * 8) break;
    out += segment; count += 1;
  }
  return out;
}
/** How many characters a person would count (grapheme clusters). */
export function glyphs(text: string): number { let count = 0; for (const _ of segmenter.segment(text)) count += 1; return count; }
