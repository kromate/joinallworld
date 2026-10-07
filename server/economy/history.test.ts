import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from '../test-fixture.ts'
import type { WalletHistoryResponse } from '../../src/types/support.ts'
import { peerTransferId, walletEffectSink } from './effects.ts'

type Answer = WalletHistoryResponse & { status: number; error?: string }
const answer = async (response: Response): Promise<Answer> => ({ status: response.status, ...await response.json() } as Answer)

test('wallet history is authenticated, owner-scoped, bounded and cursor-paginated', async t => {
  const f = await fixture(t), ada = await f.device('Ada'), bola = await f.device('Bola')
  const transferId = peerTransferId(ada.id, `${f.now()}:${randomUUID()}`)
  await f.server.store.transact(db => {
    const ak = db.$store?.sessionKeyByPublicId(ada.id), bk = db.$store?.sessionKeyByPublicId(bola.id); assert.ok(ak && bk)
    const a = db.sessions[ak], b = db.sessions[bk]; assert.ok(a && b)
    walletEffectSink(a,'lagos','transfer-op',transferId)({at:1,amount:-10,balanceAfter:4990,reason:'Transfer to Bola'})
    const sink=walletEffectSink(a,'lagos','history-seed');for(let i=2;i<=55;i++)sink({at:i,amount:1,balanceAfter:4989+i,reason:`Credit ${i}`})
    walletEffectSink(b,'lagos','bola-only')({at:56,amount:7,balanceAfter:5007,reason:'Bola credit'})
  })
  assert.equal((await answer(await f.request('/api/support/history'))).status,401)
  for(const cursor of ['-1','1.5','no'])assert.deepEqual(((invalid)=>[invalid.status,invalid.error])(await answer(await f.request(`/api/support/history?after=${cursor}`,undefined,ada.cookie))),[400,'invalid_cursor'])
  const first=await answer(await f.request('/api/support/history',undefined,ada.cookie));assert.deepEqual([first.entries.length,first.entries[0]?.seq,first.entries.at(-1)?.seq,first.next],[50,1,50,50]);assert.equal(first.entries[0]?.transferId,transferId)
  assert.deepEqual(Object.keys(first.entries[0]??{}).sort(),['seq','at','amount','balanceAfter','reason','cityId','operationId','transferId'].sort());assert.equal(first.coverage.complete,false)
  const second=await answer(await f.request(`/api/support/history?after=${first.next}`,undefined,ada.cookie));assert.deepEqual([second.entries.length,second.entries[0]?.seq,second.entries.at(-1)?.seq,second.next],[5,51,55,null])
  const other=await answer(await f.request('/api/support/history',undefined,bola.cookie));assert.deepEqual(other.entries.map(entry=>[entry.seq,entry.reason]),[[56,'Bola credit']]);assert.equal(JSON.stringify(other).includes(ada.id),false);assert.equal(JSON.stringify(first).includes(ada.cookie),false)
})
