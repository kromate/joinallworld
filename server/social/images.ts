/**
 * OWNER: social
 * PICTURES IN CHAT: what a picture may be, and the one place bytes from a browser are looked at. Portable: no Node imports.
 *
 * The browser re-encodes every picture through a canvas (which drops all metadata), downscales it and sends a JPEG or a WebP
 * (a PNG when it can do nothing else). The server does not trust that: it reads the bytes itself, accepts only a still
 * JPEG, PNG or WebP that parses to the end, checks its dimensions and size, and writes it out again with every metadata
 * segment left out (EXIF and GPS, XMP, ICC profiles, comments, thumbnails, text chunks). What is stored is that rewritten copy.
 * There is no scanning of what a picture shows. docs/CHAT-PICTURES.md says what that leaves.
 *
 * WHERE THE BYTES LIVE: in the host's image store (ctx.images: files on Node, the SQLite table `chat_images` of the Durable
 * Object on the Worker), never in the `social` collection. A message holds only `img: { id, w, h, n }`.
 */
import type { StoredImage } from '../types.ts';

/** The settings an operator may change (each also by environment: CHAT_IMAGES, CHAT_IMAGES_PER_DAY, …). */
export interface PictureSettings {
  /** 'off': no button, every upload refused. 'friends' (the default): friends in direct chats, members in groups. */
  mode: 'off' | 'friends'
  perDay: number
  perChat: number
  retentionMs: number
  ceilingBytes: number
  /** Distinct reports that hide a picture from everyone until a moderator looks. */
  reportsToHide: number
}
export const PICTURE_DEFAULTS: PictureSettings = Object.freeze({ mode: 'friends', perDay: 20, perChat: 50, retentionMs: 30 * 86400000, ceilingBytes: 200 * 1024 * 1024, reportsToHide: 2 });
const whole = (text: string, fallback: number, min: number, max: number): number => { const value = Number(text); return text.trim() !== '' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback; };
/** The settings, read from the host's environment (ctx.env). Anything missing or malformed is the default. */
export function pictureSettings(env: (name: string) => string): PictureSettings {
  // Off unless an operator sets CHAT_IMAGES=friends: pictures are switched on deliberately, not by default.
  const mode = env('CHAT_IMAGES').trim().toLowerCase() === 'friends' ? 'friends' : 'off';
  return {
    mode,
    perDay: whole(env('CHAT_IMAGES_PER_DAY'), PICTURE_DEFAULTS.perDay, 1, 200),
    perChat: whole(env('CHAT_IMAGES_PER_CHAT'), PICTURE_DEFAULTS.perChat, 1, 500),
    retentionMs: whole(env('CHAT_IMAGES_RETENTION_DAYS'), 30, 1, 365) * 86400000,
    ceilingBytes: whole(env('CHAT_IMAGES_MAX_MB'), 200, 1, 8192) * 1024 * 1024,
    reportsToHide: whole(env('CHAT_IMAGES_REPORTS'), PICTURE_DEFAULTS.reportsToHide, 1, 10),
  };
}

/** What a picture may be, whatever the settings. */
export const PICTURE_LIMITS = Object.freeze({
  /** After encoding. The browser aims at 180 kB; this is the hard cap. */
  bytes: 250000,
  /** The browser sends at most 1280 on the long edge. */
  side: 2048,
  pixels: 4000000,
  caption: 200,
  /** The id of a stored picture: 32 hex digits drawn from the host's random source. */
  idPattern: /^[0-9a-f]{32}$/,
});

export type PictureType = StoredImage['type'];
export const CONTENT_TYPES: Readonly<Record<PictureType, string>> = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
/** The type a browser names when it uploads, as a content type. */
export const claimedType = (value: unknown): PictureType | null => (value === 'image/jpeg' ? 'jpeg' : value === 'image/png' ? 'png' : value === 'image/webp' ? 'webp' : null);

export interface CleanPicture { type: PictureType; bytes: Uint8Array; width: number; height: number }
export type PictureFault = 'empty' | 'too_large' | 'unknown_type' | 'type_mismatch' | 'animated' | 'unreadable' | 'dimensions'

/** Standard base64 → bytes, or null when it is not base64 (no whitespace, no URL alphabet). */
export function fromBase64(text: unknown, maxBytes: number): Uint8Array | null {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 !== 0 || text.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    const binary = atob(text), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch { return null; }
}

