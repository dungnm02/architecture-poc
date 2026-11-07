import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SLOT_TYPES,
  createSlot,
  fieldTypes,
  findSlotTypeMismatches,
  slotValueMatches,
} from './index.js'

test('slot normalisation coerces empty values per slot type', () => {
  assert.equal(SLOT_TYPES.string.normalize(null), '')
  assert.equal(SLOT_TYPES.string.normalize(undefined), '')
  assert.equal(SLOT_TYPES.date.normalize(20260101), '20260101')
  assert.equal(SLOT_TYPES.number.normalize(''), null)
  assert.equal(SLOT_TYPES.number.normalize('4.5'), 4.5)
  assert.equal(SLOT_TYPES.boolean.normalize('yes'), false)
  assert.deepEqual(SLOT_TYPES.array.normalize('not-an-array'), [])
  assert.deepEqual(SLOT_TYPES.object.normalize([]), {})
})

test('createSlot rejects unknown slot types and merges metadata', () => {
  assert.throws(() => createSlot('mystery'), /Unknown slot type/)
  const slot = createSlot('string', { required: true })
  assert.equal(slot.type, 'string')
  assert.equal(slot.required, true)
  assert.equal(slot.emptyValue, '')
})

test('registry maps the M3 field types to pure slot metadata', () => {
  assert.deepEqual(Object.keys(fieldTypes.get('Text').slots), ['value'])
  assert.deepEqual(Object.keys(fieldTypes.get('Date').slots), ['value'])
  assert.deepEqual(Object.keys(fieldTypes.get('InputWithNA').slots), [
    'value',
    'isNA',
  ])
})

test('slotValueMatches accepts a value for the declared slot type', () => {
  assert.equal(slotValueMatches('string', 'US'), true)
  assert.equal(slotValueMatches('string', null), true)
  assert.equal(slotValueMatches('date', '2026-01-01'), true)
  assert.equal(slotValueMatches('number', 0), true)
  assert.equal(slotValueMatches('number', null), true)
  assert.equal(slotValueMatches('boolean', false), true)
  assert.equal(slotValueMatches('array', []), true)
  assert.equal(slotValueMatches('object', { a: 1 }), true)

  assert.equal(slotValueMatches('string', 42), false)
  assert.equal(slotValueMatches('date', false), false)
  assert.equal(slotValueMatches('number', '1'), false)
  assert.equal(slotValueMatches('boolean', 'true'), false)
  assert.equal(slotValueMatches('array', {}), false)
  assert.equal(slotValueMatches('object', []), false)
  assert.equal(slotValueMatches('mystery', 'x'), false)
})

const textDef = () => ({
  id: 'country',
  type: 'Text',
  binding: {
    value: { relative: false, segments: ['properties', 'country'] },
  },
  slots: { value: { type: 'string' } },
})

const inputWithNADef = () => ({
  id: 'taxId',
  type: 'InputWithNA',
  binding: {
    value: { relative: false, segments: ['properties', 'taxId'] },
    isNA: { relative: false, segments: ['properties', 'taxIdIsNA'] },
  },
  slots: {
    value: { type: 'string' },
    isNA: { type: 'boolean' },
  },
})

test('findSlotTypeMismatches reports no mismatch for matching values', () => {
  const values = {
    properties: { country: 'US', taxId: 'T-1', taxIdIsNA: false },
  }

  assert.deepEqual(findSlotTypeMismatches(textDef(), values), [])
  assert.deepEqual(findSlotTypeMismatches(inputWithNADef(), values), [])
})

test('findSlotTypeMismatches reports the field, slot and expected type', () => {
  const mismatches = findSlotTypeMismatches(textDef(), {
    properties: { country: 42 },
  })

  assert.equal(mismatches.length, 1)
  assert.deepEqual(mismatches[0], {
    fieldId: 'country',
    slotName: 'value',
    expected: 'string',
    actual: 42,
  })

  const multi = findSlotTypeMismatches(inputWithNADef(), {
    properties: { taxId: 'T-1', taxIdIsNA: 'yes' },
  })

  assert.equal(multi.length, 1)
  assert.equal(multi[0].slotName, 'isNA')
  assert.equal(multi[0].expected, 'boolean')
})
