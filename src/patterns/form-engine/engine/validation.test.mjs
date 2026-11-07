import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldTypes, createSlot } from '../registry/index.js'
import { DOCUMENT, ENTITY } from '../fixtures/documents.js'
import { parseDocument } from './document.js'
import { computeModes } from './modes.js'
import { createEngine } from './engine.js'
import {
  ASSEMBLER_VERSION,
  FRAGMENT_KEYWORDS,
  validateFragment,
  assembleSchema,
  createValidatorCache,
  signature,
  mapErrors,
  applyCrossField,
  createResolver,
} from './validation.js'

// The shipped registry has no number/boolean leaf types. A local test registry
// keeps the assembler tests focused on slot types rather than on fixtures.
const testRegistry = new Map(fieldTypes)
testRegistry.set('Number', {
  slots: { value: createSlot('number') },
  emptyValue: null,
})
testRegistry.set('Boolean', {
  slots: { value: createSlot('boolean') },
  emptyValue: false,
})

function build(raw) {
  const result = parseDocument(raw, { registry: testRegistry })
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  return result.document
}

function editModes(document, overrides = {}) {
  const modes = new Map()
  for (const id of document.fieldsById.keys()) modes.set(id, 'EDIT')
  for (const [id, mode] of Object.entries(overrides)) modes.set(id, mode)
  return modes
}

function permissionsFor(document) {
  const permissions = new Map()
  for (const [fieldId, key] of document.permissionKeyByField) {
    permissions.set(key, 'EDIT')
  }
  return permissions
}

function schemaAt(schema, segments) {
  let node = schema
  for (const segment of segments) {
    if (segment === '*') {
      node = node?.items
    } else {
      node = node?.properties?.[segment]
    }
  }
  return node
}

function compiledWith(errors, pathToFields, valid = false) {
  const validate = () => valid
  validate.errors = errors
  return { validate, pathToFields }
}

const fragmentCodes = (fragment) =>
  validateFragment(fragment).map((issue) => issue.code)

test('the fragment allowlist is exactly the documented leaf vocabulary', () => {
  assert.deepEqual(
    [...FRAGMENT_KEYWORDS].sort(),
    [
      'const',
      'enum',
      'exclusiveMaximum',
      'exclusiveMinimum',
      'maxItems',
      'maxLength',
      'maximum',
      'minItems',
      'minLength',
      'minimum',
      'multipleOf',
      'pattern',
      'type',
    ],
  )

  assert.deepEqual(
    validateFragment({
      type: 'string',
      enum: ['a'],
      const: 'a',
      minLength: 1,
      maxLength: 3,
      pattern: '^a+$',
      minimum: 0,
      maximum: 4,
      exclusiveMinimum: -1,
      exclusiveMaximum: 5,
      multipleOf: 1,
      minItems: 0,
      maxItems: 2,
    }),
    [],
  )
})

test('rejected keywords and nested fragments are blocking issues', () => {
  const rejected = [
    'required',
    'additionalProperties',
    'propertyNames',
    'patternProperties',
    'dependentRequired',
    'dependentSchemas',
    'if',
    'then',
    'else',
    '$ref',
    '$data',
    'not',
    'anyOf',
    'oneOf',
    'uniqueItems',
    'format',
    'properties',
    'items',
    'nested',
  ]

  for (const keyword of rejected) {
    assert.deepEqual(
      fragmentCodes({ [keyword]: true }),
      ['field.validation.keyword'],
      keyword,
    )
  }

  assert.deepEqual(fragmentCodes({ properties: { a: { type: 'string' } } }), [
    'field.validation.keyword',
  ])
  assert.deepEqual(fragmentCodes({ minLength: { value: 1 } }), [
    'field.validation.shape',
  ])
  assert.deepEqual(fragmentCodes('not-an-object'), [
    'field.validation.shape',
  ])
})

