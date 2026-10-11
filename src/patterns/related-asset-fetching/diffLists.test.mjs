import test from 'node:test'
import assert from 'node:assert/strict'
import { diffLists, shallowEqual } from './diffLists.js'

const baseline = () => [
  { id: 'c1', type: 'COMMENT_HISTORY', text: 'one' },
  { id: 'c2', type: 'COMMENT_HISTORY', text: 'two' },
]

test('a clean draft is not dirty', () => {
  const items = baseline().map((row) => ({ ...row }))
  const diff = diffLists(items, baseline())
  assert.equal(diff.isDirty, false)
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.updated, [])
  assert.deepEqual(diff.removed, [])
})

test('editing a row is an update, not an add', () => {
  const items = baseline()
  items[1].text = 'two (edited)'
  const diff = diffLists(items, baseline())
  assert.equal(diff.isDirty, true)
  assert.deepEqual(diff.updated.map((row) => row.id), ['c2'])
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, [])
})

test('an id-less draft is an add', () => {
  const items = [...baseline(), { id: undefined, text: 'three' }]
  const diff = diffLists(items, baseline())
  assert.deepEqual(diff.added.map((row) => row.text), ['three'])
  assert.equal(diff.updated.length, 0)
})

test('a missing row is a removal', () => {
  const items = [baseline()[0]]
  const diff = diffLists(items, baseline())
  assert.deepEqual(diff.removed.map((row) => row.id), ['c2'])
})

test('order does not matter', () => {
  const items = [baseline()[1], baseline()[0]].map((row) => ({ ...row }))
  assert.equal(diffLists(items, baseline()).isDirty, false)
})

test('shallowEqual compares own enumerable props by value', () => {
  assert.equal(shallowEqual({ a: 1 }, { a: 1 }), true)
  assert.equal(shallowEqual({ a: 1 }, { a: 2 }), false)
  assert.equal(shallowEqual({ a: 1 }, { a: 1, b: 2 }), false)
  assert.equal(shallowEqual(null, null), true)
})
