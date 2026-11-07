import test from 'node:test'
import assert from 'node:assert/strict'
import { applyServerErrors, createSubmit } from './submit.js'
import { createComplexRegistry } from './complex.js'

const DOC = { id: 'policy-form', version: 7 }

const baseValues = () => ({
  id: 'policy-1',
  properties: {
    policy: {
      country: 'US',
      effectiveDate: '2026-01-01',
      currency: 'USD',
    },
    // Unbound property: submit must preserve it.
    source: 'broker-import',
  },
  participants: [{ id: 'p1', name: 'Ada Lovelace', taxId: 'T-100' }],
})

function makeForm({ trigger = true } = {}) {
  const calls = { trigger: [], reset: [], setError: [], clearErrors: 0 }
  const form = {
    getValues: () => baseValues(),
    trigger: async (...args) => {
      calls.trigger.push(args)
      return trigger
    },
    reset: (next) => {
      calls.reset.push(next)
    },
    setError: (path, error) => {
      calls.setError.push({ path, error })
    },
    clearErrors: () => {
      calls.clearErrors += 1
    },
  }
  return { form, calls }
}

function makeEngine({ formMode = 'EDIT', settle = true } = {}) {
  const engine = {
    ctx: () => ({ formMode }),
    settleCalls: [],
    cascades: {
      bumps: 0,
      bumpEpoch() {
        engine.cascades.bumps += 1
        return engine.cascades.bumps
      },
    },
    async settleCascades(ms) {
      engine.settleCalls.push(ms)
      return settle
    },
  }
  return engine
}

const makeComplex = () => createComplexRegistry()

const saveOk = (value = { id: 'saved-1' }) => async () => ({
  ok: true,
  value: structuredClone(value),
})

const deferred = () => {
  let resolve
  const promise = new Promise((res) => {
    resolve = res
  })
  return { promise, resolve }
}

test('a second submit while one is in flight returns the busy stage', async () => {
  const { form } = makeForm()
  const engine = makeEngine()
  const complex = makeComplex()
  const save = deferred()
  const submit = createSubmit({
    form,
    engine,
    complex,
    saveEntity: () => save.promise,
    doc: DOC,
  })

  const first = submit()
  // Let the first call reach the save await before the second click.
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(await submit(), { ok: false, stage: 'busy' })

  save.resolve({ ok: true, value: { id: 'saved' } })
  assert.equal((await first).ok, true)
})

test('EDIT validation failure stops before complex validation and save', async () => {
  const { form, calls } = makeForm({ trigger: false })
  const engine = makeEngine()
  const complex = makeComplex()
  let validated = 0
  complex.register('attachment', {
    validate: async () => {
      validated += 1
      return []
    },
    submit: async () => ({ ok: true }),
    isDirty: () => false,
  })
  let saved = 0
  const submit = createSubmit({
    form,
    engine,
    complex,
    saveEntity: async () => {
      saved += 1
      return { ok: true, value: {} }
    },
    doc: DOC,
  })

  assert.deepEqual(await submit(), { ok: false, stage: 'validation' })
  assert.deepEqual(calls.trigger, [[undefined, { shouldFocus: true }]])
  assert.equal(validated, 0)
  assert.equal(saved, 0)
  assert.equal(engine.settleCalls.length, 0)
  assert.equal(engine.cascades.bumps, 1)
})

test('complex validation failure returns every complex error before save', async () => {
  const { form } = makeForm()
  const engine = makeEngine()
  const complex = makeComplex()
  complex.register('attachment', {
    validate: async () => [
      { fieldId: 'attachment', message: 'Attachment note is bad.' },
    ],
    submit: async () => ({ ok: true }),
    isDirty: () => false,
  })
  let saved = 0
  const submit = createSubmit({
    form,
    engine,
    complex,
    saveEntity: async () => {
      saved += 1
      return { ok: true, value: {} }
    },
    doc: DOC,
  })

  assert.deepEqual(await submit(), {
    ok: false,
    stage: 'complex-validation',
    errors: [{ fieldId: 'attachment', message: 'Attachment note is bad.' }],
  })
  assert.equal(saved, 0)
  assert.equal(engine.settleCalls.length, 0)
})