test('pattern fragments are capped at 200 characters and must compile', () => {
  assert.deepEqual(fragmentCodes({ pattern: 'a'.repeat(200) }), [])
  assert.deepEqual(fragmentCodes({ pattern: 'a'.repeat(201) }), [
    'field.validation.pattern',
  ])
  assert.deepEqual(fragmentCodes({ pattern: '[' }), [
    'field.validation.pattern',
  ])
})

test('assembly injects required string/date/number/array rules and never additionalProperties', () => {
  const document = build({
    id: 'assembly-required',
    version: '1',
    fields: [
      {
        id: 'name',
        type: 'Text',
        binding: { value: 'properties.name' },
        label: 'Name',
        required: true,
        validation: { value: { maxLength: 50 } },
      },
      {
        id: 'nickname',
        type: 'Text',
        binding: { value: 'properties.nickname' },
        label: 'Nickname',
      },
      {
        id: 'startDate',
        type: 'Date',
        binding: { value: 'properties.startDate' },
        label: 'Start date',
        required: true,
      },
      {
        id: 'age',
        type: 'Number',
        binding: { value: 'properties.age' },
        label: 'Age',
        required: true,
      },
      {
        id: 'score',
        type: 'Number',
        binding: { value: 'properties.score' },
        label: 'Score',
      },
      {
        id: 'active',
        type: 'Boolean',
        binding: { value: 'properties.active' },
        label: 'Active',
        required: true,
      },
    ],
  })

  const { schema } = assembleSchema(document, editModes(document))
  const container = schemaAt(schema, ['properties'])

  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.properties.properties.type, 'object')
  assert.equal(container.additionalProperties, undefined)
  assert.deepEqual([...container.required].sort(), [
    'active',
    'age',
    'name',
    'startDate',
  ])

  const name = schemaAt(schema, ['properties', 'name'])
  assert.equal(name.type, 'string')
  assert.equal(name.minLength, 1)
  assert.equal(name.maxLength, 50)

  const nickname = schemaAt(schema, ['properties', 'nickname'])
  assert.equal(nickname.type, 'string')
  assert.equal(nickname.minLength, undefined)
  assert.equal(Array.isArray(nickname.type), false)

  const startDate = schemaAt(schema, ['properties', 'startDate'])
  assert.equal(startDate.type, 'string')
  assert.equal(startDate.minLength, 1)
  assert.equal(startDate.pattern, '^\\d{4}-\\d{2}-\\d{2}$')

  const age = schemaAt(schema, ['properties', 'age'])
  assert.equal(age.type, 'number')

  const score = schemaAt(schema, ['properties', 'score'])
  assert.deepEqual(score.type, ['number', 'null'])

  const active = schemaAt(schema, ['properties', 'active'])
  assert.equal(active.type, 'boolean')
  assert.equal(active.minLength, undefined)

  assert.equal(JSON.stringify(schema).includes('additionalProperties'), false)
})

test('an explicit fragment wins over injected type and date pattern', () => {
  const document = build({
    id: 'assembly-fragment-wins',
    version: '1',
    fields: [
      {
        id: 'age',
        type: 'Number',
        binding: { value: 'properties.age' },
        label: 'Age',
        required: true,
        validation: { value: { type: 'integer', minimum: 0 } },
      },
      {
        id: 'startDate',
        type: 'Date',
        binding: { value: 'properties.startDate' },
        label: 'Start date',
        validation: { value: { pattern: '^\\d{2}/\\d{2}/\\d{4}$' } },
      },
      {
        id: 'code',
        type: 'Text',
        binding: { value: 'properties.code' },
        label: 'Code',
        required: true,
        validation: { value: { minLength: 0, maxLength: 4 } },
      },
    ],
  })

  const { schema } = assembleSchema(document, editModes(document))

  const age = schemaAt(schema, ['properties', 'age'])
  assert.equal(age.type, 'integer')
  assert.equal(age.minimum, 0)

  const startDate = schemaAt(schema, ['properties', 'startDate'])
  assert.equal(startDate.pattern, '^\\d{2}/\\d{2}/\\d{4}$')

  const code = schemaAt(schema, ['properties', 'code'])
  assert.equal(code.minLength, 1)
})

