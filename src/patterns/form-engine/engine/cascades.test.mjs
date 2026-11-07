import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDocument } from './document.js'
import { createEngine } from './engine.js'
import {
  buildCascadeIndex,
  buildParams,
  collectBindingsAtSegments,
  createCascadeState,
  matchCascadeRules,
  resolveTarget,
  runCascades,
} from './cascades.js'

const countryPath = ['properties', 'country']
const currencyPath = ['properties', 'currency']
const codePath = ['properties', 'code']
const participantPath = ['properties', 'participants']

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const abortError = () => {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const text = (id, path, extra = {}) => ({
  id,
  type: 'Text',
  binding: { value: path },
  label: id,
  ...extra,
})

function build(raw) {
  const result = parseDocument(raw)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.equal(
    result.issues.filter((issue) => issue.severity === 'blocking').length,
    0,
    JSON.stringify(result.issues),
  )
  return result.document
}

const setAt = (values, segments, value) => {
  let current = values
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]
    if (current[key] === null || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key]
  }
  current[segments[segments.length - 1]] = value
}

const getAt = (values, segments) => {
  let current = values
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function makeApi({
  document,
  values,
  sources = {},
  state = createCascadeState(),
  editable = () => true,
  debounceMs = 0,
} = {}) {
  const issues = []
  const writes = []
  const api = {
    state,
    sources,
    document,
    debounceMs,
    getValues: () => values,
    setValue(segments, value, opts) {
      writes.push({ segments: [...segments], value, opts })
      setAt(values, segments, value)
    },
    isEditable: editable,
    getSlotType(segments) {
      return collectBindingsAtSegments(document, segments)[0]?.type ?? null
    },
    record(issue) {
      issues.push(issue)
    },
  }
  return { api, issues, writes, values, state }
}

function controllableSource() {
  const calls = []
  const source = (params, { signal } = {}) =>
    new Promise((resolve, reject) => {
      const call = { params, signal, resolve, reject }
      calls.push(call)
      if (signal?.aborted) {
        reject(abortError())
        return
      }
      signal?.addEventListener?.('abort', () => reject(abortError()))
    })
  return { source, calls }
}

async function until(predicate, message = 'condition not met') {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error(message)
    await tick()
  }
}

test('a sync set writes only when the target is EDIT', async () => {
  const document = build({
    id: 'sync-set',
    version: 1,
    fields: [text('country', 'properties.country'), text('currency', 'properties.currency')],
    rules: {
      cascades: [
        {
          id: 'setCurrency',
          when: { op: 'eq', path: 'properties.country', value: 'US' },
          then: [
            { kind: 'set', target: 'properties.currency', value: 'USD' },
          ],
        },
      ],
    },
  })

  const readOnly = makeApi({
    document,
    values: { properties: { country: 'US' } },
    editable: () => false,
  })
  await runCascades(countryPath, readOnly.api)
  assert.equal(readOnly.writes.length, 0)
  assert.equal(readOnly.issues.length, 1)
  assert.equal(readOnly.issues[0].severity, 'warning')

  const editable = makeApi({
    document,
    values: { properties: { country: 'US' } },
  })
  await runCascades(countryPath, editable.api)
  assert.equal(editable.writes.length, 1)
  assert.deepEqual(editable.writes[0], {
    segments: currencyPath,
    value: 'USD',
    opts: { schedule: false },
  })
  assert.deepEqual(editable.values.properties.currency, 'USD')
})

test('a rule is indexed under every dependency and fires from either source', async () => {
  const document = build({
    id: 'multi-source',
    version: 1,
    fields: [
      text('country', 'properties.country'),
      text('region', 'properties.region'),
      text('currency', 'properties.currency'),
    ],
    rules: {
      cascades: [
        {
          id: 'setCurrency',
          when: {
            op: 'and',
            args: [
              { op: 'eq', path: 'properties.country', value: 'US' },
              { op: 'eq', path: 'properties.region', value: 'NA' },
            ],
          },
          then: [
            { kind: 'set', target: 'properties.currency', value: 'USD' },
          ],
        },
      ],
    },
  })

  const index = buildCascadeIndex(document)
  assert.equal(index.size, 2)
  assert.equal(matchCascadeRules(index, countryPath).length, 1)
  assert.equal(matchCascadeRules(index, ['properties', 'region']).length, 1)

  const { api, writes } = makeApi({
    document,
    values: { properties: { country: 'US', region: 'NA' } },
    state: createCascadeState(),
  })
  await runCascades(['properties', 'region'], api)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].value, 'USD')
})

