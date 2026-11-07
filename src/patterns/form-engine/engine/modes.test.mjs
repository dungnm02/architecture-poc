import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RANK,
  lower,
  normalizePermissions,
  resolveMode,
  ancestorMode,
  computeModes,
  planModeChange,
} from './modes.js'

const def = (id, extra = {}) => ({
  id,
  permissionKey: id,
  forcedHidden: false,
  template: [],
  ...extra,
})

const ctx = (over = {}) => ({
  permissions: new Map(),
  permissionKeyByField: new Map(),
  formMode: 'EDIT',
  ...over,
})

const permissions = (entries) => new Map(entries)

test('RANK and lower implement the HIDDEN < VIEW < EDIT lattice', () => {
  assert.deepEqual(RANK, { HIDDEN: 0, VIEW: 1, EDIT: 2 })
  assert.equal(lower('EDIT', 'VIEW'), 'VIEW')
  assert.equal(lower('VIEW', 'EDIT'), 'VIEW')
  assert.equal(lower('EDIT', 'HIDDEN'), 'HIDDEN')
  assert.equal(lower('HIDDEN', 'EDIT'), 'HIDDEN')
  assert.equal(lower('VIEW', 'VIEW'), 'VIEW')
})

test('normalizePermissions accepts only exact EDIT and VIEW grants', () => {
  const { permissions: granted, issues } = normalizePermissions({
    a: 'EDIT',
    b: 'VIEW',
    c: 'edit',
    d: 'NONE',
    e: true,
    f: null,
    g: 'Edit',
  })

  assert.deepEqual([...granted.entries()], [
    ['a', 'EDIT'],
    ['b', 'VIEW'],
  ])
  assert.equal(issues.length, 5)
  assert.ok(issues.every((issue) => issue.severity === 'warning'))
  assert.ok(issues.every((issue) => issue.code === 'permission.invalid'))
  assert.deepEqual(
    issues.map((issue) => issue.detail?.key).sort(),
    ['c', 'd', 'e', 'f', 'g'],
  )
})

test('normalizePermissions also accepts a Map and treats absence as empty', () => {
  const mapped = normalizePermissions(
    new Map([
      ['a', 'EDIT'],
      ['b', 'bogus'],
    ]),
  )
  assert.deepEqual([...mapped.permissions.entries()], [['a', 'EDIT']])
  assert.equal(mapped.issues.length, 1)

  assert.deepEqual(normalizePermissions(undefined), {
    permissions: new Map(),
    issues: [],
  })
})

test('missing grant is HIDDEN in every form mode', () => {
  for (const formMode of ['EDIT', 'VIEW']) {
    assert.equal(
      resolveMode(def('country'), () => ({}), null, ctx({ formMode })),
      'HIDDEN',
    )
  }
})

test('invalid grants never become EDIT', () => {
  for (const grant of ['edit', 'NONE', true, null, undefined, 'View']) {
    assert.equal(
      resolveMode(
        def('country'),
        () => ({}),
        null,
        ctx({ permissions: permissions([['country', grant]]) }),
      ),
      'HIDDEN',
      String(grant),
    )
  }
})

test('form VIEW demotes an EDIT grant to VIEW', () => {
  const context = ctx({
    permissions: permissions([['country', 'EDIT']]),
    formMode: 'VIEW',
  })
  assert.equal(resolveMode(def('country'), () => ({}), null, context), 'VIEW')
})

test('an explicit VIEW grant stays VIEW', () => {
  const context = ctx({
    permissions: permissions([['country', 'VIEW']]),
    formMode: 'EDIT',
  })
  assert.equal(resolveMode(def('country'), () => ({}), null, context), 'VIEW')
})

test('visibility is applied after the permission allowlist', () => {
  let calls = 0
  const context = ctx({
    visibility: () => {
      calls += 1
      return true
    },
  })
  assert.equal(resolveMode(def('country'), () => ({}), null, context), 'HIDDEN')
  assert.equal(calls, 0)

  const granted = ctx({
    permissions: permissions([['country', 'EDIT']]),
    visibility: () => {
      calls += 1
      return true
    },
  })
  assert.equal(resolveMode(def('country'), () => ({}), null, granted), 'HIDDEN')
  assert.equal(calls, 1)
})

test('forcedHidden hides regardless of grants', () => {
  const context = ctx({
    permissions: permissions([['country', 'EDIT']]),
  })
  assert.equal(
    resolveMode(def('country', { forcedHidden: true }), () => ({}), null, context),
    'HIDDEN',
  )
})

test('ancestor mode folds after visibility and before form mode', () => {
  const context = ctx({
    permissions: permissions([['child', 'EDIT']]),
  })
  assert.equal(
    resolveMode(def('child'), () => ({}), { ancestorMode: 'VIEW' }, context),
    'VIEW',
  )
  assert.equal(
    resolveMode(def('child'), () => ({}), { ancestorMode: 'HIDDEN' }, context),
    'HIDDEN',
  )
})