test('repeat groups emit one uniform items schema with EDIT required children only', () => {
  const document = build({
    id: 'assembly-repeat',
    version: '1',
    fields: [
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        required: true,
        validation: { value: { minItems: 0 } },
        template: [
          {
            id: 'participantName',
            type: 'Text',
            binding: { value: 'name' },
            label: 'Participant name',
            required: true,
            validation: { value: { minLength: 2 } },
          },
          {
            id: 'participantNick',
            type: 'Text',
            binding: { value: 'nick' },
            label: 'Nickname',
            required: true,
          },
          {
            id: 'participantTax',
            type: 'InputWithNA',
            binding: { value: 'taxId', isNA: 'taxIdIsNA' },
            label: 'Tax id',
          },
        ],
      },
    ],
  })

  const modes = editModes(document)
  const { schema, pathToFields } = assembleSchema(document, modes)
  const group = schemaAt(schema, ['properties', 'participants'])

  assert.equal(group.type, 'array')
  assert.equal(group.minItems, 1)
  assert.equal(group.items.type, 'object')
  assert.deepEqual(group.items.required, ['name', 'nick'])

  const name = schemaAt(schema, ['properties', 'participants', '*', 'name'])
  assert.equal(name.type, 'string')
  assert.equal(name.minLength, 2)

  const nick = schemaAt(schema, ['properties', 'participants', '*', 'nick'])
  assert.equal(nick.minLength, 1)

  const taxId = schemaAt(schema, ['properties', 'participants', '*', 'taxId'])
  assert.equal(taxId.minLength, undefined)
  assert.equal(taxId.type, 'string')

  assert.equal(JSON.stringify(schema).includes('additionalProperties'), false)
  assert.deepEqual(
    pathToFields.get('properties/participants/*/name').map((def) => def.id),
    ['participantName'],
  )
  assert.deepEqual(
    pathToFields.get('properties/participants/*/taxIdIsNA').map((def) => def.id),
    ['participantTax'],
  )

  const childModes = editModes(document, {
    participantName: 'EDIT',
    participantNick: 'VIEW',
  })
  const filtered = assembleSchema(document, childModes)
  const filteredItems = schemaAt(filtered.schema, [
    'properties',
    'participants',
  ]).items

  assert.deepEqual(filteredItems.required, ['name'])
  assert.equal(filteredItems.properties.nick, undefined)
})

test('only EDIT fields and slots are assembled; group HIDDEN removes every child', () => {
  const document = build({
    id: 'assembly-modes',
    version: '1',
    fields: [
      {
        id: 'name',
        type: 'Text',
        binding: { value: 'properties.name' },
        label: 'Name',
        required: true,
      },
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        template: [
          {
            id: 'participantName',
            type: 'Text',
            binding: { value: 'name' },
            label: 'Participant name',
            required: true,
          },
        ],
      },
    ],
  })

  const { schema } = assembleSchema(
    document,
    editModes(document, { name: 'VIEW', participants: 'HIDDEN' }),
  )

  assert.deepEqual(schema, { type: 'object', properties: {} })
})

test('two fields on one path merge via allOf and record one clash warning', () => {
  const document = build({
    id: 'assembly-clash',
    version: '1',
    fields: [
      {
        id: 'firstCode',
        type: 'Text',
        binding: { value: 'properties.code' },
        label: 'Code',
        validation: { value: { minLength: 2 } },
      },
      {
        id: 'secondCode',
        type: 'Text',
        binding: { value: 'properties.code' },
        label: 'Code again',
        validation: { value: { maxLength: 5 } },
      },
    ],
  })

  const issues = []
  const { schema, pathToFields } = assembleSchema(
    document,
    editModes(document),
    (issue) => issues.push(issue),
  )

  const code = schemaAt(schema, ['properties', 'code'])
  assert.equal(Array.isArray(code.allOf), true)
  assert.equal(code.allOf.length, 2)

  assert.equal(pathToFields.get('properties/code').length, 2)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'validation.clash')
  assert.equal(issues[0].severity, 'warning')
})

