import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_FIELDS, parseDocument } from './document.js'
import { hasBlocking } from './issues.js'

const template = () => [
  {
    id: 'participantName',
    type: 'Text',
    binding: { value: 'name' },
    label: 'Name',
  },
  {
    id: 'participantCountry',
    type: 'Text',
    binding: { value: 'country' },
    label: 'Country',
  },
  {
    id: 'participantTaxId',
    type: 'InputWithNA',
    binding: { value: 'taxId', isNA: 'taxIdIsNA' },
    label: 'Tax id',
  },
]

const validDoc = () => ({
  id: 'policy-form',
  version: '1.0.0',
  fields: [
    {
      id: 'country',
      type: 'Text',
      binding: { value: 'properties.country' },
      label: 'Country',
    },
    {
      id: 'state',
      type: 'Text',
      binding: { value: 'properties.state' },
      label: 'State',
    },
    {
      id: 'startDate',
      type: 'Date',
      binding: { value: 'properties.startDate' },
      label: 'Start date',
    },
    {
      id: 'endDate',
      type: 'Date',
      binding: { value: 'properties.endDate' },
      label: 'End date',
    },
    {
      id: 'taxId',
      type: 'InputWithNA',
      binding: {
        value: 'properties.taxId',
        isNA: 'properties.taxIdIsNA',
      },
      label: 'Tax id',
    },
    {
      id: 'participants',
      type: 'RepeatGroup',
      binding: { value: 'properties.participants' },
      label: 'Participants',
      itemKey: 'id',
      template: template(),
    },
    {
      id: 'attachment',
      type: 'ComplexStub',
      binding: {},
      label: 'Attachment',
    },
  ],
  rules: {
    visibility: [
      {
        id: 'hideStateOutsideUs',
        target: 'state',
        when: {
          op: 'neq',
          path: 'properties.country',
          value: 'US',
        },
      },
    ],
    cascades: [
      {
        id: 'defaultState',
        when: { op: 'eq', path: 'properties.country', value: 'US' },
        then: [{ kind: 'set', target: 'properties.state', value: 'CA' }],
      },
      {
        id: 'fillPolicy',
        when: { op: 'eq', path: 'properties.country', value: 'US' },
        then: [
          {
            kind: 'fetch',
            target: 'properties.taxId',
            source: 'policyCode',
            params: { country: 'properties.country' },
          },
        ],
      },
      {
        id: 'groupSet',
        group: 'participants',
        when: { op: 'eq', path: 'country', value: 'US' },
        then: [{ kind: 'set', target: 'name', value: 'Required' }],
      },
    ],
  },
  validations: [
    {
      id: 'endDateAfterStart',
      target: 'properties.endDate',
      dependsOn: ['properties.startDate'],
      invalidWhen: { op: 'empty', path: 'properties.endDate' },
      message: 'End date is required',
    },
  ],
})

const codes = (issues) => issues.map((issue) => issue.code)

const hasCode = (issues, code) => codes(issues).includes(code)

test('a valid fixture document parses into the shared contract shape', () => {
  const result = parseDocument(validDoc())

  assert.equal(result.ok, true)
  assert.equal(hasBlocking(result.issues), false)
  assert.equal(result.issues.length, 0)

  const { document } = result
  assert.equal(document.id, 'policy-form')
  assert.equal(document.version, '1.0.0')
  assert.deepEqual(
    document.fields.map((field) => field.id),
    ['country', 'state', 'startDate', 'endDate', 'taxId', 'participants', 'attachment'],
  )
  assert.deepEqual(
    [...document.fieldsById.keys()].sort(),
    [
      'attachment',
      'country',
      'endDate',
      'participantCountry',
      'participantName',
      'participantTaxId',
      'participants',
      'startDate',
      'state',
      'taxId',
    ],
  )
})

test('bindings and templateBindings are keyed by pathKey', () => {
  const { document } = parseDocument(validDoc())

  const taxIdBindings = document.bindings.get('properties/taxId')
  assert.equal(taxIdBindings.length, 1)
  assert.equal(taxIdBindings[0].fieldId, 'taxId')
  assert.equal(taxIdBindings[0].slotName, 'value')
  assert.deepEqual(taxIdBindings[0].segments, ['properties', 'taxId'])
  assert.equal(taxIdBindings[0].def.id, 'taxId')

  const isNaBindings = document.bindings.get('properties/taxIdIsNA')
  assert.equal(isNaBindings[0].slotName, 'isNA')

  const nameBindings = document.templateBindings.get('name')
  assert.equal(nameBindings.length, 1)
  assert.equal(nameBindings[0].fieldId, 'participantName')
  assert.equal(nameBindings[0].groupId, 'participants')
  assert.deepEqual(nameBindings[0].segments, ['name'])

  const child = document.fieldsById.get('participantName')
  assert.deepEqual(child.binding.value.segments, ['name'])
  assert.equal(child.binding.value.relative, true)
})

