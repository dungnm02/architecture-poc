import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldTypes, createSlot } from '../registry/index.js'
import { parseDocument } from './document.js'
import { emptyValueFor, seedBoundPaths } from './seed.js'

const testRegistry = new Map(fieldTypes)
testRegistry.set('Number', {
  slots: { value: createSlot('number') },
  emptyValue: null,
})
testRegistry.set('Boolean', {
  slots: { value: createSlot('boolean') },
  emptyValue: false,
})

function build(raw) {
  const result = parseDocument(raw, { registry: testRegistry })
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  return result.document
}

function assertNoUndefined(value, path = '$') {
  if (value === undefined) {
    assert.fail(`undefined seeded at ${path}`)
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assertNoUndefined(child, `${path}.${key}`)
  }
}

const seedDocument = () =>
  build({
    id: 'seed-doc',
    version: '1',
    fields: [
      {
        id: 'name',
        type: 'Text',
        binding: { value: 'properties.profile.name' },
        label: 'Name',
      },
      {
        id: 'startDate',
        type: 'Date',
        binding: { value: 'properties.dates.start' },
        label: 'Start date',
      },
      {
        id: 'age',
        type: 'Number',
        binding: { value: 'properties.age' },
        label: 'Age',
      },
      {
        id: 'active',
        type: 'Boolean',
        binding: { value: 'properties.flags.active' },
        label: 'Active',
      },
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        template: [
          {
            id: 'participantName',
            type: 'Text',
            binding: { value: 'name' },
            label: 'Participant name',
          },
          {
            id: 'participantTax',
            type: 'InputWithNA',
            binding: { value: 'taxId', isNA: 'taxIdIsNA' },
            label: 'Tax id',
          },
          {
            id: 'participantAdult',
            type: 'Boolean',
            binding: { value: 'adult' },
            label: 'Adult',
          },
        ],
      },
    ],
  })

test('emptyValueFor maps every slot type and never returns undefined', () => {
  assert.equal(emptyValueFor('string'), '')
  assert.equal(emptyValueFor('date'), '')
  assert.equal(emptyValueFor('number'), null)
  assert.equal(emptyValueFor('boolean'), false)
  assert.deepEqual(emptyValueFor('array'), [])
  assert.deepEqual(emptyValueFor('object'), {})
  assert.notEqual(emptyValueFor('unknown'), undefined)
})

test('seedBoundPaths creates missing containers and leaves in place', () => {
  const document = seedDocument()
  const data = {
    id: 'entity-1',
    meta: { keep: true },
    properties: { other: 'preserved' },
  }

  const result = seedBoundPaths(document, data)

  assert.equal(result, data)
  assert.equal(data.properties.profile.name, '')
  assert.equal(data.properties.dates.start, '')
  assert.equal(data.properties.age, null)
  assert.equal(data.properties.flags.active, false)
  assert.deepEqual(data.properties.participants, [])
  assert.equal(data.id, 'entity-1')
  assert.deepEqual(data.meta, { keep: true })
  assert.equal(data.properties.other, 'preserved')
  assertNoUndefined(data)
})

test('seedBoundPaths seeds template children in every existing row and preserves row data', () => {
  const document = seedDocument()
  const data = {
    properties: {
      participants: [
        { id: 'row-a', name: 'Ada', unbound: 1 },
        { name: undefined, taxId: 'T', taxIdIsNA: true },
      ],
    },
  }

  seedBoundPaths(document, data)

  const [first, second] = data.properties.participants
  assert.equal(first.id, 'row-a')
  assert.equal(first.name, 'Ada')
  assert.equal(first.taxId, '')
  assert.equal(first.taxIdIsNA, false)
  assert.equal(first.adult, false)
  assert.equal(first.unbound, 1)

  assert.equal(second.name, '')
  assert.equal(second.taxId, 'T')
  assert.equal(second.taxIdIsNA, true)
  assert.equal(second.adult, false)
  assert.equal(Object.hasOwn(second, 'id'), false)
  assertNoUndefined(data)
})

test('seedBoundPaths never overwrites existing entity values, including falsy ones', () => {
  const document = seedDocument()
  const data = {
    properties: {
      profile: { name: '   ' },
      dates: { start: '2026-01-02' },
      age: 0,
      flags: { active: false },
      participants: [{ name: '', taxId: 'E', taxIdIsNA: false }],
    },
  }

  seedBoundPaths(document, data)

  assert.equal(data.properties.profile.name, '   ')
  assert.equal(data.properties.dates.start, '2026-01-02')
  assert.equal(data.properties.age, 0)
  assert.equal(data.properties.flags.active, false)
  assert.equal(data.properties.participants[0].name, '')
  assert.equal(data.properties.participants[0].taxId, 'E')
  assert.equal(data.properties.participants[0].taxIdIsNA, false)
})

test('seedBoundPaths treats an absent array as [] and seeds no phantom rows', () => {
  const document = build({
    id: 'seed-absent-array',
    version: '1',
    fields: [
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        template: [
          {
            id: 'participantName',
            type: 'Text',
            binding: { value: 'name' },
            label: 'Participant name',
          },
        ],
      },
    ],
  })

  const data = { properties: {} }
  seedBoundPaths(document, data)

  assert.deepEqual(data.properties.participants, [])
})

test('seedBoundPaths handles a completely empty entity', () => {
  const document = seedDocument()
  const data = {}

  seedBoundPaths(document, data)

  assert.equal(data.properties.profile.name, '')
  assert.equal(data.properties.age, null)
  assert.deepEqual(data.properties.participants, [])
  assertNoUndefined(data)
})