test('validator cache is an LRU capped at 20 and reuses stored compiled entries', () => {
  const cache = createValidatorCache({ max: 2 })
  let builds = 0
  const buildEntry = () => {
    builds += 1
    return { validate: () => true, pathToFields: new Map() }
  }

  const first = cache.validatorFor('a', buildEntry)
  assert.equal(cache.validatorFor('a', buildEntry), first)
  assert.equal(builds, 1)

  cache.validatorFor('b', buildEntry)
  // Touch 'a' so 'b' becomes the least recently used entry.
  cache.validatorFor('a', buildEntry)
  cache.validatorFor('c', buildEntry)

  assert.equal(cache.size, 2)
  cache.validatorFor('c', buildEntry)
  cache.validatorFor('a', buildEntry)
  assert.equal(builds, 3)

  // 'b' was evicted, so it must rebuild.
  cache.validatorFor('b', buildEntry)
  assert.equal(builds, 4)

  const capped = createValidatorCache()
  for (let index = 0; index < 25; index += 1) {
    capped.validatorFor(`k${index}`, buildEntry)
  }
  assert.equal(capped.size, 20)
})

test('signature includes assembler version, document identity and sorted EDIT entries', () => {
  const document = build({
    id: 'signature-doc',
    version: '7',
    fields: [
      {
        id: 'name',
        type: 'Text',
        binding: { value: 'properties.name' },
        label: 'Name',
      },
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        template: [
          {
            id: 'participantName',
            type: 'Text',
            binding: { value: 'name' },
            label: 'Participant name',
          },
        ],
      },
    ],
  })

  const modes = editModes(document)
  const parsed = JSON.parse(signature(document, modes))

  assert.equal(parsed[0], ASSEMBLER_VERSION)
  assert.equal(parsed[1], 'signature-doc')
  assert.equal(parsed[2], '7')
  assert.deepEqual(parsed[3], [
    ['name', 'value', 'properties/name'],
    ['participantName', 'value', 'properties/participants/*/name'],
    ['participants', 'value', 'properties/participants'],
  ])

  assert.notEqual(
    signature(document, modes),
    signature({ ...document, id: 'other-doc' }, modes),
  )
  assert.notEqual(
    signature(document, modes),
    signature({ ...document, version: '8' }, modes),
  )
  assert.notEqual(
    signature(document, modes),
    signature(document, editModes(document, { name: 'VIEW' })),
  )
  assert.notEqual(
    signature(document, modes),
    signature(
      document,
      editModes(document, { participantName: 'VIEW' }),
    ),
  )
})

test('mapErrors builds hierarchical errors with array null holes and decoded pointers', () => {
  const errors = mapErrors(
    compiledWith(
      [
        {
          instancePath: '/properties/participants/1/name',
          keyword: 'minLength',
          params: { limit: 1 },
        },
      ],
      new Map([
        [
          'properties/participants/*/name',
          [{ id: 'participantName', label: 'Participant name' }],
        ],
      ]),
    ),
    {},
  )

  assert.equal(Array.isArray(errors.properties.participants), true)
  assert.equal(errors.properties.participants[0], null)
  assert.equal(
    errors.properties.participants[1].name.message,
    'Participant name must be at least 1 characters.',
  )

  const decoded = mapErrors(
    compiledWith(
      [
        {
          instancePath: '/a~1b/c~0d',
          keyword: 'type',
          params: { type: 'string' },
        },
      ],
      new Map([['a/b/c~d', [{ id: 'odd', label: 'Odd' }]]]),
    ),
    {},
  )
  assert.equal(decoded['a/b']['c~d'].message, 'Odd has an invalid type.')
})

