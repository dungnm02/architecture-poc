import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEGMENT,
  INDEX,
  RESERVED,
  isIndexSegment,
  parsePath,
  toName,
  pathKey,
  pointerToSegments,
  pathStartsWith,
  pathMatchesTemplate,
  substituteIndex,
  getAtSegments,
} from './paths.js'

test('segment and index patterns are the ones the design pins', () => {
  assert.equal(SEGMENT.test('properties'), true)
  assert.equal(SEGMENT.test('_private'), true)
  assert.equal(SEGMENT.test('a-b_c1'), true)
  assert.equal(SEGMENT.test('1st'), false)
  assert.equal(SEGMENT.test('has space'), false)
  assert.equal(INDEX.test('0'), true)
  assert.equal(INDEX.test('12'), true)
  assert.equal(INDEX.test('01'), false)
  assert.equal(RESERVED.has('__proto__'), true)
  assert.equal(RESERVED.has('prototype'), true)
  assert.equal(RESERVED.has('constructor'), true)
})

test('isIndexSegment only accepts canonical indices', () => {
  assert.equal(isIndexSegment('0'), true)
  assert.equal(isIndexSegment('12'), true)
  assert.equal(isIndexSegment('01'), false)
  assert.equal(isIndexSegment('-1'), false)
  assert.equal(isIndexSegment('1.2'), false)
  assert.equal(isIndexSegment(''), false)
  assert.equal(isIndexSegment(2), false)
})

test('parsePath returns canonical segments for a dotted path', () => {
  const result = parsePath('properties.address.city')
  assert.equal(result.ok, true)
  assert.deepEqual(result.segments, ['properties', 'address', 'city'])
})

test('parsePath accepts canonical numeric segments; array proof is document parse work', () => {
  const result = parsePath('properties.items.0.name')
  assert.equal(result.ok, true)
  assert.deepEqual(result.segments, ['properties', 'items', '0', 'name'])
})

test('parsePath rejects non-strings, empty paths and empty segments', () => {
  assert.equal(parsePath(42).issue.code, 'path.type')
  assert.equal(parsePath('').issue.code, 'path.empty')

  for (const path of ['a..b', '.a', 'a.']) {
    const result = parsePath(path)
    assert.equal(result.ok, false, path)
    assert.equal(result.issue.code, 'path.segment', path)
    assert.equal(result.issue.severity, 'blocking')
  }
})

test('parsePath rejects reserved names anywhere in the path', () => {
  for (const path of ['__proto__.x', 'a.prototype', 'constructor', 'a.constructor.b']) {
    const result = parsePath(path)
    assert.equal(result.ok, false, path)
    assert.equal(result.issue.code, 'path.reserved', path)
  }
})

test('parsePath rejects every unsafe key character', () => {
  const unsafe = ['a.b[c', 'a.b]c', "a.b'c", 'a.b"c', 'a.b~c', 'a.b/c', 'a.b c']
  for (const path of unsafe) {
    const result = parsePath(path)
    assert.equal(result.ok, false, path)
    assert.equal(result.issue.code, 'path.unsafe', path)
  }
})

test('parsePath rejects leading-zero indices', () => {
  for (const path of ['items.01', 'items.00', 'items.01.name']) {
    const result = parsePath(path)
    assert.equal(result.ok, false, path)
    assert.equal(result.issue.code, 'path.index', path)
  }
})

test('toName only uses bracket syntax at the RHF boundary', () => {
  assert.equal(toName(['properties', 'address', 'city']), 'properties.address.city')
  assert.equal(toName(['properties', 'items', '0', 'name']), 'properties.items[0].name')
  assert.equal(toName([]), '')
  assert.equal(toName(['0']), '[0]')
})

test('pathKey is the collision-free internal map key', () => {
  assert.equal(pathKey(['properties', 'items', '0', 'name']), 'properties/items/0/name')
  assert.equal(pathKey([]), '')
})

test('pointerToSegments decodes JSON Pointer escapes', () => {
  assert.deepEqual(pointerToSegments('/properties/items/0/name'), [
    'properties',
    'items',
    '0',
    'name',
  ])
  assert.deepEqual(pointerToSegments('/a/b~1c/d~0e'), ['a', 'b/c', 'd~e'])
  assert.deepEqual(pointerToSegments(''), [])
})

test('pathStartsWith compares whole segments, not string prefixes', () => {
  assert.equal(pathStartsWith(['a', 'b'], ['a', 'b', 'c']), true)
  assert.equal(pathStartsWith(['a', 'b'], ['a', 'b']), true)
  assert.equal(pathStartsWith(['a'], ['ab', 'c']), false)
  assert.equal(pathStartsWith(['a', 'b', 'c'], ['a', 'b']), false)
  assert.equal(pathStartsWith([], ['a']), true)
})

test('pathMatchesTemplate matches exactly one index per wildcard', () => {
  const template = ['properties', 'items', '*', 'name']
  assert.equal(pathMatchesTemplate(template, ['properties', 'items', '0', 'name']), true)
  assert.equal(pathMatchesTemplate(template, ['properties', 'items', '12', 'name']), true)
  assert.equal(pathMatchesTemplate(template, ['properties', 'items', 'name']), false)
  assert.equal(pathMatchesTemplate(template, ['properties', 'items', 'x', 'name']), false)
  assert.equal(
    pathMatchesTemplate(template, ['properties', 'items', '0', 'other']),
    false,
  )
  assert.equal(
    pathMatchesTemplate(['a', 'b'], ['a', 'b']),
    true,
  )
})

test('substituteIndex replaces every wildcard with the row index', () => {
  assert.deepEqual(
    substituteIndex(['properties', 'items', '*', 'name'], 3),
    ['properties', 'items', '3', 'name'],
  )
  assert.deepEqual(substituteIndex(['a', 'b'], 3), ['a', 'b'])
})

test('getAtSegments walks objects and arrays without throwing on missing branches', () => {
  const values = {
    properties: {
      participants: [{ name: 'Ada' }, { name: 'Grace', taxId: null }],
      policy: { country: 'US' },
    },
  }

  assert.equal(
    getAtSegments(values, ['properties', 'participants', '1', 'name']),
    'Grace',
  )
  assert.equal(
    getAtSegments(values, ['properties', 'participants', '0', 'taxId']),
    undefined,
  )
  assert.equal(getAtSegments(values, ['properties', 'missing', 'name']), undefined)
  assert.equal(getAtSegments(values, ['properties', 'participants', '9']), undefined)
  assert.equal(getAtSegments(null, ['properties']), undefined)
  assert.equal(getAtSegments(values, []), values)
  assert.equal(getAtSegments(values, ['toString']), undefined)
})
