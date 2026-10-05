import { GLYPH_TOKENS } from '../src/ui/phone/glyph-codec.ts';

/** Fixed-width LZW; stop adding entries at 4096. The browser decoder uses the same ceiling. */
export function packGlyphText(text: string): { data: string; count: number } {
  if (/[^\x00-\x7f]/.test(text)) throw new Error('Escape Unicode before packing glyph text');
  const input = GLYPH_TOKENS.reduce((value, token, i) => value.replaceAll(token, String.fromCharCode(128 + i)), text);
  const words = new Map(Array.from({ length: 256 }, (_, i) => [String.fromCharCode(i), i]));
  const codes: number[] = [];
  let previous = '', next = 256;
  for (const char of input) {
    const joined = previous + char;
    if (words.has(joined)) { previous = joined; continue; }
    codes.push(words.get(previous)!);
    if (next < 4096) words.set(joined, next++);
    previous = char;
  }
  if (previous) codes.push(words.get(previous)!);
  const bytes: number[] = [];
  let bits = 0, buffer = 0;
  for (const code of codes) {
    buffer = (buffer << 12) | code;
    bits += 12;
    while (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); }
  }
  if (bits) bytes.push((buffer << (8 - bits)) & 255);
  return { data: Buffer.from(bytes).toString('base64'), count: codes.length };
}

export const glyphJson = (glyphs: Readonly<Record<string, string>>): string => JSON.stringify(glyphs)
  .replace(/[^\x20-\x7e]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
