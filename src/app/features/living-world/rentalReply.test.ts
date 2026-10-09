import assert from 'node:assert/strict'
import test from 'node:test'
import { validStarterRentalReply } from './rentalReply.ts'

const actor = 'account_abc123'
const envelope = () => ({
  serverTime: 1_800_000_000_000,
  ok: true,
  code: 'eligible',
  permission: null,
  revision: 0,
  eligible: true,
  valid: false,
  tripAvailable: false,
  allocation: 'none',
})
const permission = () => ({
  actor,
  resourceId: 'marina-starter-sedan',
  scope: 'district-driving',
  qualificationId: 'district-driving',
  qualificationVersion: 1,
  issuedAt: 1_799_999_999_000,
  status: 'active',
})

test('reads the real success envelope and active saved permission', () => {
  const eligible = envelope()
  assert.equal(validStarterRentalReply(eligible, actor), true)
  const saved = { ...eligible, code: 'permission_issued', permission: permission(), revision: 1, eligible: false, valid: true }
  assert.equal(validStarterRentalReply(saved, actor), true)
  assert.equal(validStarterRentalReply({ ...saved, code: 'permission_retained', duplicate: true }, actor), true)
  assert.equal(validStarterRentalReply({ ...eligible, ok: false, code: 'qualification_required', eligible: false, revision: null }, actor), true)
  assert.equal(validStarterRentalReply({ ...eligible, ok: false, code: 'qualification_required', eligible: false, permission: permission(), revision: 1 }, actor), true)
})

test('fails closed on malformed, foreign, expired-future, or impossible claims', () => {
  const invalid = [
    { ...envelope(), ok: 'true' },
    { ...envelope(), storage: 'failing' },
    { ...envelope(), revision: '0' },
    { ...envelope(), unknown: true },
    { ...envelope(), code: 'eligible', eligible: true, permission: permission() },
    { ...envelope(), code: 'permission_issued', valid: false, eligible: false, revision: 1, permission: permission() },
    { ...envelope(), code: 'permission_retained', valid: false, eligible: false, revision: 1, permission: permission() },
    { ...envelope(), ok: false, code: 'qualification_required', valid: true, eligible: false, revision: 1, permission: permission() },
    { ...envelope(), ok: true, code: 'qualification_required' },
    { ...envelope(), code: 'eligible', eligible: true, revision: 2 },
    { ...envelope(), tripAvailable: true },
    { ...envelope(), allocation: 'allocated' },
    { ...envelope(), code: 'eligible', eligible: true, valid: true },
    { ...envelope(), code: 'unexpected_refusal' },
    { ...envelope(), code: 'permission_retained', eligible: false, valid: true, revision: 1, permission: { ...permission(), actor: 'foreign_actor' } },
    { ...envelope(), code: 'permission_issued', eligible: false, valid: true, revision: 1, permission: { ...permission(), resourceId: 'other-car' } },
    { ...envelope(), code: 'permission_issued', eligible: false, valid: true, revision: 1, permission: { ...permission(), qualificationVersion: 2 } },
    { ...envelope(), code: 'permission_issued', eligible: false, valid: true, revision: 1, permission: { ...permission(), issuedAt: 1_800_000_000_001 } },
  ]
  for (const value of invalid) assert.equal(validStarterRentalReply(value, actor), false)
})
