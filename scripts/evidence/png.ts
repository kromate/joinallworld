// A small PNG reader (and a writer, for tests) with no dependencies: node:zlib does the compression, the five row filters are here.
// It reads what a browser screenshot or a canvas export is: not interlaced, 8 or 16 bits, grey, grey with alpha, RGB, RGBA or palette.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image { width: number; height: number; /** RGBA, 4 bytes a pixel, rows top to bottom. */ data: Uint8Array }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Undo the row filters (0 none, 1 sub, 2 up, 3 average, 4 Paeth) in place. `bpp` is the bytes in one pixel. */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp, out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)], from = y * (stride + 1) + 1, to = y * stride, above = to - stride;
    if (type === undefined || type > 4) throw new Error(`PNG row ${y} has an unknown filter (${String(type)}).`);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[to + x - bpp]! : 0, up = y > 0 ? out[above + x]! : 0, corner = y > 0 && x >= bpp ? out[above + x - bpp]! : 0, value = raw[from + x]!;
      let add = 0;
      if (type === 1) add = left;
      else if (type === 2) add = up;
      else if (type === 3) add = (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      out[to + x] = (value + add) & 255;
    }
  }
  return out;
}

export function decodePng(file: Uint8Array): Image {
  const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file.');
  let at = 8, width = 0, height = 0, depth = 0, colour = -1, interlace = 0, palette: Buffer | null = null, transparency: Buffer | null = null;
  const parts: Buffer[] = [];
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at), kind = bytes.toString('latin1', at + 4, at + 8), body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; colour = body[9]!; interlace = body[12]!; }
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') transparency = body;
    else if (kind === 'IDAT') parts.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }
  if (!width || !height) throw new Error('The PNG has no header.');
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported.');
  const channels = CHANNELS[colour];
  if (!channels) throw new Error(`Unknown PNG colour type ${colour}.`);
  if (depth !== 8 && depth !== 16) throw new Error(`PNG bit depth ${depth} is not supported (8 or 16).`);
  if (colour === 3 && (depth !== 8 || !palette)) throw new Error('Palette PNGs need 8 bits and a palette.');
  const bytesPerChannel = depth / 8, bpp = channels * bytesPerChannel;
  const raw = inflateSync(Buffer.concat(parts));
  if (raw.length < (width * bpp + 1) * height) throw new Error('The PNG pixel data is short.');
  const pixels = unfilter(raw, width, height, bpp), data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * bpp, q = i * 4, sample = (channel: number): number => pixels[p + channel * bytesPerChannel]!;
    if (colour === 6) { data[q] = sample(0); data[q + 1] = sample(1); data[q + 2] = sample(2); data[q + 3] = sample(3); }
    else if (colour === 2) { data[q] = sample(0); data[q + 1] = sample(1); data[q + 2] = sample(2); data[q + 3] = 255; }
    else if (colour === 0) { data[q] = data[q + 1] = data[q + 2] = sample(0); data[q + 3] = 255; }
    else if (colour === 4) { data[q] = data[q + 1] = data[q + 2] = sample(0); data[q + 3] = sample(1); }
    else { const index = pixels[p]!; data[q] = palette![index * 3] ?? 0; data[q + 1] = palette![index * 3 + 1] ?? 0; data[q + 2] = palette![index * 3 + 2] ?? 0; data[q + 3] = transparency?.[index] ?? 255; }
  }
  return { width, height, data };
}

const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
const crc32 = (buffer: Buffer): number => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(kind: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
  const tail = Buffer.alloc(4), covered = Buffer.concat([head.subarray(4), body]); tail.writeUInt32BE(crc32(covered), 0);
  return Buffer.concat([head, body, tail]);
}

/** Write an RGBA image as a PNG. `filter` picks the row filter used for every row (0 to 4), so a test can exercise each one. */
export function encodePng(image: Image, filter = 0): Buffer {
  const { width, height, data } = image, stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const value = data[y * stride + x]!, left = x >= 4 ? data[y * stride + x - 4]! : 0, up = y > 0 ? data[(y - 1) * stride + x]! : 0, corner = y > 0 && x >= 4 ? data[(y - 1) * stride + x - 4]! : 0;
      let sub = 0;
      if (filter === 1) sub = left; else if (filter === 2) sub = up; else if (filter === 3) sub = (left + up) >> 1;
      else if (filter === 4) { const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner); sub = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner; }
      raw[y * (stride + 1) + 1 + x] = (value - sub) & 255;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
