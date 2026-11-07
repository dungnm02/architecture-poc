import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OPERATORS,
  MAX_DEPTH,
  MAX_NODES,
  validateCondition,
  collectPaths,
  evaluate,
} from './conditions.js'
import { pathKey } from './paths.js'

const DECLARED = new Set([
  'properties/country',
  'properties/state',
  'properties/amount',
  'properties/participants/*/name',
  'properties/participants/*/country',
])

const resolvePath = (segments) =>
  DECLARED.has(pathKey(segments)) ? { ok: true, segments } : { ok: false }

test('the operator allowlist is closed', () => {
  assert.deepEqual(
    [...OPERATORS].sort(),
    ['and', 'empty', 'eq', 'gt', 'gte', 'in', 'lt', 'lte', 'neq', 'not', 'notIn', 'or'],
  )
  assert.equal(MAX_DEPTH, 8)
  assert.equal(MAX_NODES, 64)
})

test('a valid leaf condition normalises its dotted path to segments', () => {
  const result = validateCondition(
    { op: 'eq', path: 'properties.country', value: 'US' },
    { resolvePath },
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.condition.path, ['properties', 'country'])
  assert.equal(result.condition.value, 'US')
  assert.deepEqual(result.dependsOn, [['properties', 'country']])
})

test('path arrays are accepted and copied', () => {
  const path = ['properties', 'state']
  const result = validateCondition({ op: 'empty', path }, { resolvePath })
  assert.equal(result.ok, true)
  assert.deepEqual(result.condition.path, path)
  assert.notEqual(result.condition.path, path)
})

test('and/or/not compose and collect dependencies', () => {
  const result = validateCondition(
    {
      op: 'and',
      args: [
        { op: 'eq', path: 'properties.country', value: 'US' },
        {
          op: 'or',
          args: [
            { op: 'empty', path: 'properties.state' },
            { op: 'not', args: [{ op: 'neq', path: 'properties.amount', value: 0 }] },
          ],
        },
      ],
    },
    { resolvePath },
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.dependsOn, [
    ['properties', 'country'],
    ['properties', 'state'],
    ['properties', 'amount'],
  ])
})

test('unknown operators fail closed', () => {
  const result = validateCondition(
    { op: 'jsonLogic', path: 'properties.country', value: 'US' },
    { resolvePath },
  )
  assert.equal(result.ok, false)
  assert.equal(result.condition, null)
  assert.ok(result.issues.some((issue) => issue.code === 'condition.operator'))
  assert.ok(result.issues.every((issue) => issue.severity === 'blocking'))
})

test('not takes exactly one argument', () => {
  for (const args of [[], [
    { op: 'empty', path: 'properties.country' },
    { op: 'empty', path: 'properties.state' },
  ]]) {
    const result = validateCondition({ op: 'not', args }, { resolvePath })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((issue) => issue.code === 'condition.arity'))
  }
})

test('and/or reject missing or non-array args', () => {
  for (const op of ['and', 'or']) {
    for (const args of [undefined, [], 'x']) {
      const result = validateCondition({ op, args }, { resolvePath })
      assert.equal(result.ok, false, `${op} ${String(args)}`)
      assert.ok(result.issues.some((issue) => issue.code === 'condition.args'))
    }
  }
})

test('depth is capped at MAX_DEPTH', () => {
  const leaf = { op: 'empty', path: 'properties.country' }

  let allowed = leaf
  for (let i = 0; i < MAX_DEPTH - 1; i += 1) {
    allowed = { op: 'not', args: [allowed] }
  }
  assert.equal(validateCondition(allowed, { resolvePath }).ok, true)

  let tooDeep = leaf
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    tooDeep = { op: 'not', args: [tooDeep] }
  }
  const result = validateCondition(tooDeep, { resolvePath })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'condition.depth'))
})

test('node count is capped at MAX_NODES', () => {
  const leaves = (count) =>
    Array.from({ length: count }, () => ({
      op: 'empty',
      path: 'properties.country',
    }))

  const allowed = validateCondition(
    { op: 'and', args: leaves(MAX_NODES - 1) },
    { resolvePath },
  )
  assert.equal(allowed.ok, true)

  const tooMany = validateCondition(
    { op: 'and', args: leaves(MAX_NODES) },
    { resolvePath },
  )
  assert.equal(tooMany.ok, false)
  assert.ok(tooMany.issues.some((issue) => issue.code === 'condition.nodes'))
})

test('paths must be syntactically safe and declared', () => {
  const bad = [
    { op: 'eq', path: '', value: 1 },
    { op: 'eq', path: 'properties..country', value: 1 },
    { op: 'eq', path: 'properties.__proto__', value: 1 },
    { op: 'eq', path: "properties.co'untry", value: 1 },
    { op: 'eq', path: 'properties.unknown', value: 1 },
    { op: 'eq', path: ['properties', 'items', '*', 'name'], value: 1 },
  ]
  for (const condition of bad) {
    const result = validateCondition(condition, { resolvePath })
    assert.equal(result.ok, false, JSON.stringify(condition))
    assert.ok(result.issues.some((issue) => issue.code === 'condition.path'))
  }
})

