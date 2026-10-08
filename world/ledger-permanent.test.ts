import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from './ledger.ts';

test('immutable-input failure preserves its actual attempt and cannot be claimed again', () => {
  const ledger = new Ledger(':memory:');
  try {
    ledger.enqueue({ id: 'mismatched-source', kind: 'source', inputHash: 'hash', payload: {}, maxAttempts: 2 });
    const job = ledger.claim('worker', 1000, 1000)!;
    assert.equal(ledger.failPermanently(job.id, 'wrong-token', 1100, 'metadata count mismatch'), false);
    assert.equal(ledger.failPermanently(job.id, job.token, 1100, 'metadata count mismatch'), true);
    assert.equal(ledger.claim('worker', 5000, 1000), null);
    const [row] = ledger.list();
    assert.equal(row!.status, 'failed'); assert.equal(row!.attempt, 1); assert.equal(row!.maxAttempts, 2);
    assert.equal(row!.error, 'metadata count mismatch'); assert.equal(row!.leaseUntil, null);
    assert.equal(ledger.failPermanently(job.id, job.token, 1200, 'changed'), false);
  } finally { ledger.close(); }
});
test('an expired owner cannot permanently fail a job that the queue can recover', () => {
  const ledger = new Ledger(':memory:');
  try {
    ledger.enqueue({ id: 'recoverable', kind: 'source', inputHash: 'hash', payload: {}, maxAttempts: 2 });
    const first = ledger.claim('first', 1000, 100)!;
    assert.equal(ledger.failPermanently(first.id, first.token, 1100, 'stale input verdict'), false);
    const second = ledger.claim('second', 1100, 100)!;
    assert.equal(second.attempt, 2);
    assert.equal(ledger.failPermanently(first.id, first.token, 1101, 'stale owner'), false);
    assert.equal(ledger.complete(second.id, second.token, 1101, {}), true);
  } finally { ledger.close(); }
});
