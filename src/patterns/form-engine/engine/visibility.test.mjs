import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDocument } from './document.js'
import { computeModes } from './modes.js'
import {
  buildVisibilityIndex,
  isHidden,
  watchedPaths,
} from './visibility.js'

const rawDocument = () => ({
  id: 'visibility-form',
  version: 1,
  fields: [
    {
      id: 'country',
      type: 'Text',
      binding: { value: 'properties.country' },
      label: 'Country',
    },
    {
      id: 'notes',
      type: 'Text',
      binding: { value: 'properties.notes' },
      label: 'Notes',
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
          label: 'Name',
        },
      ],
    },
  ],
  rules: {
    visibility: [
      {
        id: 'hideNotesForXX',
        target: 'notes',
        when: { op: 'eq', path: 'properties.country', value: 'XX' },
      },
      {
        id: 'hideParticipantsForUS',
        target: 'participants',
        when: { op: 'eq', path: 'properties.country', value: 'US' },
      },
    ],
    cascades: [],
  },
})

const parsedFixture = () => {
  const parsed = parseDocument(rawDocument())
  assert.equal(parsed.ok, true)
  return parsed
}

test('buildVisibilityIndex inverts rules by target field', () => {
  const { document } = parsedFixture()
  const index = buildVisibilityIndex(document)

  assert.equal(index.get('notes').length, 1)
  assert.equal(index.get('notes')[0].id, 'hideNotesForXX')
  assert.equal(index.get('participants').length, 1)
  assert.equal(index.get('participants')[0].id, 'hideParticipantsForUS')
  assert.equal(index.get('country'), undefined)
})

test('isHidden evaluates the field rules against current values', () => {
  const { document } = parsedFixture()
  const index = buildVisibilityIndex(document)
  const options = { index, forcedHidden: document.forcedHidden }

  assert.equal(
    isHidden('notes', () => ({ properties: { country: 'XX' } }), options),
    true,
  )
  assert.equal(
    isHidden('notes', () => ({ properties: { country: 'US' } }), options),
    false,
  )
  assert.equal(
    isHidden('country', () => ({ properties: { country: 'XX' } }), options),
    false,
  )
})

test('isHidden honours forcedHidden even without a rule', () => {
  const { document } = parsedFixture()
  const index = buildVisibilityIndex(document)
  const options = { index, forcedHidden: new Set(['country']) }

  assert.equal(
    isHidden('country', () => ({ properties: { country: 'US' } }), options),
    true,
  )
})

test('watchedPaths unions dependency segments and deduplicates them', () => {
  const index = new Map([
    [
      'notes',
      [
        { dependsOn: [['properties', 'country'], ['properties', 'state']] },
        { dependsOn: [['properties', 'state'], ['properties', 'city']] },
      ],
    ],
  ])

  assert.deepEqual(watchedPaths('notes', index), [
    ['properties', 'country'],
    ['properties', 'state'],
    ['properties', 'city'],
  ])
  assert.deepEqual(watchedPaths('country', index), [])
})

test('a hidden group hides its template children through ancestor mode', () => {
  const { document } = parsedFixture()
  const index = buildVisibilityIndex(document)
  const permissions = new Map([
    ['country', 'EDIT'],
    ['notes', 'EDIT'],
    ['participants', 'EDIT'],
    ['participantName', 'EDIT'],
  ])

  const modes = computeModes(document, { properties: { country: 'US' } }, {
    permissions,
    permissionKeyByField: document.permissionKeyByField,
    formMode: 'EDIT',
    visibility: (fieldId, getValues) =>
      isHidden(fieldId, getValues, {
        index,
        forcedHidden: document.forcedHidden,
      }),
  })

  assert.equal(modes.get('participants'), 'HIDDEN')
  assert.equal(modes.get('participantName'), 'HIDDEN')
  assert.equal(modes.get('notes'), 'EDIT')
})