test('field defs expose the slot config, validation and defaults later milestones use', () => {
  const raw = validDoc()
  raw.fields[0].required = true
  raw.fields[0].disabled = { value: true }
  raw.fields[0].validation = {
    value: { type: 'string', enum: ['US', 'CA'] },
  }
  const { document } = parseDocument(raw)
  const country = document.fieldsById.get('country')

  assert.equal(country.permissionKey, 'country')
  assert.equal(country.label, 'Country')
  assert.deepEqual(country.props, {})
  assert.equal(country.isRepeat, false)
  assert.equal(country.isComplex, false)
  assert.equal(country.unknownType, false)
  assert.equal(country.forcedHidden, false)
  assert.deepEqual(country.template, [])
  assert.equal(country.binding.value.path, 'properties.country')
  assert.deepEqual(country.binding.value.segments, ['properties', 'country'])
  assert.equal(country.binding.value.relative, false)

  assert.equal(country.slots.value.name, 'value')
  assert.equal(country.slots.value.type, 'string')
  assert.equal(country.slots.value.required, true)
  assert.equal(country.slots.value.disabled, true)
  assert.equal(country.slots.value.emptyValue, '')
  assert.equal(typeof country.slots.value.normalize, 'function')
  assert.equal(country.slots.value.helpId, 'country-value-help')
  assert.deepEqual(country.validation.value, {
    type: 'string',
    enum: ['US', 'CA'],
  })
  assert.equal(document.permissionKeyByField.get('country'), 'country')
})

test('repeat groups and template children carry their repeat metadata', () => {
  const { document } = parseDocument(validDoc())
  const group = document.fieldsById.get('participants')

  assert.equal(group.isRepeat, true)
  assert.equal(group.itemKey, 'id')
  assert.equal(group.template.length, 3)
  assert.equal(group.template[0].id, 'participantName')
  assert.equal(group.slots.value.type, 'array')
  assert.deepEqual(group.slots.value.emptyValue, [])
})

test('visibility, cascade and cross-field rules are normalised', () => {
  const { document } = parseDocument(validDoc())
  const [visibility] = document.rules.visibility
  const [setRule, fetchRule, groupRule] = document.rules.cascades
  const [validation] = document.validations

  assert.equal(visibility.id, 'hideStateOutsideUs')
  assert.equal(visibility.target, 'state')
  assert.deepEqual(visibility.when.path, ['properties', 'country'])
  assert.deepEqual(visibility.dependsOn, [['properties', 'country']])

  assert.deepEqual(setRule.then[0].target, ['properties', 'state'])
  assert.equal(setRule.then[0].targetKey, 'properties/state')

  assert.equal(fetchRule.then[0].source, 'policyCode')
  assert.deepEqual(fetchRule.then[0].params, {
    country: 'properties.country',
  })
  assert.deepEqual(fetchRule.dependsOn, [['properties', 'country']])

  assert.deepEqual(groupRule.group, 'participants')
  assert.deepEqual(groupRule.when.path, [
    'properties',
    'participants',
    '*',
    'country',
  ])
  assert.deepEqual(groupRule.then[0].target, [
    'properties',
    'participants',
    '*',
    'name',
  ])

  assert.equal(validation.id, 'endDateAfterStart')
  assert.deepEqual(validation.target, ['properties', 'endDate'])
  assert.deepEqual(validation.dependsOn, [['properties', 'startDate']])
  assert.equal(validation.message, 'End date is required')
})

test('unknown field types are recoverable: blocking issue and read-only fallback flag', () => {
  const raw = validDoc()
  raw.fields.push({
    id: 'mystery',
    type: 'Mystery',
    binding: { value: 'properties.mystery' },
  })

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(hasCode(result.issues, 'field.type.unknown'), true)
  assert.equal(result.document.fieldsById.get('mystery').unknownType, true)
  assert.deepEqual(result.document.fieldsById.get('mystery').slots, {})
})

test('duplicate field ids reject the document', () => {
  const raw = validDoc()
  raw.fields.push({
    id: 'country',
    type: 'Text',
    binding: { value: 'properties.countryCopy' },
  })

  const result = parseDocument(raw)
  assert.equal(result.ok, false)
  assert.equal(result.document, null)
  assert.equal(hasCode(result.issues, 'field.id.duplicate'), true)
})