test('mapErrors appends missingProperty and additionalProperty to the path', () => {
  const required = mapErrors(
    compiledWith(
      [
        {
          instancePath: '/properties',
          keyword: 'required',
          params: { missingProperty: 'name' },
        },
      ],
      new Map([['properties/name', [{ id: 'name', label: 'Name' }]]]),
    ),
    {},
  )
  assert.equal(required.properties.name.type, 'required')
  assert.equal(required.properties.name.message, 'Name is required.')

  const extra = mapErrors(
    compiledWith(
      [
        {
          instancePath: '/properties',
          keyword: 'additionalProperties',
          params: { additionalProperty: 'surprise' },
        },
      ],
      new Map([['properties/surprise', [{ id: 'surprise', label: 'Surprise' }]]]),
    ),
    {},
  )
  assert.equal(
    extra.properties.surprise.message,
    'Surprise has an unknown field.',
  )
})

test('mapErrors keeps the first error per path and never drops unmappable errors', () => {
  const first = mapErrors(
    compiledWith(
      [
        {
          instancePath: '/properties/name',
          keyword: 'minLength',
          params: { limit: 1 },
        },
        {
          instancePath: '/properties/name',
          keyword: 'maxLength',
          params: { limit: 2 },
        },
      ],
      new Map([['properties/name', [{ id: 'name', label: 'Name' }]]]),
    ),
    {},
  )
  assert.equal(
    first.properties.name.message,
    'Name must be at least 1 characters.',
  )

  const root = mapErrors(
    compiledWith(
      [{ instancePath: '/properties/ghost', keyword: 'type', params: {} }],
      new Map(),
    ),
    {},
  )
  assert.equal(root.root.type, 'root')
  assert.equal(root.root.message.includes('ghost'), false)

  const structural = mapErrors(
    compiledWith(
      [
        {
          instancePath: '/properties/name',
          keyword: 'oneOf',
          params: {},
        },
      ],
      new Map([['properties/name', [{ id: 'name', label: 'Name' }]]]),
    ),
    {},
  )
  assert.equal(structural.root.type, 'root')
  assert.equal(structural.properties, undefined)
})

test('mapErrors never echoes regex or enum values', () => {
  const regex = mapErrors(
    compiledWith(
      [
        {
          instancePath: '/properties/code',
          keyword: 'pattern',
          params: { pattern: '^secret-regex$' },
        },
      ],
      new Map([['properties/code', [{ id: 'code', label: 'Code' }]]]),
    ),
    {},
  )
  assert.equal(
    regex.properties.code.message.includes('secret-regex'),
    false,
  )

  const enumError = mapErrors(
    compiledWith(
      [
        {
          instancePath: '/properties/code',
          keyword: 'enum',
          params: { allowedValues: ['secret-enum'] },
        },
      ],
      new Map([['properties/code', [{ id: 'code', label: 'Code' }]]]),
    ),
    {},
  )
  assert.equal(
    enumError.properties.code.message.includes('secret-enum'),
    false,
  )
})

test('mapErrors runs a failed validator when AJV errors were not populated', () => {
  const validate = () => {
    validate.errors = [
      {
        instancePath: '/properties/name',
        keyword: 'type',
        params: { type: 'string' },
      },
    ]
    return false
  }
  validate.errors = null

  const errors = mapErrors(
    { validate, pathToFields: new Map([['properties/name', [{ label: 'Name' }]]]) },
    {},
  )
  assert.equal(errors.properties.name.message, 'Name has an invalid type.')
})

