import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GAIN_LIMIT, GRADE_KINDS, HOUR_BANDS, LUT_SIZE, applyGrade, buildLut, gradeFor, gradeKind, gradeParams, hourBand, lutHash } from './grade.ts'

type Climate = NonNullable<Parameters<typeof gradeFor>[0]>
// Printed once from the generator (PRINT_GRADES=1) and pinned: a grade that changes must be a deliberate edit of this table.
const PINNED: Record<string, string> = {
  'harmattan/dawn': '08c11fb7', 'harmattan/day': '68cdbd85', 'harmattan/dusk': '0e9702d3', 'harmattan/night': '813632d2',
  'rains/dawn': 'b267c38f', 'rains/day': 'dbd85df8', 'rains/dusk': '7acfb366', 'rains/night': 'ce868767',
  'clear/dawn': '374007ce', 'clear/day': 'd6b46d69', 'clear/dusk': '804b6902', 'clear/night': '1770156d',
}

test('every value is finite and inside 0 to 1, and the table has the right size', () => {
  for (const kind of GRADE_KINDS) for (const band of HOUR_BANDS) {
    const lut = buildLut(gradeParams(kind, band))
    assert.equal(lut.length, LUT_SIZE ** 3 * 4)
    for (let i = 0; i < lut.length; i += 1) assert.ok(Number.isFinite(lut[i]) && lut[i]! >= 0 && lut[i]! <= 255)
    for (let i = 3; i < lut.length; i += 4) assert.equal(lut[i], 255)
  }
})

test('luminance rises along the grey axis for every grade', () => {
  for (const kind of GRADE_KINDS) for (const band of HOUR_BANDS) {
    const p = gradeParams(kind, band)
    let last = -1
    for (let i = 0; i <= 64; i += 1) {
      const v = i / 64, [r, g, b] = applyGrade(p, v, v, v)
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      assert.ok(Number.isFinite(luma) && luma >= 0 && luma <= 1)
      assert.ok(luma >= last - 1e-12, `${kind}/${band} dips at ${v}`)
      last = luma
    }
  }
})

test('the grade is subtle: every gain stays within 8%, black stays near black and white near white', () => {
  for (const kind of GRADE_KINDS) for (const band of HOUR_BANDS) {
    const p = gradeParams(kind, band)
    for (const gain of p.gain) assert.ok(gain >= 1 - GAIN_LIMIT - 1e-9 && gain <= 1 + GAIN_LIMIT + 1e-9, `${kind}/${band} gain ${gain}`)
    for (const v of applyGrade(p, 0, 0, 0)) assert.ok(v < 0.06)
    for (const v of applyGrade(p, 1, 1, 1)) assert.ok(v > 0.9)
  }
})

test('the moods point the way the brief says', () => {
  const warm = (kind: Parameters<typeof gradeParams>[0], band: Parameters<typeof gradeParams>[1]) => { const [r, , b] = applyGrade(gradeParams(kind, band), 0.5, 0.5, 0.5); return r - b }
  assert.ok(warm('harmattan', 'day') > 0.02, 'harmattan is amber')
  assert.ok(warm('rains', 'day') < -0.01, 'the rains are grey-blue')
  assert.ok(warm('clear', 'day') < 0, 'a clear dry season is blue')
  assert.ok(warm('clear', 'night') > warm('clear', 'day'), 'night is warmer than day (sodium)')
  const [, g, b] = applyGrade(gradeParams('clear', 'night'), 0.5, 0.5, 0.5)
  assert.ok(g > b, 'night leans orange: less blue than green')
})

test('hour bands follow the lighting presets', () => {
  assert.equal(hourBand(0), 'night'); assert.equal(hourBand(360), 'dawn'); assert.equal(hourBand(720), 'day')
  assert.equal(hourBand(1100), 'dusk'); assert.equal(hourBand(1300), 'night')
})

test('a season picks its mood from the real climates', () => {
  // The same shapes as the cities' own CityClimate (Kano has a harmattan, Lagos does not).
  const kano: Climate = { rainChanceByMonth: [0.01, 0.01, 0.02, 0.06, 0.2, 0.4, 0.55, 0.65, 0.35, 0.08, 0.01, 0.01], clearLabel: 'Hot and dry', harmattan: { months: [11, 12, 1, 2], label: 'Harmattan haze' } }
  const lagos: Climate = { rainChanceByMonth: [0.05, 0.08, 0.15, 0.3, 0.5, 0.6, 0.55, 0.45, 0.5, 0.4, 0.15, 0.05], clearLabel: 'Warm and humid' }
  const at = (month: number, hour: number) => Date.UTC(2026, month - 1, 15, hour - 1)
  assert.deepEqual(gradeFor(kano, at(1, 13)), { kind: 'harmattan', band: 'day' })
  assert.equal(gradeFor(lagos, at(7, 13)).kind, 'rains')
  assert.equal(gradeFor(lagos, at(1, 22)).band, 'night')
  assert.equal(gradeFor(null, at(7, 13)).kind, 'clear')
  assert.equal(gradeKind({ wet: true, harmattan: true }), 'harmattan')
})

test('each grade has a fixed fingerprint', () => {
  const table: Record<string, string> = {}
  for (const kind of GRADE_KINDS) for (const band of HOUR_BANDS) table[`${kind}/${band}`] = lutHash(buildLut(gradeParams(kind, band)))
  if (process.env.PRINT_GRADES) console.log(JSON.stringify(table, null, 2))
  assert.deepEqual(table, PINNED)
  assert.equal(new Set(Object.values(table)).size, 12, 'no two grades are the same')
})
