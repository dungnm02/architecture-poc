import test from 'node:test'
import assert from 'node:assert/strict'
import { slotSegments } from './slotPaths.js'

const absoluteDef = {
  id: 'country',
  binding: {
    value: { relative: false, segments: ['properties', 'policy', 'country'] },
  },
}

const relativeDef = {
  id: 'participantName',
  binding: { value: { relative: true, segments: ['name'] } },
}

test('absolute bindings ignore the scope', () => {
  assert.deepEqual(slotSegments(absoluteDef, 'value', { segments: ['ignored'] }), [
    'properties',
    'policy',
    'country',
  ])
  assert.deepEqual(slotSegments(absoluteDef, 'value', null), [
    'properties',
    'policy',
    'country',
  ])
})

test('relative bindings are prefixed with the scope segments', () => {
  assert.deepEqual(
    slotSegments(relativeDef, 'value', {
      segments: ['properties', 'participants', '0'],
    }),
    ['properties', 'participants', '0', 'name'],
  )
})

test('relative bindings without a scope fall back to their own segments', () => {
  assert.deepEqual(slotSegments(relativeDef, 'value', null), ['name'])
})

test('a missing slot returns no segments', () => {
  assert.deepEqual(slotSegments(absoluteDef, 'isNA'), [])
})