test('bad document roots reject the document', () => {
  const cases = [
    [(doc) => delete doc.id, 'document.id'],
    [(doc) => delete doc.version, 'document.version'],
    [(doc) => (doc.fields = []), 'document.fields'],
    [(doc) => (doc.fields = 'nope'), 'document.fields'],
  ]

  for (const [mutate, code] of cases) {
    const raw = validDoc()
    mutate(raw)
    const result = parseDocument(raw)
    assert.equal(result.ok, false, code)
    assert.equal(result.document, null, code)
    assert.equal(hasCode(result.issues, code), true, code)
  }
})

test('unsafe field ids reject the document', () => {
  const raw = validDoc()
  raw.fields.push({
    id: 'bad id',
    type: 'Text',
    binding: { value: 'properties.bad' },
  })

  const result = parseDocument(raw)
  assert.equal(result.ok, false)
  assert.equal(hasCode(result.issues, 'field.id.invalid'), true)
})

test('an unbound cascade target skips the rule with a blocking issue', () => {
  const raw = validDoc()
  raw.rules.cascades = [
    {
      id: 'badTarget',
      when: { op: 'empty', path: 'properties.country' },
      then: [{ kind: 'set', target: 'properties.noSuchPath', value: 1 }],
    },
  ]

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(result.document.rules.cascades.length, 0)
  assert.equal(hasCode(result.issues, 'cascade.target.unknown'), true)
})

test('a container cascade target is rejected', () => {
  const raw = validDoc()
  raw.rules.cascades = [
    {
      id: 'containerTarget',
      when: { op: 'empty', path: 'properties.country' },
      then: [{ kind: 'set', target: 'properties.participants', value: [] }],
    },
  ]

  const result = parseDocument(raw)
  assert.equal(result.document.rules.cascades.length, 0)
  assert.equal(hasCode(result.issues, 'cascade.target.container'), true)
})

test('unknown cascade effects fail closed and never reach the rule list', () => {
  const raw = validDoc()
  raw.rules.cascades = [
    {
      id: 'unknownEffect',
      when: { op: 'empty', path: 'properties.country' },
      then: [{ kind: 'teleport', target: 'properties.state', source: 'x' }],
    },
  ]

  const result = parseDocument(raw)
  assert.equal(result.document.rules.cascades.length, 0)
  assert.equal(hasCode(result.issues, 'cascade.effect.unknown'), true)
})

test('a fetch effect with a missing source is skipped when sources are supplied', () => {
  const raw = validDoc()
  raw.rules.cascades = raw.rules.cascades.filter((rule) => rule.id === 'fillPolicy')

  const result = parseDocument(raw, { sources: {} })
  assert.equal(result.document.rules.cascades.length, 0)
  assert.equal(hasCode(result.issues, 'cascade.source.missing'), true)
})

test('a known fetch source passes validation when sources are supplied', () => {
  const raw = validDoc()
  raw.rules.cascades = raw.rules.cascades.filter((rule) => rule.id === 'fillPolicy')

  const result = parseDocument(raw, {
    sources: { policyCode: async () => ({}) },
  })
  assert.equal(hasBlocking(result.issues), false)
  assert.equal(result.document.rules.cascades.length, 1)
})

test('cascade targets may use a template wildcard', () => {
  const raw = validDoc()
  raw.rules.cascades = [
    {
      id: 'templateTarget',
      when: { op: 'empty', path: 'properties.country' },
      then: [
        {
          kind: 'set',
          target: 'properties.participants.*.name',
          value: 'Row',
        },
      ],
    },
  ]

  const result = parseDocument(raw)
  assert.equal(result.document.rules.cascades.length, 1)
  assert.deepEqual(result.document.rules.cascades[0].then[0].target, [
    'properties',
    'participants',
    '*',
    'name',
  ])
})

test('bad fragments are blocking and exclude that slot from validation', () => {
  const raw = validDoc()
  raw.fields[0].validation = {
    value: { required: true },
  }

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(hasCode(result.issues, 'field.validation.keyword'), true)
  assert.equal(
    result.document.fieldsById.get('country').validation.value,
    undefined,
  )
})

test('patterns over 200 characters are rejected', () => {
  const raw = validDoc()
  raw.fields[0].validation = {
    value: { type: 'string', pattern: 'a'.repeat(201) },
  }

  const result = parseDocument(raw)
  assert.equal(hasCode(result.issues, 'field.validation.pattern'), true)
  assert.equal(
    result.document.fieldsById.get('country').validation.value,
    undefined,
  )
})