test('a wildcard is accepted only when resolvePath proves a template position', () => {
  const result = validateCondition(
    { op: 'eq', path: ['properties', 'participants', '*', 'name'], value: 'A' },
    { resolvePath },
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.dependsOn, [
    ['properties', 'participants', '*', 'name'],
  ])
})

test('group-relative paths normalise under the group wildcard', () => {
  const result = validateCondition(
    { op: 'eq', path: 'country', value: 'US' },
    { resolvePath, scopePrefix: ['properties', 'participants', '*'] },
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.condition.path, [
    'properties',
    'participants',
    '*',
    'country',
  ])
})

test('absolute paths stay absolute even when a scopePrefix exists', () => {
  const result = validateCondition(
    { op: 'eq', path: 'properties.country', value: 'US' },
    { resolvePath, scopePrefix: ['properties', 'participants', '*'] },
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.condition.path, ['properties', 'country'])
})

test('collectPaths dedupes nested dependencies', () => {
  const result = validateCondition(
    {
      op: 'and',
      args: [
        { op: 'eq', path: 'properties.country', value: 'US' },
        { op: 'not', args: [{ op: 'eq', path: 'properties.country', value: 'CA' }] },
        { op: 'empty', path: 'properties.state' },
      ],
    },
    { resolvePath },
  )
  assert.equal(result.ok, true)
  assert.deepEqual(collectPaths(result.condition), [
    ['properties', 'country'],
    ['properties', 'state'],
  ])
})

test('evaluate reads values and compares strictly', () => {
  const values = {
    properties: {
      country: 'US',
      state: '',
      amount: 0,
      participants: [{ name: 'A' }, { name: 'B' }],
    },
  }

  assert.equal(
    evaluate({ op: 'eq', path: ['properties', 'country'], value: 'US' }, values),
    true,
  )
  assert.equal(
    evaluate({ op: 'neq', path: ['properties', 'country'], value: 'CA' }, values),
    true,
  )
  assert.equal(
    evaluate({ op: 'eq', path: ['properties', 'amount'], value: '0' }, values),
    false,
  )
  assert.equal(
    evaluate({ op: 'in', path: ['properties', 'country'], value: ['US', 'CA'] }, values),
    true,
  )
  assert.equal(
    evaluate({ op: 'notIn', path: ['properties', 'country'], value: ['US'] }, values),
    false,
  )
  assert.equal(
    evaluate({ op: 'gt', path: ['properties', 'amount'], value: -1 }, values),
    true,
  )
  assert.equal(
    evaluate({ op: 'gte', path: ['properties', 'amount'], value: 0 }, values),
    true,
  )
  assert.equal(
    evaluate({ op: 'lt', path: ['properties', 'amount'], value: 0 }, values),
    false,
  )
  assert.equal(
    evaluate({ op: 'lte', path: ['properties', 'amount'], value: 0 }, values),
    true,
  )
})

test('empty treats blank, null and empty containers as empty, not 0/false', () => {
  const emptyValues = [undefined, null, '', [], {}]
  for (const value of emptyValues) {
    assert.equal(
      evaluate({ op: 'empty', path: ['value'] }, { value }),
      true,
      JSON.stringify(value),
    )
  }
  for (const value of [0, false, 'x', [1], { a: 1 }]) {
    assert.equal(
      evaluate({ op: 'empty', path: ['value'] }, { value }),
      false,
      JSON.stringify(value),
    )
  }
})

test('evaluate resolves template wildcards with itemIndex only', () => {
  const values = {
    properties: { participants: [{ name: 'A' }, { name: 'B' }] },
  }
  const condition = {
    op: 'eq',
    path: ['properties', 'participants', '*', 'name'],
    value: 'B',
  }
  assert.equal(evaluate(condition, values, { itemIndex: 1 }), true)
  assert.equal(evaluate(condition, values, { itemIndex: 0 }), false)
  assert.equal(evaluate(condition, values), false)
})

test('and and or short-circuit', () => {
  let reads = 0
  const values = { properties: { country: 'CA' } }
  Object.defineProperty(values.properties, 'state', {
    enumerable: true,
    get() {
      reads += 1
      return 'boom'
    },
  })

  const andCondition = {
    op: 'and',
    args: [
      { op: 'eq', path: ['properties', 'country'], value: 'US' },
      { op: 'eq', path: ['properties', 'state'], value: 'boom' },
    ],
  }
  assert.equal(evaluate(andCondition, values), false)
  assert.equal(reads, 0)

  const orCondition = {
    op: 'or',
    args: [
      { op: 'eq', path: ['properties', 'country'], value: 'CA' },
      { op: 'eq', path: ['properties', 'state'], value: 'boom' },
    ],
  }
  assert.equal(evaluate(orCondition, values), true)
  assert.equal(reads, 0)
})

test('malformed conditions fail closed', () => {
  assert.equal(evaluate(null, {}), false)
  assert.equal(evaluate({ op: 'unknown', path: ['a'], value: 1 }, {}), false)
  assert.equal(evaluate({ op: 'not', args: [] }, {}), false)
  assert.equal(evaluate({ op: 'eq', path: ['a'] }, {}), false)
})
