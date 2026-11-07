import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDocument } from './document.js'
import {
  newItem,
  scopeFor,
  validateItemKey,
  resolveItemIndex,
  itemKeyOf,
} from './repeat.js'

const template = () => [
  {
    id: 'participantId',
    type: 'Text',
    binding: { value: 'id' },
    label: 'ID',
    disabled: true,
  },
  {
    id: 'participantName',
    type: 'Text',
    binding: { value: 'name' },
    label: 'Participant name',
    required: true,
  },
  {
    id: 'participantRole',
    type: 'Text',
    binding: { value: 'role' },
    label: 'Role',
  },
  {
    id: 'participantTaxId',
    type: 'InputWithNA',
    binding: { value: 'taxId', isNA: 'taxIdNA' },
    label: 'Tax ID',
  },
]

function rawDocument({ itemKey = 'id', children = template() } = {}) {
  return {
    id: 'repeat-test',
    version: 1,
    fields: [
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        required: true,
        ...(itemKey === undefined || itemKey === null ? {} : { itemKey }),
        template: children,
      },
    ],
  }
}

function groupFrom(raw = rawDocument()) {
  const result = parseDocument(raw)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.deepEqual(
    result.issues.filter((issue) => issue.severity === 'blocking'),
    [],
  )
  return result.document.fieldsById.get('participants')
}

const codes = (issues) => issues.map((issue) => issue.code)

test('newItem builds every template slot, including InputWithNA pairs', () => {
  const group = groupFrom()
  const row = newItem(group, () => 'generated-1')

  assert.deepEqual(row, {
    id: 'generated-1',
    name: '',
    role: '',
    taxId: '',
    taxIdNA: false,
  })
  assert.equal(Object.hasOwn(row, '__key'), false)
})

test('newItem preserves template defaults and generates a missing item key once', () => {
  const raw = rawDocument()
  raw.fields[0].template.find(
    (child) => child.id === 'participantRole',
  ).defaultValue = 'Guest'
  const group = groupFrom(raw)

  const row = newItem(group, () => 'generated-default')
  assert.equal(row.role, 'Guest')
  assert.equal(row.name, '')
  assert.equal(row.id, 'generated-default')
})

test('newItem uses the default makeKey when the key is absent or empty', () => {
  const group = groupFrom()
  const first = newItem(group)
  const second = newItem(group)

  assert.equal(typeof first.id, 'string')
  assert.ok(first.id.length > 0)
  assert.notEqual(first.id, second.id)
})

test('newItem leaves rows alone when the group has no itemKey', () => {
  const group = groupFrom(rawDocument({ itemKey: null }))
  const row = newItem(group, () => 'must-not-be-used')

  assert.equal(row.id, '')
  assert.equal(row.name, '')
})

test('scopeFor appends the row index and carries the data item key', () => {
  const group = groupFrom()
  const row = { id: 'p1', name: 'Ada' }
  const scope = scopeFor(group, 2, row, 'VIEW')

  assert.deepEqual(scope, {
    segments: ['properties', 'participants', '2'],
    index: 2,
    key: 'p1',
    ancestorMode: 'VIEW',
  })
})

test('itemKeyOf and resolveItemIndex read identity from the data row', () => {
  const group = groupFrom()
  const rows = [{ id: 'p1' }, { id: 'p2' }, { name: 'missing' }]

  assert.equal(itemKeyOf(group, rows[0]), 'p1')
  assert.equal(itemKeyOf(group, rows[2]), undefined)
  assert.equal(resolveItemIndex(group, rows, 'p2'), 1)
  assert.equal(resolveItemIndex(group, rows, 'p9'), -1)

  const noKey = groupFrom(rawDocument({ itemKey: null }))
  assert.equal(resolveItemIndex(noKey, rows, 'p2'), -1)
})

test('validateItemKey warns about duplicate, missing and unsafe keys', () => {
  const group = groupFrom()
  const rows = [
    { id: 'p1' },
    { id: 'p1' },
    {},
    { id: 'bad key' },
    { id: '__proto__' },
    { id: 'ok' },
  ]

  const issues = validateItemKey(group, rows)

  assert.ok(issues.every((issue) => issue.severity === 'warning'))
  assert.equal(
    codes(issues).filter((code) => code === 'repeat.itemKey.duplicate').length,
    2,
  )
  assert.equal(
    codes(issues).filter((code) => code === 'repeat.itemKey.missing').length,
    1,
  )
  assert.equal(
    codes(issues).filter((code) => code === 'repeat.itemKey.unsafe').length,
    2,
  )

  const duplicateIndexes = issues
    .filter((issue) => issue.code === 'repeat.itemKey.duplicate')
    .map((issue) => issue.detail?.index)
  assert.deepEqual(duplicateIndexes.sort(), [0, 1])
  assert.equal(
    issues.some((issue) => issue.fieldId !== 'participants'),
    false,
  )
})

test('validateItemKey is a no-op without an itemKey', () => {
  const group = groupFrom(rawDocument({ itemKey: null }))
  assert.deepEqual(validateItemKey(group, [{ id: 'p1' }, { id: 'p1' }]), [])
})

test('nested repeat groups remain rejected at parse', () => {
  const raw = rawDocument()
  raw.fields[0].template.push({
    id: 'nested',
    type: 'RepeatGroup',
    binding: { value: 'nested' },
    label: 'Nested',
    template: [
      { id: 'nestedLeaf', type: 'Text', binding: { value: 'value' } },
    ],
  })

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(codes(result.issues).includes('repeat.nested'), true)
  assert.equal(result.document.fieldsById.has('nested'), false)
  assert.deepEqual(
    result.document.fieldsById
      .get('participants')
      .template.map((child) => child.id),
    ['participantId', 'participantName', 'participantRole', 'participantTaxId'],
  )
})