const same = (bytes: Uint8Array, at: number, text: string): boolean => { for (let i = 0; i < text.length; i += 1) if (bytes[at + i] !== text.charCodeAt(i)) return false; return true; };
const u16 = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32 = (b: Uint8Array, at: number): number => (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
const l32 = (b: Uint8Array, at: number): number => ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0;
const join = (parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };

/** The type the first bytes say it is, by magic number alone. */
export function sniff(bytes: Uint8Array): PictureType | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && same(bytes, 1, 'PNG') && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 16 && same(bytes, 0, 'RIFF') && same(bytes, 8, 'WEBP')) return 'webp';
  return null;
}

type Parsed = { ok: true; width: number; height: number; bytes: Uint8Array } | { ok: false; fault: PictureFault };
const unreadable: Parsed = { ok: false, fault: 'unreadable' };

/** JPEG: keep the picture's own segments and nothing else (no APPn but a plain JFIF header, no comments). */
function cleanJpeg(b: Uint8Array): Parsed {
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2, width = 0, height = 0, frames = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) return unreadable;
    while (b[i] === 0xff) i += 1; // fill bytes
    const marker = b[i++] ?? 0;
    if (marker === 0xd9) return unreadable; // end of image before any scan
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // standalone, nothing to keep
    if (i + 2 > b.length) return unreadable;
    const length = u16(b, i);
    if (length < 2 || i + length > b.length) return unreadable;
    const segment = b.subarray(i - 2, i + length), body = b.subarray(i + 2, i + length);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // A frame header. Only baseline, extended and progressive Huffman stills; no lossless, arithmetic or hierarchical modes.
      if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) return unreadable;
      if (frames++ > 0 || body.length < 6) return unreadable;
      height = u16(body, 1); width = u16(body, 3);
      const components = body[5] ?? 0;
      if (components !== 1 && components !== 3) return unreadable;
      kept.push(segment);
    } else if (marker === 0xda) {
      // The scan: the compressed data follows to the end of the file, which must be the end-of-image marker.
      if (!frames || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return unreadable;
      kept.push(b.subarray(i - 2));
      return { ok: true, width, height, bytes: join(kept) };
    } else if (marker === 0xe0) {
      // APP0: a plain JFIF header without a thumbnail is harmless; anything else (JFXX extensions) is dropped.
      if (same(body, 0, 'JFIF\0') && length === 16) kept.push(segment);
    } else if (marker >= 0xe1 && marker <= 0xef) { /* EXIF, XMP, ICC, Adobe, … */ } else if (marker === 0xfe) { /* comment */ } else kept.push(segment); // tables
    i += length;
  }
  return unreadable;
}

/** PNG: the chunks a still picture needs; text, EXIF, time, colour-profile and animation chunks are left out. */
function cleanPng(b: Uint8Array): Parsed {
  const keep = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
  const kept: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8, width = 0, height = 0, first = true, ended = false, data = false;
  while (i + 12 <= b.length) {
    const length = u32(b, i);
    if (length > b.length || i + 12 + length > b.length) return unreadable;
    const name = String.fromCharCode(b[i + 4] ?? 0, b[i + 5] ?? 0, b[i + 6] ?? 0, b[i + 7] ?? 0);
    if (first && name !== 'IHDR') return unreadable;
    if (name === 'acTL' || name === 'fcTL' || name === 'fdAT') return { ok: false, fault: 'animated' };
    if (name === 'IHDR') { if (!first || length !== 13) return unreadable; width = u32(b, i + 8); height = u32(b, i + 12); }
    if (name === 'IDAT') data = true;
    if (keep.has(name)) kept.push(b.subarray(i, i + 12 + length));
    first = false;
    i += 12 + length;
    if (name === 'IEND') { ended = true; break; }
  }
  if (!ended || !data || i !== b.length) return unreadable;
  return { ok: true, width, height, bytes: join(kept) };
}

