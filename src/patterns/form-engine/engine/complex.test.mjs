import test from 'node:test'
import assert from 'node:assert/strict'
import { createComplexRegistry } from './complex.js'

const handle = (name, dirty = false) => ({
  name,
  validate: async () => [],
  submit: async () => ({ ok: true }),
  isDirty: () => dirty,
})

test('register stores by field id, exposes values and size, and returns cleanup', () => {
  const complex = createComplexRegistry()
  const first = handle('first')
  const second = handle('second')

  const cleanup = complex.register('a', first)
  complex.register('b', second)

  assert.equal(complex.get('a'), first)
  assert.deepEqual(complex.values(), [first, second])
  assert.equal(complex.size, 2)

  cleanup()
  assert.equal(complex.get('a'), undefined)
  assert.equal(complex.size, 1)
})

test('re-register replaces the handle for the same field id', () => {
  const complex = createComplexRegistry()
  const first = handle('first')
  const second = handle('second')

  const cleanupFirst = complex.register('a', first)
  complex.register('a', second)

  assert.equal(complex.get('a'), second)
  assert.equal(complex.size, 1)

  // The first registration's cleanup must not remove the replacement.
  cleanupFirst()
  assert.equal(complex.get('a'), second)
})

test('unregister removes only the same handle instance', () => {
  const complex = createComplexRegistry()
  const first = handle('first')
  const second = handle('second')

  complex.register('a', first)
  complex.unregister('a', second)
  assert.equal(complex.get('a'), first)

  complex.unregister('a', first)
  assert.equal(complex.get('a'), undefined)
  assert.equal(complex.size, 0)
})

test('isDirty reports any dirty handle and clear empties the registry', () => {
  const complex = createComplexRegistry()
  assert.equal(complex.isDirty(), false)

  complex.register('a', handle('a', false))
  complex.register('b', handle('b', false))
  assert.equal(complex.isDirty(), false)

  complex.register('b', handle('b', true))
  assert.equal(complex.isDirty(), true)

  complex.clear()
  assert.equal(complex.size, 0)
  assert.deepEqual(complex.values(), [])
  assert.equal(complex.isDirty(), false)
})

test('StrictMode double register is idempotent', () => {
  const complex = createComplexRegistry()
  const same = handle('same')

  // StrictMode runs effect -> cleanup -> effect. Registering the identical
  // handle twice must not grow the registry.
  const cleanupOne = complex.register('a', same)
  complex.register('a', same)
  assert.equal(complex.size, 1)

  cleanupOne()
  assert.equal(complex.size, 0)

  complex.register('a', same)
  assert.equal(complex.get('a'), same)
  complex.unregister('a', same)
  assert.equal(complex.size, 0)
})

test('invalid registrations are ignored without throwing', () => {
  const complex = createComplexRegistry()
  assert.doesNotThrow(() => complex.register('', handle('x')))
  assert.doesNotThrow(() => complex.register('a', null))
  assert.equal(complex.size, 0)
})