test('the field cap is enforced with a blocking issue', () => {
  const raw = validDoc()
  raw.fields = Array.from({ length: MAX_FIELDS + 1 }, (_, index) => ({
    id: `field${index}`,
    type: 'Text',
    binding: { value: `properties.field${index}` },
  }))
  raw.rules = { visibility: [], cascades: [] }
  raw.validations = []

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(hasCode(result.issues, 'document.fields.limit'), true)
  assert.ok(result.document.fields.length <= MAX_FIELDS)
})

test('a visibility rule may not target a template child', () => {
  const raw = validDoc()
  raw.rules.visibility = [
    {
      id: 'perItem',
      target: 'participantName',
      when: { op: 'empty', path: 'properties.country' },
    },
  ]

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(result.document.rules.visibility.length, 0)
  assert.equal(hasCode(result.issues, 'visibility.templateTarget'), true)
  assert.equal(result.document.forcedHidden.has('participants'), true)
  assert.equal(result.document.fieldsById.get('participants').forcedHidden, true)
})

test('an unknown visibility target is blocking and forced hidden', () => {
  const raw = validDoc()
  raw.rules.visibility = [
    {
      id: 'missingTarget',
      target: 'ghost',
      when: { op: 'empty', path: 'properties.country' },
    },
  ]

  const result = parseDocument(raw)
  assert.equal(result.document.rules.visibility.length, 0)
  assert.equal(hasCode(result.issues, 'visibility.target.unknown'), true)
  assert.equal(result.document.forcedHidden.has('ghost'), true)
})

test('an invalid visibility condition hides its target and skips the rule', () => {
  const raw = validDoc()
  raw.rules.visibility = [
    {
      id: 'badCondition',
      target: 'state',
      when: { op: 'between', path: 'properties.country', value: 1 },
    },
  ]

  const result = parseDocument(raw)
  assert.equal(result.document.rules.visibility.length, 0)
  assert.equal(result.document.forcedHidden.has('state'), true)
  assert.equal(result.document.fieldsById.get('state').forcedHidden, true)
  assert.equal(hasCode(result.issues, 'condition.operator'), true)
})

test('numeric segments outside declared array positions are rejected', () => {
  const raw = validDoc()
  raw.fields.push({
    id: 'badYear',
    type: 'Text',
    binding: { value: 'properties.2024.value' },
  })

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(hasCode(result.issues, 'field.binding.numeric'), true)
  assert.equal(result.document.fieldsById.get('badYear').slots.value, undefined)
})

test('prefix-overlapping bindings are blocking', () => {
  const raw = validDoc()
  raw.fields.push(
    {
      id: 'address',
      type: 'Text',
      binding: { value: 'properties.address' },
    },
    {
      id: 'city',
      type: 'Text',
      binding: { value: 'properties.address.city' },
    },
  )

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(hasCode(result.issues, 'binding.prefix'), true)
})

test('nested repeat groups are rejected', () => {
  const raw = validDoc()
  raw.fields[5].template.push({
    id: 'nested',
    type: 'RepeatGroup',
    binding: { value: 'nested' },
    template: [
      { id: 'nestedLeaf', type: 'Text', binding: { value: 'value' } },
    ],
  })

  const result = parseDocument(raw)
  assert.equal(result.ok, true)
  assert.equal(hasCode(result.issues, 'repeat.nested'), true)
  assert.equal(result.document.fieldsById.has('nested'), false)
})

test('template child bindings must be relative', () => {
  const raw = validDoc()
  raw.fields[5].template[0].binding = { value: 'properties.name' }

  const result = parseDocument(raw)
  assert.equal(hasCode(result.issues, 'field.binding.relative'), true)
  assert.equal(
    result.document.fieldsById.get('participantName').binding.value,
    undefined,
  )
})

test('an invalid repeat itemKey is blocking and falls back to undefined', () => {
  const raw = validDoc()
  raw.fields[5].itemKey = 'bad key'

  const result = parseDocument(raw)
  assert.equal(hasCode(result.issues, 'repeat.itemKey'), true)
  assert.equal(result.document.fieldsById.get('participants').itemKey, undefined)
})

test('runaway rule counts are capped with a blocking issue', () => {
  const raw = validDoc()
  raw.rules.cascades = Array.from({ length: 201 }, (_, index) => ({
    id: `rule${index}`,
    when: { op: 'empty', path: 'properties.country' },
    then: [{ kind: 'set', target: 'properties.state', value: index }],
  }))
  raw.rules.visibility = []
  raw.validations = []

  const result = parseDocument(raw)
  assert.equal(hasCode(result.issues, 'document.rules.limit'), true)
  assert.ok(result.document.rules.cascades.length <= 200)
})