test('a set effect never chains into another cascade pass', async () => {
  const document = build({
    id: 'no-chain',
    version: 1,
    fields: [
      text('country', 'properties.country'),
      text('currency', 'properties.currency'),
      text('symbol', 'properties.symbol'),
    ],
    rules: {
      cascades: [
        {
          id: 'setCurrency',
          when: { op: 'eq', path: 'properties.country', value: 'US' },
          then: [
            { kind: 'set', target: 'properties.currency', value: 'USD' },
          ],
        },
        {
          id: 'setSymbol',
          when: { op: 'eq', path: 'properties.currency', value: 'USD' },
          then: [{ kind: 'set', target: 'properties.symbol', value: '$' }],
        },
      ],
    },
  })

  const { api, writes, values } = makeApi({
    document,
    values: { properties: { country: 'US' } },
  })
  await runCascades(countryPath, api)

  assert.equal(writes.length, 1)
  assert.equal(values.properties.currency, 'USD')
  assert.equal(values.properties.symbol, undefined)
})

test('a stale fetch run is discarded when a newer run owns the target', async () => {
  const document = build({
    id: 'stale',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const { source, calls } = controllableSource()
  const { api, writes, values } = makeApi({
    document,
    sources: { lookup: source },
    values: { properties: { country: 'US' } },
    debounceMs: 5,
  })

  const first = runCascades(countryPath, api)
  await until(() => calls.length === 1, 'first fetch did not start')

  values.properties.country = 'CA'
  const second = runCascades(countryPath, api)
  await until(() => calls.length === 2, 'second fetch did not start')

  calls[0].resolve('OLD')
  await first
  calls[1].resolve('CA-CODE')
  await second

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].segments, codePath)
  assert.equal(writes[0].value, 'CA-CODE')
  assert.deepEqual(writes[0].opts, { schedule: true })
})

test('an epoch bump discards a fetch landing', async () => {
  const document = build({
    id: 'epoch',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const { source, calls } = controllableSource()
  const { api, issues, writes, state } = makeApi({
    document,
    sources: { lookup: source },
    values: { properties: { country: 'US' } },
    debounceMs: 5,
  })

  const run = runCascades(countryPath, api)
  await until(() => calls.length === 1, 'fetch did not start')
  state.bumpEpoch()
  calls[0].resolve('TOO-LATE')
  await run

  assert.equal(writes.length, 0)
  assert.equal(issues.length, 0)
})

test('a fetch re-resolves the target by itemKey when rows move', async () => {
  const document = build({
    id: 'item-key',
    version: 1,
    fields: [
      text('country', 'properties.country'),
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        itemKey: 'id',
        template: [
          text('participantId', 'id'),
          text('participantCode', 'currency'),
        ],
      },
    ],
    rules: {
      cascades: [
        {
          id: 'fetchParticipantCode',
          group: 'participants',
          when: { op: 'eq', path: 'currency', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'currency',
              params: { id: 'id' },
            },
          ],
        },
      ],
    },
  })

  const { source, calls } = controllableSource()
  const { api, writes, values } = makeApi({
    document,
    sources: { lookup: source },
    values: {
      properties: {
        country: 'US',
        participants: [
          { id: 'a', currency: '' },
          { id: 'b', currency: '' },
        ],
      },
    },
    debounceMs: 5,
  })

  const run = runCascades([...participantPath, '0', 'currency'], api)
  await until(() => calls.length === 1, 'fetch did not start')
  assert.deepEqual(calls[0].params, { id: 'a' })

  values.properties.participants = [
    { id: 'b', currency: '' },
    { id: 'a', currency: '' },
  ]
  calls[0].resolve('A-CODE')
  await run

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].segments, [
    'properties',
    'participants',
    '1',
    'currency',
  ])
  assert.equal(writes[0].value, 'A-CODE')
  assert.equal(values.properties.participants[1].currency, 'A-CODE')
})

test('an unknown effect kind records blocking and never calls a source', async () => {
  let calls = 0
  const rule = {
    id: 'unknownEffect',
    when: { op: 'eq', path: countryPath, value: 'US' },
    dependsOn: [countryPath],
    then: [
      {
        kind: 'evil',
        source: 'lookup',
        target: codePath,
      },
    ],
  }
  const document = {
    fields: [],
    fieldsById: new Map(),
    bindings: new Map(),
    templateBindings: new Map(),
    rules: { visibility: [], cascades: [rule] },
  }

  const { api, issues, writes } = makeApi({
    document,
    sources: {
      lookup: () => {
        calls += 1
        return 'x'
      },
    },
    values: { properties: { country: 'US' } },
  })

  await runCascades(countryPath, api)

  assert.equal(calls, 0)
  assert.equal(writes.length, 0)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'effect.unknown')
  assert.equal(issues[0].severity, 'blocking')
})

