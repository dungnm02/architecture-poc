import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createIssue,
  hasBlocking,
  blockingIssues,
  messageFor,
} from './issues.js'

test('createIssue keeps the contract shape and lifts fieldId/ruleId', () => {
  assert.deepEqual(
    createIssue('field.type.unknown', 'blocking', {
      fieldId: 'mystery',
      ruleId: 'r1',
      type: 'Mystery',
    }),
    {
      code: 'field.type.unknown',
      severity: 'blocking',
      fieldId: 'mystery',
      ruleId: 'r1',
      detail: { type: 'Mystery' },
    },
  )
})

test('createIssue defaults severity to blocking and omits empty detail', () => {
  assert.deepEqual(createIssue('document.invalid'), {
    code: 'document.invalid',
    severity: 'blocking',
  })
  assert.deepEqual(createIssue('x', 'warning'), {
    code: 'x',
    severity: 'warning',
  })
})

test('blocking helpers separate policy from diagnostics', () => {
  const issues = [
    createIssue('a', 'warning'),
    createIssue('b', 'blocking'),
    createIssue('c', 'blocking'),
  ]
  assert.equal(hasBlocking(issues), true)
  assert.equal(hasBlocking([issues[0]]), false)
  assert.equal(hasBlocking([]), false)
  assert.deepEqual(blockingIssues(issues).map((issue) => issue.code), ['b', 'c'])
})

test('messageFor never echoes regexes, code paths or enum values', () => {
  const pattern = messageFor(
    {
      keyword: 'pattern',
      instancePath: '/properties/policyCode',
      params: { pattern: '^[A-Z]{3}-\\d{4}$' },
    },
    'Policy code',
  )
  assert.match(pattern, /Policy code/)
  assert.ok(!pattern.includes('^[A-Z]{3}-\\d{4}$'))
  assert.ok(!pattern.includes('/properties'))
  assert.ok(!pattern.includes('properties.policyCode'))

  const enumMessage = messageFor(
    {
      keyword: 'enum',
      instancePath: '/properties/status',
      params: { allowedValues: ['secret-a', 'secret-b'] },
    },
    'Status',
  )
  assert.match(enumMessage, /Status/)
  assert.ok(!enumMessage.includes('secret-a'))
  assert.ok(!enumMessage.includes('secret-b'))
  assert.ok(!enumMessage.includes('/properties'))
})

test('messageFor allows limits but hides internal details', () => {
  const minLength = messageFor(
    { keyword: 'minLength', instancePath: '/a/b', params: { limit: 3 } },
    'Name',
  )
  assert.match(minLength, /3/)
  assert.match(minLength, /Name/)
  assert.ok(!minLength.includes('/a/b'))

  const internal = messageFor('internal', 'Form')
  assert.equal(typeof internal, 'string')
  assert.ok(internal.length > 0)
  assert.ok(!internal.includes('/a/b'))
})

test('messageFor always returns a user-facing string for unknown errors', () => {
  const message = messageFor({ keyword: 'notARealKeyword' }, undefined)
  assert.equal(typeof message, 'string')
  assert.ok(message.length > 0)
  assert.ok(!message.includes('notARealKeyword'))
})
