import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from './document.js'
import { createEngine } from './engine.js'

function build() {
  const result = parseDocument({
    id: 'engine-doc',
    version: '2',
    fields: [
      {
        id: 'name',
        type: 'Text',
        binding: { value: 'properties.name' },
        label: 'Name',
        required: true,
      },
      {
        id: 'note',
        type: 'Text',
        binding: { value: 'properties.note' },
        label: 'Note',
      },
    ],
  })
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  return result.document
}

function permissionsFor(document) {
  return new Map([...document.permissionKeyByField.values()].map((key) => [key, 'EDIT']))
}

test('createEngine exposes the composition surface and merges context', () => {
  const document = build()
  const record = () => {}
  const sources = { mock: () => 'value' }
  const permissions = permissionsFor(document)

  const engine = createEngine({
    document,
    sources,
    record,
    getContext: () => ({
      permissions,
      formMode: 'EDIT',
      custom: 'kept',
      document: 'ignored',
      sources: 'ignored',
      cascades: 'ignored',
    }),
  })

  assert.equal(engine.document, document)
  assert.equal(engine.record, record)
  assert.equal(typeof engine.ctx, 'function')
  assert.equal(typeof engine.validatorFor, 'function')
  assert.equal(typeof engine.resolve, 'function')
  assert.equal(typeof engine.settleCascades, 'function')
  assert.equal(typeof engine.setContextProvider, 'function')

  const ctx = engine.ctx()
  assert.equal(ctx.custom, 'kept')
  assert.equal(ctx.formMode, 'EDIT')
  assert.equal(ctx.permissions, permissions)
  assert.equal(ctx.document, document)
  assert.equal(ctx.sources, sources)
  assert.equal(ctx.cascades, engine.cascades)
})

test('setContextProvider replaces the live provider', () => {
  const document = build()
  const engine = createEngine({
    document,
    getContext: () => ({ formMode: 'EDIT', marker: 1 }),
  })

  assert.equal(engine.ctx().marker, 1)
  engine.setContextProvider(() => ({ formMode: 'VIEW', marker: 2 }))
  assert.equal(engine.ctx().formMode, 'VIEW')
  assert.equal(engine.ctx().marker, 2)
  assert.equal(engine.ctx().document, document)
})

test('resolve is stable and reuses one validator cache entry for the same EDIT set', () => {
  const document = build()
  const engine = createEngine({
    document,
    getContext: () => ({
      permissions: permissionsFor(document),
      formMode: 'EDIT',
    }),
  })

  const original = engine.validatorFor
  let builds = 0
  engine.validatorFor = (key, buildEntry) =>
    original(key, () => {
      builds += 1
      return buildEntry()
    })

  const validValues = { properties: { name: 'Ada', note: '' } }
  const first = engine.resolve(validValues)
  const second = engine.resolve(validValues)

  assert.equal(builds, 1)
  assert.equal(first.values, validValues)
  assert.deepEqual(first.errors, {})
  assert.deepEqual(second.errors, {})

  const invalid = engine.resolve({ properties: { name: '', note: '' } })
  assert.equal(builds, 1)
  assert.equal(
    invalid.errors.properties.name.message,
    'Name must be at least 1 characters.',
  )
})

test('resolve records a schema clash warning through engine.record', () => {
  const result = parseDocument({
    id: 'engine-clash',
    version: '1',
    fields: [
      {
        id: 'firstCode',
        type: 'Text',
        binding: { value: 'properties.code' },
        label: 'Code',
      },
      {
        id: 'secondCode',
        type: 'Text',
        binding: { value: 'properties.code' },
        label: 'Code again',
      },
    ],
  })
  assert.equal(result.ok, true)

  const issues = []
  const engine = createEngine({
    document: result.document,
    record: (issue) => issues.push(issue),
    getContext: () => ({
      permissions: permissionsFor(result.document),
      formMode: 'EDIT',
    }),
  })

  engine.resolve({ properties: { code: 'value' } })

  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'validation.clash')
  assert.equal(issues[0].severity, 'warning')
})

test('cascade placeholder keeps a compatible state shape', () => {
  const document = build()
  const engine = createEngine({ document })

  assert.ok(engine.cascades.pending instanceof Map)
  assert.ok(engine.cascades.tasks instanceof Set)
  assert.equal(typeof engine.cascades.epoch, 'number')
  assert.equal(typeof engine.cascades.runId, 'number')

  const epoch = engine.cascades.epoch
  assert.equal(engine.cascades.bumpEpoch(), epoch + 1)
  assert.equal(engine.cascades.nextRunId(), 1)
  assert.equal(engine.cascades.nextRunId(), 2)

  engine.cascades.pending.set('target', { runId: 1 })
  engine.cascades.abortTarget('target')
  assert.equal(engine.cascades.pending.size, 0)
})

test('settleCascades resolves true when tasks finish and false on timeout', async () => {
  const document = build()
  const engine = createEngine({ document })

  assert.equal(await engine.settleCascades(20), true)

  let finished = false
  engine.cascades.tasks.add(
    new Promise((resolve) => {
      setTimeout(() => {
        finished = true
        resolve()
      }, 10)
    }),
  )
  assert.equal(await engine.settleCascades(100), true)
  assert.equal(finished, true)

  engine.cascades.tasks.add(new Promise(() => {}))
  assert.equal(await engine.settleCascades(5), false)
})

test('engine modules import neither React nor React Hook Form', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const files = readdirSync(here).filter(
    (file) => file.endsWith('.js') && !file.endsWith('.test.mjs'),
  )

  for (const file of files) {
    const source = readFileSync(join(here, file), 'utf8')
    assert.equal(
      /from\s+['"](react|react-dom|react-hook-form|@hookform\/[^'"]*)['"]/.test(
        source,
      ),
      false,
      file,
    )
    assert.equal(
      /require\(\s*['"](react|react-dom|react-hook-form|@hookform\/[^'"]*)['"]/.test(
        source,
      ),
      false,
      file,
    )
  }
})