test('a missing source records blocking and writes nothing', async () => {
  const document = build({
    id: 'missing-source',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'missing',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const { api, issues, writes } = makeApi({
    document,
    sources: {},
    values: { properties: { country: 'US' } },
  })

  await runCascades(countryPath, api)

  assert.equal(writes.length, 0)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'cascade.source.missing')
  assert.equal(issues[0].severity, 'blocking')
})

test('AbortError from a source is ignored and not recorded', async () => {
  const document = build({
    id: 'abort-error',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: {},
            },
          ],
        },
      ],
    },
  })

  const { api, issues, writes } = makeApi({
    document,
    sources: {
      lookup: async () => {
        throw abortError()
      },
    },
    values: { properties: { country: 'US' } },
  })

  await runCascades(countryPath, api)

  assert.equal(writes.length, 0)
  assert.equal(issues.length, 0)
})

test('only declared params are sent to a source', async () => {
  const document = build({
    id: 'declared-params',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const seen = []
  const { api, writes } = makeApi({
    document,
    sources: {
      lookup: (params) => {
        seen.push(params)
        return 'CODE'
      },
    },
    values: {
      properties: { country: 'US', secret: 'do-not-send' },
    },
  })

  await runCascades(countryPath, api)

  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { country: 'US' })
  assert.equal(Object.hasOwn(seen[0], 'secret'), false)
  assert.equal(writes.length, 1)
})

test('fetch effects debounce per target so two quick runs make one call', async () => {
  const document = build({
    id: 'debounce',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const seen = []
  const { api, writes, values } = makeApi({
    document,
    sources: {
      lookup: (params) => {
        seen.push(params)
        return `${params.country}-CODE`
      },
    },
    values: { properties: { country: 'US' } },
    debounceMs: 10,
  })

  const first = runCascades(countryPath, api)
  values.properties.country = 'CA'
  const second = runCascades(countryPath, api)
  await Promise.all([first, second])

  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { country: 'CA' })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].value, 'CA-CODE')
})