test('permissionKey defaults to the field id and is overridable', () => {
  const byId = ctx({
    permissions: permissions([['country', 'EDIT']]),
  })
  assert.equal(resolveMode(def('country'), () => ({}), null, byId), 'EDIT')

  const overridden = ctx({
    permissions: permissions([['policy.country', 'VIEW']]),
    permissionKeyByField: new Map([['country', 'policy.country']]),
  })
  assert.equal(
    resolveMode(def('country'), () => ({}), null, overridden),
    'VIEW',
  )
})

test('ancestorMode returns EDIT at top level and fails closed on garbage', () => {
  assert.equal(ancestorMode(null), 'EDIT')
  assert.equal(ancestorMode(undefined), 'EDIT')
  assert.equal(ancestorMode({ ancestorMode: 'EDIT' }), 'EDIT')
  assert.equal(ancestorMode({ ancestorMode: 'VIEW' }), 'VIEW')
  assert.equal(ancestorMode({ ancestorMode: 'HIDDEN' }), 'HIDDEN')
  assert.equal(ancestorMode({ ancestorMode: 'bogus' }), 'HIDDEN')
})

test('computeModes covers template children and folds the group mode down', () => {
  const child = def('participantName')
  const group = def('participants', {
    isRepeat: true,
    template: [child],
    binding: { value: { segments: ['properties', 'participants'] } },
  })
  const top = def('country')
  const document = {
    fields: [group, top],
    fieldsById: new Map([
      ['participants', group],
      ['participantName', child],
      ['country', top],
    ]),
    forcedHidden: new Set(),
  }

  const modes = computeModes(
    document,
    { properties: { participants: [{ name: 'A' }] } },
    ctx({
      permissions: permissions([
        ['participants', 'VIEW'],
        ['participantName', 'EDIT'],
        ['country', 'EDIT'],
      ]),
    }),
  )

  assert.equal(modes.get('participants'), 'VIEW')
  assert.equal(modes.get('participantName'), 'VIEW')
  assert.equal(modes.get('country'), 'EDIT')
})

test('planModeChange is a no-op for the current mode and never warns', () => {
  for (const dirty of [false, true]) {
    let warned = 0
    assert.deepEqual(
      planModeChange({
        next: 'VIEW',
        mode: 'VIEW',
        dirty,
        complexDirty: dirty,
        warn: () => {
          warned += 1
          return false
        },
      }),
      { apply: false, reset: false },
    )
    assert.equal(warned, 0)
  }
})

test('planModeChange to VIEW does not warn or reset when clean', () => {
  let warned = 0
  assert.deepEqual(
    planModeChange({
      next: 'VIEW',
      mode: 'EDIT',
      dirty: false,
      complexDirty: false,
      warn: () => {
        warned += 1
        return false
      },
    }),
    { apply: true, reset: false },
  )
  assert.equal(warned, 0)
})

test('planModeChange to VIEW asks before discarding drafts', () => {
  let warned = 0
  const warn = () => {
    warned += 1
    return true
  }

  assert.deepEqual(
    planModeChange({
      next: 'VIEW',
      mode: 'EDIT',
      dirty: true,
      complexDirty: false,
      warn,
    }),
    { apply: true, reset: true },
  )
  assert.deepEqual(
    planModeChange({
      next: 'VIEW',
      mode: 'EDIT',
      dirty: false,
      complexDirty: true,
      warn,
    }),
    { apply: true, reset: true },
  )
  assert.equal(warned, 2)
})

test('planModeChange to VIEW cancels both the toggle and reset when warned', () => {
  let warned = 0
  assert.deepEqual(
    planModeChange({
      next: 'VIEW',
      mode: 'EDIT',
      dirty: true,
      complexDirty: false,
      warn: () => {
        warned += 1
        return false
      },
    }),
    { apply: false, reset: false },
  )
  assert.equal(warned, 1)
})

test('planModeChange back to EDIT keeps drafts and never warns', () => {
  let warned = 0
  assert.deepEqual(
    planModeChange({
      next: 'EDIT',
      mode: 'VIEW',
      dirty: true,
      complexDirty: true,
      warn: () => {
        warned += 1
        return false
      },
    }),
    { apply: true, reset: false },
  )
  assert.equal(warned, 0)
})

test('computeModes honours forced hidden groups and visibility functions', () => {
  const child = def('participantName')
  const group = def('participants', {
    isRepeat: true,
    template: [child],
  })
  const country = def('country')
  const document = {
    fields: [group, country],
    fieldsById: new Map([
      ['participants', group],
      ['participantName', child],
      ['country', country],
    ]),
    forcedHidden: new Set(['participants']),
  }

  const modes = computeModes(
    document,
    { properties: { country: 'CA' } },
    ctx({
      permissions: permissions([
        ['participants', 'EDIT'],
        ['participantName', 'EDIT'],
        ['country', 'EDIT'],
      ]),
      visibility: (id, get) =>
        id === 'country' && get().properties.country === 'CA',
    }),
  )

  assert.equal(modes.get('participants'), 'HIDDEN')
  assert.equal(modes.get('participantName'), 'HIDDEN')
  assert.equal(modes.get('country'), 'HIDDEN')
})