/** WebP: still pictures only; EXIF, XMP and colour-profile chunks are left out and the extended header's flags say so. */
function cleanWebp(b: Uint8Array): Parsed {
  if (l32(b, 4) + 8 !== b.length) return unreadable;
  const kept: Uint8Array[] = [];
  let i = 12, width = 0, height = 0, picture = false;
  while (i + 8 <= b.length) {
    const name = String.fromCharCode(b[i] ?? 0, b[i + 1] ?? 0, b[i + 2] ?? 0, b[i + 3] ?? 0), size = l32(b, i + 4), padded = size + (size & 1);
    if (i + 8 + padded > b.length) return unreadable;
    const body = b.subarray(i + 8, i + 8 + size);
    if (name === 'ANIM' || name === 'ANMF') return { ok: false, fault: 'animated' };
    if (name === 'VP8X') {
      if (size < 10) return unreadable;
      if (((body[0] ?? 0) & 0x02) !== 0) return { ok: false, fault: 'animated' };
      width = ((body[4] ?? 0) | ((body[5] ?? 0) << 8) | ((body[6] ?? 0) << 16)) + 1;
      height = ((body[7] ?? 0) | ((body[8] ?? 0) << 8) | ((body[9] ?? 0) << 16)) + 1;
      const chunk = new Uint8Array(b.subarray(i, i + 8 + padded));
      chunk[8] = (body[0] ?? 0) & 0x10; // keep only the alpha flag: no animation, ICC profile, EXIF or XMP
      kept.push(chunk);
    } else if (name === 'VP8 ') {
      if (size < 10 || body[3] !== 0x9d || body[4] !== 0x01 || body[5] !== 0x2a) return unreadable;
      if (!width) { width = ((body[6] ?? 0) | ((body[7] ?? 0) << 8)) & 0x3fff; height = ((body[8] ?? 0) | ((body[9] ?? 0) << 8)) & 0x3fff; }
      picture = true; kept.push(b.subarray(i, i + 8 + padded));
    } else if (name === 'VP8L') {
      if (size < 5 || body[0] !== 0x2f) return unreadable;
      if (!width) { const bits = (body[1] ?? 0) | ((body[2] ?? 0) << 8) | ((body[3] ?? 0) << 16) | ((body[4] ?? 0) << 24); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
      picture = true; kept.push(b.subarray(i, i + 8 + padded));
    } else if (name === 'ALPH') kept.push(b.subarray(i, i + 8 + padded));
    // EXIF, XMP , ICCP and any chunk not named above are not kept
    i += 8 + padded;
  }
  if (!picture || i !== b.length) return unreadable;
  const body = join(kept), out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12));
  out[4] = (body.length + 4) & 0xff; out[5] = ((body.length + 4) >> 8) & 0xff; out[6] = ((body.length + 4) >> 16) & 0xff; out[7] = ((body.length + 4) >>> 24) & 0xff;
  out.set(body, 12);
  return { ok: true, width, height, bytes: out };
}

/**
 * The bytes of an upload, if they are what the browser says they are: a still picture of a size we take. The result is the
 * rewritten copy without any metadata. `claimed` is the content type the browser named; it must agree with the bytes.
 */
export function cleanPicture(bytes: Uint8Array, claimed: PictureType | null): { ok: true; picture: CleanPicture } | { ok: false; fault: PictureFault } {
  if (!bytes.length) return { ok: false, fault: 'empty' };
  if (bytes.length > PICTURE_LIMITS.bytes) return { ok: false, fault: 'too_large' };
  const type = sniff(bytes);
  if (!type) return { ok: false, fault: 'unknown_type' };
  if (claimed !== type) return { ok: false, fault: 'type_mismatch' };
  const parsed = type === 'jpeg' ? cleanJpeg(bytes) : type === 'png' ? cleanPng(bytes) : cleanWebp(bytes);
  if (!parsed.ok) return parsed;
  const { width, height } = parsed;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > PICTURE_LIMITS.side || height > PICTURE_LIMITS.side || width * height > PICTURE_LIMITS.pixels) return { ok: false, fault: 'dimensions' };
  return { ok: true, picture: { type, bytes: parsed.bytes, width, height } };
}

/** The sentence for a refused upload. */
export const FAULT_WORDS: Readonly<Record<PictureFault, string>> = Object.freeze({
  empty: 'That picture is empty.',
  too_large: 'That picture is too big to send. Try another one.',
  unknown_type: 'Only photos (JPEG, PNG or WebP) can be sent.',
  type_mismatch: 'That file is not the kind of picture it says it is.',
  animated: 'Animated pictures cannot be sent.',
  unreadable: 'That picture could not be read. Try another one.',
  dimensions: 'That picture is too large in size. Try a smaller one.',
});
