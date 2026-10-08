import { FINE_LIMITS } from './fine-types.ts';

const POINTER_VERSION = 'version https://git-lfs.github.com/spec/v1';
const POINTER_MAX_BYTES = 4_096;
const OID_LINE = /^oid sha256:([a-f0-9]{64})$/;
const SIZE_LINE = /^size ([1-9][0-9]*)$/;

/**
 * Parse the strict three-line Git LFS pointer subset admitted by the fine-source cache.
 * Git LFS supports pointer extensions; this bounded admission parser intentionally rejects
 * them and does not claim to parse every valid LFS pointer form.
 */
export function parseFineLFSPointer(bytes: Uint8Array, maxSourceBytes: number): { sha256: string; bytes: number } {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Git LFS pointer input must be bytes');
  if (bytes.byteLength < 1 || bytes.byteLength > POINTER_MAX_BYTES) throw new RangeError('Git LFS pointer must be 1..4096 bytes');
  if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > FINE_LIMITS.sourceBytes) {
    throw new RangeError(`maxSourceBytes must be a positive integer no greater than ${FINE_LIMITS.sourceBytes}`);
  }
  if (bytes[bytes.byteLength - 1] !== 0x0a) throw new TypeError('Git LFS pointer must end with one LF newline');
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new TypeError('Git LFS pointer must not contain a UTF-8 BOM');

  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (error) { throw new TypeError(`Git LFS pointer is not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`); }

  // Three content lines plus exactly one terminal LF: no CRLF, blank lines or extensions.
  if (text.includes('\r')) throw new TypeError('Git LFS pointer must use canonical LF line endings, not CRLF');
  const lines = text.split('\n');
  if (lines.length !== 4 || lines[3] !== '') throw new TypeError('Git LFS pointer must contain exactly three LF-terminated lines');
  if (lines[0] !== POINTER_VERSION) throw new TypeError('Git LFS pointer version is unsupported');
  const oid = OID_LINE.exec(lines[1]!);
  if (!oid) throw new TypeError('Git LFS pointer oid must be one lowercase SHA-256 line');
  const sizeMatch = SIZE_LINE.exec(lines[2]!);
  if (!sizeMatch) throw new TypeError('Git LFS pointer size must be a positive canonical decimal integer');
  const size = Number(sizeMatch[1]);
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('Git LFS pointer size is outside the safe positive integer range');
  if (size > maxSourceBytes) throw new RangeError(`Git LFS object size ${size} exceeds the admitted ${maxSourceBytes}-byte source cap`);
  return { sha256: oid[1]!, bytes: size };
}
