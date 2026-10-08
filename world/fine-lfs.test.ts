import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFineLFSPointer } from './fine-lfs.ts';
import { FINE_LIMITS } from './fine-types.ts';

const digest = 'a'.repeat(64);
const pointer = (oid=digest,size=7) => Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`,'utf8');

test('admits canonical three-line Git LFS pointer and respects a subarray view',()=>{
  const source=Buffer.from(`xx${pointer().toString('utf8')}yy`), view=source.subarray(2,source.length-2);
  assert.deepEqual(parseFineLFSPointer(view,32),{sha256:digest,bytes:7});
});

test('rejects geometry bytes and noncanonical version, line endings, and extension forms',()=>{
  assert.throws(()=>parseFineLFSPointer(Buffer.from('{"type":"FeatureCollection"}'),32),/4096 bytes|LF newline/);
  assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v2\noid sha256:${digest}\nsize 7\n`),32),/version is unsupported/);
  assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v1\r\noid sha256:${digest}\r\nsize 7\r\n`),32),/LF line endings/);
  assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\nsize 7\next-0 x\n`),32),/exactly three LF-terminated lines/);
  assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\nsize 7\n\n`),32),/exactly three LF-terminated lines/);
});

test('rejects malformed UTF-8, BOMs, duplicate or malformed fields, and oversized pointer bodies',()=>{
  const canonical=pointer(),invalidUtf8=Buffer.from([...canonical.subarray(0,canonical.length-1),0xc3,0x0a]);
  assert.throws(()=>parseFineLFSPointer(invalidUtf8,32),/valid UTF-8/);
  assert.throws(()=>parseFineLFSPointer(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),pointer()]),32),/BOM/);
  assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\noid sha256:${digest}\n`),32),/(oid|size)/);
  assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${'A'.repeat(64)}\nsize 7\n`),32),/oid/);
  assert.throws(()=>parseFineLFSPointer(Buffer.alloc(4097,0x61),32),/1\.\.4096 bytes/);
});

test('enforces canonical positive safe size and supplied source cap',()=>{
  for(const size of ['0','00','01','-1','+1','1.0','9007199254740992','999999999999999999999999']){
    assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\nsize ${size}\n`),FINE_LIMITS.sourceBytes),/size/);
  }
  assert.throws(()=>parseFineLFSPointer(pointer(digest,33),32),/exceeds the admitted 32-byte/);
  assert.throws(()=>parseFineLFSPointer(pointer(digest,FINE_LIMITS.sourceBytes+1),FINE_LIMITS.sourceBytes),/exceeds the admitted/);
  assert.throws(()=>parseFineLFSPointer(pointer(),0),/maxSourceBytes/);
  assert.throws(()=>parseFineLFSPointer(pointer(),FINE_LIMITS.sourceBytes+1),/maxSourceBytes/);
  assert.throws(()=>parseFineLFSPointer(pointer(),1.5),/maxSourceBytes/);
});

test('requires exact terminal newline and refuses extra lines even when under cap',()=>{
  assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\nsize 7`),32),/end with one LF/);
  assert.throws(()=>parseFineLFSPointer(Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\nsize 7\nextra`),32),/end with one LF/);
});