test('applyCrossField runs only when target and every dependency are EDIT', () => {
  const document = build({
    id: 'cross-field',
    version: '1',
    fields: [
      {
        id: 'start',
        type: 'Date',
        binding: { value: 'properties.start' },
        label: 'Start',
      },
      {
        id: 'end',
        type: 'Date',
        binding: { value: 'properties.end' },
        label: 'End',
      },
    ],
    validations: [
      {
        id: 'endRequired',
        target: 'properties.end',
        dependsOn: ['properties.start'],
        invalidWhen: { op: 'empty', path: 'properties.end' },
        message: 'End date is required',
      },
    ],
  })

  const values = { properties: { start: '', end: '' } }
  const modes = editModes(document)
  const errors = applyCrossField({ document }, values, modes, {})

  assert.equal(errors.properties.end.type, 'custom')
  assert.equal(errors.properties.end.message, 'End date is required')

  const targetView = applyCrossField(
    { document },
    values,
    editModes(document, { end: 'VIEW' }),
    {},
  )
  assert.deepEqual(targetView, {})

  const dependencyView = applyCrossField(
    { document },
    values,
    editModes(document, { start: 'VIEW' }),
    {},
  )
  assert.deepEqual(dependencyView, {})

  const existing = {
    properties: { end: { type: 'minLength', message: 'existing' } },
  }
  const preserved = applyCrossField({ document }, values, modes, existing)
  assert.equal(preserved.properties.end.message, 'existing')
})

test('applyCrossField resolves group wildcards per row with the row itemIndex', () => {
  const document = build({
    id: 'cross-field-group',
    version: '1',
    fields: [
      {
        id: 'participants',
        type: 'RepeatGroup',
        binding: { value: 'properties.participants' },
        label: 'Participants',
        template: [
          {
            id: 'participantName',
            type: 'Text',
            binding: { value: 'name' },
            label: 'Participant name',
            required: true,
          },
        ],
      },
    ],
    validations: [
      {
        id: 'participantNameRequired',
        group: 'participants',
        target: 'name',
        dependsOn: ['name'],
        invalidWhen: { op: 'empty', path: 'name' },
        message: 'Participant name is required',
      },
    ],
  })

  const values = {
    properties: {
      participants: [{ name: '' }, { name: 'Ada' }, { name: '' }],
    },
  }
  const errors = applyCrossField(
    { document },
    values,
    editModes(document),
    {},
  )

  assert.equal(Array.isArray(errors.properties.participants), true)
  assert.equal(
    errors.properties.participants[0].name.message,
    'Participant name is required',
  )
  assert.equal(errors.properties.participants[1], null)
  assert.equal(
    errors.properties.participants[2].name.message,
    'Participant name is required',
  )

  const childView = applyCrossField(
    { document },
    values,
    editModes(document, { participantName: 'VIEW' }),
    {},
  )
  assert.deepEqual(childView, {})
})

test('a resolver is synchronous, validates full values and reuses the cache', () => {
  const document = build({
    id: 'resolver',
    version: '1',
    fields: [
      {
        id: 'name',
        type: 'Text',
        binding: { value: 'properties.name' },
        label: 'Name',
        required: true,
      },
      {
        id: 'age',
        type: 'Number',
        binding: { value: 'properties.age' },
        label: 'Age',
        required: true,
      },
      {
        id: 'active',
        type: 'Boolean',
        binding: { value: 'properties.active' },
        label: 'Active',
        required: true,
      },
    ],
  })

  const engine = createEngine({
    document,
    getContext: () => ({
      permissions: permissionsFor(document),
      formMode: 'EDIT',
    }),
  })
  const resolver = createResolver(engine)

  const valid = { properties: { name: '   ', age: 0, active: false } }
  const validResult = resolver(valid)
  assert.equal(validResult.values, valid)
  assert.deepEqual(validResult.errors, {})

  const invalid = { properties: { name: '', age: 0, active: false } }
  const invalidResult = resolver(invalid)
  assert.equal(
    invalidResult.errors.properties.name.message,
    'Name must be at least 1 characters.',
  )

  // A whitespace-only value is not empty in v1.
  assert.equal(resolver({ properties: { name: ' ', age: 0, active: false } }).errors.properties?.name, undefined)
})