test('a cascade timeout stops the pipeline without saving', async () => {
  const { form } = makeForm()
  const engine = makeEngine({ settle: false })
  let saved = 0
  const submit = createSubmit({
    form,
    engine,
    complex: makeComplex(),
    saveEntity: async () => {
      saved += 1
      return { ok: true, value: {} }
    },
    doc: DOC,
  })

  assert.deepEqual(await submit(), { ok: false, stage: 'cascade-timeout' })
  assert.deepEqual(engine.settleCalls, [3000])
  assert.equal(saved, 0)
})

test('server 422 errors map to bound paths and never drop an error', async () => {
  const { form, calls } = makeForm()
  const engine = makeEngine()
  const entity = {
    ok: false,
    errors: [
      {
        path: 'properties.policy.country',
        message: 'Country ZZ is not allowed by the server',
      },
      { path: '', message: 'Root message' },
      { path: 42, message: 'Bad path' },
      { message: 'Missing path' },
      { path: '   ', message: 'Whitespace path' },
    ],
  }
  const submit = createSubmit({
    form,
    engine,
    complex: makeComplex(),
    saveEntity: async () => entity,
    doc: DOC,
  })

  const result = await submit()

  assert.equal(result.ok, false)
  assert.equal(result.stage, 'entity')
  assert.equal(result.entity, entity)
  assert.deepEqual(
    calls.setError.map((call) => call.path),
    [
      'properties.policy.country',
      'root',
      'root',
      'root',
      'root',
    ],
  )
  assert.ok(
    calls.setError.every(
      (call) =>
        call.error.type === 'server' &&
        typeof call.error.message === 'string' &&
        call.error.message.length > 0,
    ),
  )
})

test('applyServerErrors treats missing and invalid paths as root', () => {
  const { form, calls } = makeForm()

  applyServerErrors(form, [
    { path: 'properties.policy.country', message: 'Bound' },
    { path: null, message: 'Null path' },
    { path: { nope: true }, message: 'Object path' },
    { message: 'No path' },
  ])

  assert.deepEqual(
    calls.setError.map((call) => call.path),
    ['properties.policy.country', 'root', 'root', 'root'],
  )
})

test('an exception returns the exception stage and clears the in-flight guard', async () => {
  const { form } = makeForm()
  const engine = makeEngine()
  let attempt = 0
  const submit = createSubmit({
    form,
    engine,
    complex: makeComplex(),
    saveEntity: async () => {
      attempt += 1
      if (attempt === 1) throw new Error('network down')
      return { ok: true, value: { id: 'saved-after-retry' } }
    },
    doc: DOC,
  })

  const failed = await submit()
  assert.equal(failed.ok, false)
  assert.equal(failed.stage, 'exception')
  assert.equal(failed.error.message, 'network down')

  const retried = await submit()
  assert.equal(retried.ok, true)
})

test('VIEW submit skips trigger, complex validation and complex submit', async () => {
  const { form, calls } = makeForm()
  const engine = makeEngine({ formMode: 'VIEW' })
  const complex = makeComplex()
  let validated = 0
  let submitted = 0
  complex.register('attachment', {
    validate: async () => {
      validated += 1
      return []
    },
    submit: async () => {
      submitted += 1
      return { ok: true }
    },
    isDirty: () => true,
  })

  let savedPayload
  const savedValue = { id: 'saved-view' }
  const submit = createSubmit({
    form,
    engine,
    complex,
    saveEntity: async (payload) => {
      savedPayload = payload
      return { ok: true, value: savedValue }
    },
    doc: DOC,
  })

  const result = await submit()

  assert.equal(result.ok, true)
  assert.equal(calls.trigger.length, 0)
  assert.equal(engine.settleCalls.length, 0)
  assert.equal(validated, 0)
  assert.equal(submitted, 0)
  assert.deepEqual(result.complex, [])
  assert.deepEqual(savedPayload, {
    ...baseValues(),
    documentVersion: DOC.version,
  })
  assert.deepEqual(calls.reset, [savedValue])
  assert.equal(engine.cascades.bumps, 1)
})

