import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDocument } from '../engine/document.js'
import { createEngine } from '../engine/engine.js'
import { blockingIssues } from '../engine/issues.js'
import { normalizePermissions } from '../engine/modes.js'
import { seedBoundPaths } from '../engine/seed.js'
import { DOCUMENT, ENTITY } from './documents.js'
import { PERMISSION_SETS, createSaveEntity } from './demo.js'
import { SOURCES } from './sources.js'

const parseFixture = () =>
  parseDocument(DOCUMENT, { sources: SOURCES })

const editorPermissions = () => {
  const editor = PERMISSION_SETS.find((set) => set.id === 'editor')
  assert.ok(editor, 'the editor permission set ships with the demo')
  return normalizePermissions(editor.permissions).permissions
}

const assertNoUndefined = (value, path = '$') => {
  if (value === undefined) {
    assert.fail(`undefined seeded at ${path}`)
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assertNoUndefined(child, `${path}.${key}`)
  }
}

test('the shipped fixture parses with zero blocking issues', () => {
  const parsed = parseFixture()

  assert.equal(parsed.ok, true)
  assert.deepEqual(blockingIssues(parsed.issues), [])

  const { document } = parsed
  const ids = document.fields.map((field) => field.id)

  for (const id of [
    'country',
    'effectiveDate',
    'startDate',
    'endDate',
    'notes',
    'currency',
    'policyCode',
    'participants',
    'attachment',
  ]) {
    assert.ok(ids.includes(id), `missing top-level field ${id}`)
  }

  const repeats = document.fields.filter((field) => field.isRepeat)
  assert.equal(repeats.length, 1)
  assert.equal(repeats[0].id, 'participants')
  assert.equal(repeats[0].template.length, 4)

  const complex = document.fields.filter((field) => field.isComplex)
  assert.equal(complex.length, 1)
  assert.equal(complex[0].id, 'attachment')

  assert.equal(document.validations.length, 1)
  const rule = document.validations[0]
  assert.equal(rule.id, 'endDateRequiredWithStart')
  assert.deepEqual(rule.target, ['properties', 'policy', 'endDate'])
  assert.equal(rule.message, 'End date is required when a start date is set')
})

test('every permission set normalises cleanly and covers every field exactly once', () => {
  const { document } = parseFixture()

  for (const set of PERMISSION_SETS) {
    const { permissions, issues } = normalizePermissions(set.permissions)
    assert.deepEqual(issues, [], `issues in ${set.id}`)
    assert.equal(
      permissions.size,
      document.fieldsById.size,
      `${set.id} must grant exactly one mode per field`,
    )

    for (const field of document.fieldsById.values()) {
      const key = document.permissionKeyByField.get(field.id) ?? field.id
      const grant = permissions.get(key)
      assert.ok(
        grant === 'EDIT' || grant === 'VIEW',
        `${set.id} has no EDIT/VIEW grant for ${field.id}`,
      )
    }
  }
})

test('seedBoundPaths creates every bound leaf, preserves unbound data and keeps row values', () => {
  const { document } = parseFixture()

  const seeded = seedBoundPaths(document, structuredClone(ENTITY))
  assert.equal(seeded.properties.policy.startDate, '2026-01-01')
  assert.equal(seeded.properties.policy.endDate, '2026-02-01')
  assert.equal(seeded.properties.participants[0].source, 'broker-import')
  assert.equal(seeded.properties.participants[0].name, 'Ada Lovelace')
  assertNoUndefined(seeded)

  const empty = seedBoundPaths(document, {})
  assert.equal(empty.properties.policy.startDate, '')
  assert.equal(empty.properties.policy.endDate, '')
  assert.equal(empty.properties.policy.country, '')
  assert.deepEqual(empty.properties.participants, [])
  assert.equal(empty.properties.policy.notes, '')
  assertNoUndefined(empty)
})

test('the resolver surfaces and clears the endDate cross-field error', () => {
  const { document } = parseFixture()
  const permissions = editorPermissions()
  const engine = createEngine({
    document,
    getContext: () => ({ permissions, formMode: 'EDIT' }),
  })

  const values = seedBoundPaths(document, structuredClone(ENTITY))
  assert.deepEqual(engine.resolve(values).errors, {})

  values.properties.policy.endDate = ''
  const invalid = engine.resolve(values)
  assert.equal(
    invalid.errors.properties.policy.endDate.message,
    'End date is required when a start date is set',
  )

  values.properties.policy.endDate = '2026-02-01'
  assert.deepEqual(engine.resolve(values).errors, {})
})

test('createSaveEntity clones successful payloads, rejects ZZ and fails exactly one save', async () => {
  const saveEntity = createSaveEntity()
  const payload = {
    properties: { policy: { country: 'US', startDate: '2026-01-01' } },
  }

  const saved = await saveEntity(payload)
  assert.equal(saved.ok, true)
  payload.properties.policy.country = 'ZZ'
  assert.equal(saved.value.properties.policy.country, 'US')

  const rejected = await saveEntity({
    properties: { policy: { country: 'ZZ' } },
  })
  assert.equal(rejected.ok, false)
  assert.ok(
    rejected.errors.some(
      (error) => error.path === 'properties.policy.country',
    ),
  )

  const flaky = createSaveEntity()
  flaky.setFailNext(true)
  const failed = await flaky({ properties: { policy: { country: 'US' } } })
  assert.equal(failed.ok, false)
  const recovered = await flaky({ properties: { policy: { country: 'US' } } })
  assert.equal(recovered.ok, true)
})