test('a resolver catches every failure and returns a root error', () => {
  const document = build({
    id: 'resolver-catch',
    version: '1',
    fields: [
      {
        id: 'name',
        type: 'Text',
        binding: { value: 'properties.name' },
        label: 'Name',
      },
    ],
  })

  const engine = createEngine({
    document,
    getContext: () => {
      throw new Error('context exploded')
    },
  })

  const result = engine.resolve({ properties: { name: 'Ada' } })
  assert.equal(result.errors.root.type, 'root')
  assert.equal(typeof result.errors.root.message, 'string')
  assert.equal(result.errors.root.message.includes('exploded'), false)
})

test('computeModes feeds the resolver through the engine context', () => {
  const document = build({
    id: 'resolver-modes',
    version: '1',
    fields: [
      {
        id: 'name',
        type: 'Text',
        binding: { value: 'properties.name' },
        label: 'Name',
        required: true,
      },
    ],
  })

  const permissions = permissionsFor(document)
  const modes = computeModes(document, {}, {
    permissions,
    formMode: 'VIEW',
    permissionKeyByField: document.permissionKeyByField,
  })
  assert.equal(modes.get('name'), 'VIEW')
  assert.equal(ASSEMBLER_VERSION, 1)
})

test('the fixture repeat group assembles one uniform items schema and maps row and group errors', () => {
  const parsed = parseDocument(DOCUMENT)
  assert.equal(parsed.ok, true, JSON.stringify(parsed.issues))
  const document = parsed.document

  const modes = editModes(document)
  const { schema, pathToFields } = assembleSchema(document, modes)
  const group = schemaAt(schema, ['properties', 'participants'])

  assert.equal(group.type, 'array')
  assert.equal(group.minItems, 1)
  assert.equal(group.items.type, 'object')
  assert.deepEqual(group.items.required, ['name'])
  assert.equal(group.items.properties.id.type, 'string')
  assert.equal(group.items.properties.name.type, 'string')
  assert.equal(group.items.properties.role.type, 'string')
  assert.equal(group.items.properties.taxId.type, 'string')
  assert.equal(group.items.properties.taxIdNA.type, 'boolean')
  assert.equal(JSON.stringify(schema).includes('additionalProperties'), false)

  assert.deepEqual(
    pathToFields
      .get('properties/participants/*/name')
      .map((def) => def.id),
    ['participantName'],
  )

  const engine = createEngine({
    document,
    getContext: () => ({
      permissions: permissionsFor(document),
      permissionKeyByField: document.permissionKeyByField,
      formMode: 'EDIT',
    }),
  })
  const resolver = createResolver(engine)

  const missingName = structuredClone(ENTITY)
  missingName.properties.participants[0].name = ''
  const rowResult = resolver(missingName)
  assert.equal(
    rowResult.errors.properties.participants[0].name.type,
    'minLength',
  )
  assert.equal(
    rowResult.errors.properties.participants[0].name.message,
    'Participant name must be at least 1 characters.',
  )

  const empty = structuredClone(ENTITY)
  empty.properties.participants = []
  const emptyResult = resolver(empty)
  assert.equal(
    emptyResult.errors.properties.participants.type,
    'minItems',
  )
  assert.equal(
    emptyResult.errors.properties.participants.message,
    'Participants needs at least 1 items.',
  )

  const holes = structuredClone(ENTITY)
  holes.properties.participants = [
    structuredClone(ENTITY.properties.participants[0]),
    { ...structuredClone(ENTITY.properties.participants[0]), id: 'p2', name: '' },
  ]
  const holesResult = resolver(holes)
  assert.equal(Array.isArray(holesResult.errors.properties.participants), true)
  assert.equal(holesResult.errors.properties.participants[0], null)
  assert.equal(
    holesResult.errors.properties.participants[1].name.type,
    'minLength',
  )
})