test('success sends a cloned payload with documentVersion and resets the baseline', async () => {
  const { form, calls } = makeForm()
  const engine = makeEngine()
  const complex = makeComplex()
  const savedValue = { ...baseValues(), id: 'saved-2', revision: 2 }

  let captured
  const submit = createSubmit({
    form,
    engine,
    complex,
    saveEntity: async (payload, options) => {
      captured = { payload, options }
      return { ok: true, value: savedValue }
    },
    doc: DOC,
  })

  const result = await submit()

  assert.equal(result.ok, true)
  assert.deepEqual(captured.payload, {
    ...baseValues(),
    documentVersion: DOC.version,
  })
  // The save payload and the reset baseline are structured clones, not the live
  // RHF values object or the saved entity object.
  assert.notEqual(captured.payload, baseValues())
  assert.deepEqual(calls.reset, [savedValue])
  assert.notEqual(calls.reset[0], savedValue)
  assert.equal(typeof captured.options.idempotencyKey, 'string')
})

test('idempotency key is reused after a failed save and replaced after success', async () => {
  const { form } = makeForm()
  const engine = makeEngine()
  const keys = []
  let attempt = 0

  const submit = createSubmit({
    form,
    engine,
    complex: makeComplex(),
    saveEntity: async (payload, options) => {
      keys.push(options.idempotencyKey)
      attempt += 1
      if (attempt === 1) {
        return { ok: false, errors: [{ path: 'root', message: 'Rejected' }] }
      }
      return { ok: true, value: { ...payload, saved: true } }
    },
    doc: DOC,
  })

  assert.equal((await submit()).stage, 'entity')
  assert.equal((await submit()).ok, true)
  assert.equal((await submit()).ok, true)

  assert.equal(keys[0], keys[1])
  assert.notEqual(keys[2], keys[1])
})

test('partial complex failure saves the entity but reports ok false with results', async () => {
  const { form, calls } = makeForm()
  const engine = makeEngine()
  const complex = makeComplex()
  const received = []
  complex.register('first', {
    validate: async () => [],
    submit: async (entity) => {
      received.push(entity)
      return { ok: true }
    },
    isDirty: () => false,
  })
  complex.register('second', {
    validate: async () => [],
    submit: async () => ({ ok: false }),
    isDirty: () => false,
  })
  complex.register('third', {
    validate: async () => [],
    submit: async () => {
      throw new Error('upload failed')
    },
    isDirty: () => false,
  })

  const savedValue = { id: 'saved-partial' }
  const submit = createSubmit({
    form,
    engine,
    complex,
    saveEntity: async () => ({ ok: true, value: savedValue }),
    doc: DOC,
  })

  const result = await submit()

  assert.equal(result.ok, false)
  assert.equal(result.complex.length, 3)
  assert.deepEqual(
    result.complex.map((entry) => entry.status),
    ['fulfilled', 'fulfilled', 'rejected'],
  )
  assert.equal(result.complex[0].value.ok, true)
  assert.equal(result.complex[1].value.ok, false)
  assert.equal(received[0], savedValue)
  // The saved entity still moves the baseline; no rollback.
  assert.deepEqual(calls.reset, [savedValue])
})

test('the cascade epoch is bumped at submit start even in VIEW', async () => {
  for (const formMode of ['EDIT', 'VIEW']) {
    const { form } = makeForm()
    const engine = makeEngine({ formMode })
    const submit = createSubmit({
      form,
      engine,
      complex: makeComplex(),
      saveEntity: saveOk(),
      doc: DOC,
    })

    await submit()
    assert.equal(engine.cascades.bumps, 1, formMode)
  }
})