test('settleCascades times out while a source never lands', async () => {
  const document = build({
    id: 'settle-timeout',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  let rejectPending
  const sources = {
    lookup: (_params, { signal }) =>
      new Promise((_resolve, reject) => {
        rejectPending = reject
        signal.addEventListener('abort', () => reject(abortError()))
      }),
  }
  const engine = createEngine({ document, sources })
  const { api } = makeApi({
    document,
    sources: engine.ctx().sources,
    values: { properties: { country: 'US' } },
    state: engine.cascades,
    debounceMs: 0,
  })

  const run = runCascades(countryPath, api)
  const settled = await engine.settleCascades(10)
  assert.equal(settled, false)

  engine.cascades.abortAll()
  rejectPending(abortError())
  await run
  assert.equal(engine.cascades.pending.size, 0)
})

test('collectBindingsAtSegments finds exact and template slot types', () => {
  const document = build({
    id: 'bindings',
    version: 1,
    fields: [
      text('country', 'properties.country'),
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        itemKey: 'id',
        template: [
          text('participantId', 'id'),
          text('participantCode', 'currency'),
        ],
      },
    ],
    rules: { cascades: [] },
  })

  assert.deepEqual(collectBindingsAtSegments(document, countryPath), [
    { fieldId: 'country', slotName: 'value', type: 'string' },
  ])

  const concrete = collectBindingsAtSegments(document, [
    ...participantPath,
    '3',
    'currency',
  ])
  assert.deepEqual(concrete, [
    { fieldId: 'participantCode', slotName: 'value', type: 'string' },
  ])

  const template = collectBindingsAtSegments(document, [
    ...participantPath,
    '*',
    'currency',
  ])
  assert.deepEqual(template, concrete)
  assert.deepEqual(
    collectBindingsAtSegments(document, ['properties', 'unknown']),
    [],
  )
})

test('buildParams and resolveTarget substitute the row index', () => {
  const values = {
    properties: {
      country: 'US',
      items: [{ code: 'A' }, { code: 'B' }],
    },
  }

  assert.deepEqual(
    buildParams(
      {
        country: 'properties.country',
        code: ['properties', 'items', '*', 'code'],
      },
      values,
      1,
    ),
    { country: 'US', code: 'B' },
  )

  assert.deepEqual(resolveTarget(['properties', 'items', '*', 'code'], 2), [
    'properties',
    'items',
    '2',
    'code',
  ])
  assert.equal(resolveTarget(['properties', 'items', '*', 'code'], null), null)
})

test('a fetch landing is discarded when the condition is false at landing', async () => {
  const document = build({
    id: 'when-at-landing',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const { source, calls } = controllableSource()
  const { api, issues, writes, values } = makeApi({
    document,
    sources: { lookup: source },
    values: { properties: { country: 'US' } },
    debounceMs: 5,
  })

  const run = runCascades(countryPath, api)
  await until(() => calls.length === 1, 'fetch did not start')

  // The form moves on while the source is in flight, so `when` is no longer true.
  values.properties.country = ''
  calls[0].resolve('TOO-LATE')
  await run

  assert.equal(writes.length, 0)
  assert.equal(issues.length, 0)
  assert.equal(values.properties.code, undefined)
})

test('a fetch landing is discarded when the result does not match the slot type', async () => {
  const document = build({
    id: 'type-mismatch',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const { api, issues, writes, values } = makeApi({
    document,
    sources: { lookup: async () => 42 },
    values: { properties: { country: 'US' } },
    debounceMs: 0,
  })

  await runCascades(countryPath, api)

  assert.equal(writes.length, 0)
  assert.equal(issues.length, 0)
  assert.equal(values.properties.code, undefined)
})

test('a non-AbortError source exception records one warning and writes nothing', async () => {
  const document = build({
    id: 'source-exception',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const { api, issues, writes } = makeApi({
    document,
    sources: {
      lookup: async () => {
        throw new Error('lookup exploded')
      },
    },
    values: { properties: { country: 'US' } },
    debounceMs: 0,
  })

  await runCascades(countryPath, api)

  assert.equal(writes.length, 0)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'cascade.exception')
  assert.equal(issues[0].severity, 'warning')
})

test('one failing rule does not stop sibling rules in the same pass', async () => {
  const regionPath = ['properties', 'region']
  const document = build({
    id: 'sibling-rules',
    version: 1,
    fields: [
      text('country', 'properties.country'),
      text('code', 'properties.code'),
      text('region', 'properties.region'),
    ],
    rules: {
      cascades: [
        {
          id: 'throwingSet',
          when: { op: 'eq', path: 'properties.country', value: 'US' },
          then: [{ kind: 'set', target: 'properties.code', value: 'BROKEN' }],
        },
        {
          id: 'siblingSet',
          when: { op: 'eq', path: 'properties.country', value: 'US' },
          then: [{ kind: 'set', target: 'properties.region', value: 'NA' }],
        },
      ],
    },
  })

  const { api, issues, writes, values } = makeApi({
    document,
    values: { properties: { country: 'US' } },
  })

  const originalSetValue = api.setValue
  api.setValue = (segments, value, opts) => {
    if (segments[segments.length - 1] === 'code') {
      throw new Error('set path exploded')
    }
    originalSetValue(segments, value, opts)
  }

  await runCascades(countryPath, api)

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].segments, regionPath)
  assert.equal(writes[0].value, 'NA')
  assert.equal(values.properties.region, 'NA')
  assert.equal(values.properties.code, undefined)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'cascade.exception')
  assert.equal(issues[0].severity, 'warning')
})

test('a successful fetch writes with validation scheduling', async () => {
  const document = build({
    id: 'landing',
    version: 1,
    fields: [text('country', 'properties.country'), text('code', 'properties.code')],
    rules: {
      cascades: [
        {
          id: 'fetchCode',
          when: { op: 'neq', path: 'properties.country', value: '' },
          then: [
            {
              kind: 'fetch',
              source: 'lookup',
              target: 'properties.code',
              params: { country: 'properties.country' },
            },
          ],
        },
      ],
    },
  })

  const { api, issues, writes, values } = makeApi({
    document,
    sources: { lookup: async () => 'POLICY-1' },
    values: { properties: { country: 'US' } },
    debounceMs: 0,
  })

  await runCascades(countryPath, api)

  assert.equal(issues.length, 0)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].value, 'POLICY-1')
  assert.deepEqual(writes[0].opts, { schedule: true })
  assert.equal(getAt(values, codePath), 'POLICY-1')
})
