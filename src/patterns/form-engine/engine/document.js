import { fieldTypes } from '../registry/index.js'
import { createIssue } from './issues.js'
import {
  SEGMENT,
  INDEX,
  RESERVED,
  parsePath,
  pathKey,
  pathStartsWith,
} from './paths.js'
import { validateCondition } from './conditions.js'
import { validateFragment } from './validation.js'

/**
 * Document parse is the only place a UI schema becomes trusted. It validates
 * once, normalises paths to segment arrays, and returns a document even for
 * recoverable failures (unknown type, bad rule, bad fragment) so the form can
 * show a banner and disable submit. Only an unusable root returns `ok: false`.
 */

export { FRAGMENT_KEYWORDS } from './validation.js'

export const MAX_FIELDS = 500
export const MAX_RULES = 200
export const MAX_TEMPLATE_FIELDS = 100

const UNSAFE = /[.[\]'"~/]/

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const getEntry = (registry, type) => {
  if (registry instanceof Map) return registry.get(type)
  if (registry && typeof registry === 'object') return registry[type]
  return undefined
}

const hasOwn = (value, key) => Object.hasOwn(value, key)

const hasControlCharacters = (value) =>
  [...value].some((character) => character.charCodeAt(0) < 32)

function segmentList(rawPath, { allowWildcard = false } = {}) {
  let segments
  if (Array.isArray(rawPath)) {
    if (rawPath.length === 0) return null
    segments = [...rawPath]
  } else if (typeof rawPath === 'string') {
    if (rawPath === '') return null
    segments = rawPath.split('.')
  } else {
    return null
  }

  for (const segment of segments) {
    if (typeof segment !== 'string' || segment === '') return null
    if (segment === '*') {
      if (!allowWildcard) return null
      continue
    }
    if (RESERVED.has(segment)) return null
    if (INDEX.test(segment)) continue
    if (/^\d+$/.test(segment)) return null
    if (!SEGMENT.test(segment) || UNSAFE.test(segment)) return null
  }

  return segments
}

/**
 * @param {unknown} raw
 * @param {{ registry?: Map<string, object>, sources?: Record<string, Function>|Map<string, Function> }} [options]
 * @returns {{ ok: boolean, document: object|null, issues: object[] }}
 */
export function parseDocument(raw, options = {}) {
  const registry = options.registry ?? fieldTypes
  const sources = options.sources
  const issues = []

  const emit = (code, detail = {}, severity = 'blocking') => {
    const issue = createIssue(code, severity, detail)
    issues.push(issue)
    return issue
  }

  if (!isPlainObject(raw)) {
    emit('document.invalid', {})
    return { ok: false, document: null, issues }
  }

  let fatal = false

  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    emit('document.id', {})
    fatal = true
  }
  if (
    !(
      (typeof raw.version === 'string' && raw.version.trim() !== '') ||
      (typeof raw.version === 'number' && Number.isFinite(raw.version))
    )
  ) {
    emit('document.version', {})
    fatal = true
  }
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
    emit('document.fields', {})
    fatal = true
  }

  if (fatal) return { ok: false, document: null, issues }

  const fieldsById = new Map()
  const permissionKeyByField = new Map()
  const bindings = new Map()
  const templateBindings = new Map()
  const templateFieldIds = new Map()
  const forcedHidden = new Set()
  const fields = []

  let fieldCount = 0
  let fieldsLimitEmitted = false
  let templateLimitEmitted = false

  const takeFieldBudget = (detail) => {
    if (fieldCount >= MAX_FIELDS) {
      if (!fieldsLimitEmitted) {
        fieldsLimitEmitted = true
        emit('document.fields.limit', { max: MAX_FIELDS, ...detail })
      }
      return false
    }
    fieldCount += 1
    return true
  }

  const rootSegments = new Set()
  for (const rawField of raw.fields) {
    if (!isPlainObject(rawField)) continue
    const rawBinding = rawField.binding
    const candidates =
      typeof rawBinding === 'string'
        ? [rawBinding]
        : isPlainObject(rawBinding)
          ? Object.values(rawBinding)
          : []
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const parsed = parsePath(candidate)
      if (parsed.ok && parsed.segments.length > 0) {
        rootSegments.add(parsed.segments[0])
      }
    }
  }

  const addBinding = (field, slotName, segments, relative, groupId) => {
    if (relative) {
      const key = pathKey(segments)
      const list = templateBindings.get(key) ?? []
      list.push({
        fieldId: field.id,
        slotName,
        segments,
        def: field,
        groupId,
      })
      templateBindings.set(key, list)
      return
    }

    const key = pathKey(segments)
    const list = bindings.get(key) ?? []
    list.push({ fieldId: field.id, slotName, segments, def: field })
    bindings.set(key, list)
  }

  const slotFlag = (rawFlag, slotName, fallback = false) => {
    if (typeof rawFlag === 'boolean') return rawFlag
    if (isPlainObject(rawFlag)) return Boolean(rawFlag[slotName])
    return Boolean(fallback)
  }

  const parseField = (rawField, { relative = false, groupId = null } = {}) => {
    if (!isPlainObject(rawField)) {
      emit('field.invalid', {})
      fatal = true
      return null
    }

    const { id, type } = rawField
    if (
      typeof id !== 'string' ||
      id === '' ||
      !SEGMENT.test(id) ||
      RESERVED.has(id)
    ) {
      emit('field.id.invalid', {
        fieldId: typeof id === 'string' ? id : undefined,
      })
      fatal = true
      return null
    }
    if (fieldsById.has(id)) {
      emit('field.id.duplicate', { fieldId: id })
      fatal = true
      return null
    }
    if (!takeFieldBudget({ fieldId: id })) return null

    let entry
    let unknownType = false
    if (typeof type !== 'string' || type === '') {
      emit('field.type.invalid', { fieldId: id })
      unknownType = true
    } else {
      entry = getEntry(registry, type)
      if (!entry) {
        emit('field.type.unknown', { fieldId: id, type })
        unknownType = true
      }
    }

    const rawPermissionKey = rawField.permissionKey ?? id
    const permissionKey =
      typeof rawPermissionKey === 'string' &&
      rawPermissionKey.trim() !== '' &&
      rawPermissionKey.length <= 200 &&
      !hasControlCharacters(rawPermissionKey)
        ? rawPermissionKey
        : id
    if (permissionKey !== rawPermissionKey) {
      emit('field.permissionKey', {
        fieldId: id,
        permissionKey: rawPermissionKey,
      })
    }

    const field = {
      id,
      type,
      binding: {},
      slots: {},
      permissionKey,
      label: typeof rawField.label === 'string' ? rawField.label : id,
      help: rawField.help,
      props: isPlainObject(rawField.props) ? rawField.props : {},
      defaultValue: rawField.defaultValue,
      validation: {},
      required: {},
      disabled: {},
      template: [],
      itemKey: undefined,
      isRepeat: Boolean(entry?.repeat),
      isComplex: Boolean(entry?.complex),
      unknownType,
      forcedHidden: false,
    }

    fieldsById.set(id, field)
    permissionKeyByField.set(id, permissionKey)
    if (relative && groupId) templateFieldIds.set(id, groupId)

    if (!unknownType) {
      let rawBindings = {}
      if (typeof rawField.binding === 'string') {
        rawBindings = { value: rawField.binding }
      } else if (isPlainObject(rawField.binding)) {
        rawBindings = rawField.binding
      } else if (rawField.binding !== undefined) {
        emit('field.binding.invalid', {
          fieldId: id,
          reason: 'shape',
        })
      }

      for (const slotName of Object.keys(entry.slots)) {
        const rawPath = rawBindings[slotName]
        if (typeof rawPath !== 'string' || rawPath === '') {
          emit('field.binding.missing', { fieldId: id, slotName })
          continue
        }

        const parsed = parsePath(rawPath)
        if (!parsed.ok) {
          emit('field.binding.invalid', {
            fieldId: id,
            slotName,
            reason: parsed.issue.code,
          })
          continue
        }
        if (parsed.segments.some((segment) => INDEX.test(segment))) {
          emit('field.binding.numeric', {
            fieldId: id,
            slotName,
            path: rawPath,
          })
          continue
        }
        if (relative && rootSegments.has(parsed.segments[0])) {
          emit('field.binding.relative', {
            fieldId: id,
            slotName,
            path: rawPath,
          })
          continue
        }

        const slotMeta = entry.slots[slotName]
        const required = slotFlag(
          rawField.required,
          slotName,
          slotMeta.required,
        )
        const disabled = slotFlag(rawField.disabled, slotName, false)

        field.binding[slotName] = {
          path: rawPath,
          segments: parsed.segments,
          relative,
        }
        field.slots[slotName] = {
          name: slotName,
          type: slotMeta.type,
          required,
          disabled,
          emptyValue: slotMeta.emptyValue,
          normalize: slotMeta.normalize,
          helpId: `${id}-${slotName}-help`,
        }
        field.required[slotName] = required
        field.disabled[slotName] = disabled
        addBinding(field, slotName, parsed.segments, relative, groupId)
      }

      for (const slotName of Object.keys(rawBindings)) {
        if (!hasOwn(entry.slots, slotName)) {
          emit('field.binding.unknownSlot', { fieldId: id, slotName })
        }
      }
    }

    if (rawField.validation !== undefined) {
      if (!isPlainObject(rawField.validation)) {
        emit('field.validation.shape', { fieldId: id })
      } else {
        for (const [slotName, fragment] of Object.entries(
          rawField.validation,
        )) {
          if (!hasOwn(field.slots, slotName)) {
            emit('field.validation.unknownSlot', { fieldId: id, slotName })
            continue
          }
          const problems = validateFragment(fragment)
          if (problems.length > 0) {
            for (const problem of problems) {
              issues.push(
                createIssue(problem.code, 'blocking', {
                  ...problem.detail,
                  fieldId: id,
                  slotName,
                }),
              )
            }
            continue
          }
          field.validation[slotName] = fragment
        }
      }
    }

    if (field.isRepeat) {
      if (!Array.isArray(rawField.template) || rawField.template.length === 0) {
        emit('repeat.template', { fieldId: id })
      } else {
        let templateCount = 0
        for (const rawChild of rawField.template) {
          if (templateCount >= MAX_TEMPLATE_FIELDS) {
            if (!templateLimitEmitted) {
              templateLimitEmitted = true
              emit('document.template.limit', { fieldId: id })
            }
            break
          }
          const childType = isPlainObject(rawChild)
            ? rawChild.type
            : undefined
          const childEntry = getEntry(registry, childType)
          if (childType === 'RepeatGroup' || childEntry?.repeat) {
            emit('repeat.nested', {
              fieldId: isPlainObject(rawChild) ? rawChild.id : undefined,
              groupId: id,
            })
            continue
          }
          const child = parseField(rawChild, {
            relative: true,
            groupId: id,
          })
          if (child) {
            field.template.push(child)
            templateCount += 1
          }
        }
      }

      if (rawField.itemKey !== undefined) {
        if (
          typeof rawField.itemKey !== 'string' ||
          !SEGMENT.test(rawField.itemKey) ||
          RESERVED.has(rawField.itemKey)
        ) {
          emit('repeat.itemKey', { fieldId: id, itemKey: rawField.itemKey })
        } else {
          field.itemKey = rawField.itemKey
        }
      }
    } else if (rawField.template !== undefined) {
      emit('field.template.unexpected', { fieldId: id })
    }

    return field
  }

  for (const rawField of raw.fields) {
    const field = parseField(rawField)
    if (field) fields.push(field)
  }

  if (fatal) return { ok: false, document: null, issues }

  // Prefix overlap is unsound for leaf-only validation. Exact duplicate
  // bindings are allowed (two fields may constrain one path), a strict prefix
  // is not, except the group/template relationship handled separately.
  const topLevelKeys = [...bindings.keys()]
  for (let i = 0; i < topLevelKeys.length; i += 1) {
    const left = topLevelKeys[i]
    const leftSegments = left.split('/')
    for (let j = i + 1; j < topLevelKeys.length; j += 1) {
      const right = topLevelKeys[j]
      const rightSegments = right.split('/')
      if (
        pathStartsWith(leftSegments, rightSegments) ||
        pathStartsWith(rightSegments, leftSegments)
      ) {
        if (leftSegments.length !== rightSegments.length) {
          emit('binding.prefix', { left, right })
        }
      }
    }
  }

  const repeatPaths = new Set()
  for (const field of fieldsById.values()) {
    const segments = field.binding.value?.segments
    if (field.isRepeat && segments) repeatPaths.add(pathKey(segments))
  }

  const declared = new Set(bindings.keys())
  for (const entries of templateBindings.values()) {
    for (const entry of entries) {
      const group = fieldsById.get(entry.groupId)
      const groupSegments = group?.binding.value?.segments ?? []
      declared.add(pathKey([...groupSegments, '*', ...entry.segments]))
    }
  }

  const numericLookup = (segments) => {
    const lookup = []
    for (const segment of segments) {
      if (INDEX.test(segment)) {
        if (!repeatPaths.has(pathKey(lookup))) return null
        lookup.push('*')
      } else {
        lookup.push(segment)
      }
    }
    return lookup
  }

  const matchDeclared = (segments) => {
    if (declared.has(pathKey(segments))) return segments
    const lookup = numericLookup(segments)
    if (lookup && declared.has(pathKey(lookup))) return segments
    return null
  }

  const resolvePath = (segments) =>
    matchDeclared(segments)
      ? { ok: true, segments }
      : { ok: false }

  const containerKeys = new Set(repeatPaths)
  for (const key of declared) {
    const segments = key.split('/')
    for (let i = 1; i < segments.length; i += 1) {
      containerKeys.add(segments.slice(0, i).join('/'))
    }
  }

  const slotTypesByKey = new Map()
  for (const [key, entries] of bindings) {
    for (const entry of entries) {
      const type = entry.def?.slots?.[entry.slotName]?.type
      if (type) slotTypesByKey.set(key, type)
    }
  }
  for (const entries of templateBindings.values()) {
    for (const entry of entries) {
      const group = fieldsById.get(entry.groupId)
      const groupSegments = group?.binding.value?.segments ?? []
      const key = pathKey([...groupSegments, '*', ...entry.segments])
      const type = entry.def?.slots?.[entry.slotName]?.type
      if (type) slotTypesByKey.set(key, type)
    }
  }

  const targetKeyFor = (segments) =>
    pathKey(numericLookup(segments) ?? segments)

  const resolveRulePath = (rawPath, scopePrefix) => {
    const parsed = segmentList(rawPath, { allowWildcard: true })
    if (!parsed) return null
    if (matchDeclared(parsed)) return parsed
    if (scopePrefix) {
      const combined = [...scopePrefix, ...parsed]
      if (matchDeclared(combined)) return combined
    }
    return null
  }

  const resolveTarget = (rawPath, scopePrefix) => {
    const parsed = segmentList(rawPath, { allowWildcard: true })
    if (!parsed) return { status: 'invalid' }

    const resolved = resolveRulePath(rawPath, scopePrefix)
    const candidate = resolved ?? parsed
    const key = targetKeyFor(candidate)

    if (containerKeys.has(key)) return { status: 'container' }
    const slotType = slotTypesByKey.get(key)
    if (slotType === 'array' || slotType === 'object') {
      return { status: 'container' }
    }
    if (!resolved) return { status: 'unknown' }
    if (!declared.has(key)) return { status: 'unknown' }
    return { status: 'leaf', segments: resolved }
  }

  const conditionOptions = (scopePrefix) => ({
    resolvePath,
    scopePrefix,
  })

  const forwardConditionIssues = (conditionIssues, context) => {
    for (const problem of conditionIssues) {
      issues.push(
        createIssue(problem.code, 'blocking', {
          ...problem.detail,
          ...context,
        }),
      )
    }
  }

  const groupContext = (groupId, code, ruleId) => {
    if (groupId === undefined) return { ok: true, scopePrefix: null }
    const group = fieldsById.get(groupId)
    const segments = group?.binding.value?.segments
    if (!group || !group.isRepeat || !segments) {
      emit(code, { ruleId, groupId })
      return { ok: false, scopePrefix: null }
    }
    return { ok: true, scopePrefix: [...segments, '*'] }
  }

  let ruleCount = 0
  let rulesLimitEmitted = false
  const takeRuleBudget = (kind) => {
    if (ruleCount >= MAX_RULES) {
      if (!rulesLimitEmitted) {
        rulesLimitEmitted = true
        emit('document.rules.limit', { max: MAX_RULES, kind })
      }
      return false
    }
    ruleCount += 1
    return true
  }

  const visibilityRules = []
  const rawVisibility = raw.rules?.visibility
  if (rawVisibility !== undefined) {
    if (!Array.isArray(rawVisibility)) {
      emit('rules.visibility.shape', {})
    } else {
      for (const rawRule of rawVisibility) {
        if (!takeRuleBudget('visibility')) break
        if (!isPlainObject(rawRule)) {
          emit('rules.visibility.invalid', {})
          continue
        }
        const ruleId =
          typeof rawRule.id === 'string' && rawRule.id !== ''
            ? rawRule.id
            : undefined
        if (!ruleId) {
          emit('visibility.id', {})
          continue
        }

        const target = rawRule.target
        if (typeof target !== 'string' || target === '') {
          emit('visibility.target.invalid', { ruleId })
          continue
        }
        const targetDef = fieldsById.get(target)
        if (!targetDef) {
          emit('visibility.target.unknown', { ruleId, target })
          forcedHidden.add(target)
          continue
        }
        if (templateFieldIds.has(target)) {
          const groupId = templateFieldIds.get(target)
          emit('visibility.templateTarget', {
            ruleId,
            fieldId: target,
            groupId,
          })
          forcedHidden.add(groupId)
          const group = fieldsById.get(groupId)
          if (group) group.forcedHidden = true
          continue
        }

        const group = groupContext(
          rawRule.group,
          'visibility.group',
          ruleId,
        )
        if (!group.ok) {
          // A rule we cannot scope is not trusted: hide its target.
          forcedHidden.add(target)
          targetDef.forcedHidden = true
          continue
        }

        const condition = validateCondition(
          rawRule.when,
          conditionOptions(group.scopePrefix),
        )
        if (!condition.ok) {
          forwardConditionIssues(condition.issues, {
            ruleId,
            fieldId: target,
          })
          forcedHidden.add(target)
          targetDef.forcedHidden = true
          continue
        }

        visibilityRules.push({
          id: ruleId,
          target,
          when: condition.condition,
          dependsOn: condition.dependsOn,
          ...(rawRule.group !== undefined ? { group: rawRule.group } : {}),
        })
      }
    }
  }

  const cascadeRules = []
  const rawCascades = raw.rules?.cascades
  if (rawCascades !== undefined) {
    if (!Array.isArray(rawCascades)) {
      emit('rules.cascades.shape', {})
    } else {
      for (const rawRule of rawCascades) {
        if (!takeRuleBudget('cascade')) break
        if (!isPlainObject(rawRule)) {
          emit('rules.cascades.invalid', {})
          continue
        }
        const ruleId =
          typeof rawRule.id === 'string' && rawRule.id !== ''
            ? rawRule.id
            : undefined
        if (!ruleId) {
          emit('cascade.id', {})
          continue
        }

        const group = groupContext(rawRule.group, 'cascade.group', ruleId)
        if (!group.ok) continue

        const condition = validateCondition(
          rawRule.when,
          conditionOptions(group.scopePrefix),
        )
        if (!condition.ok) {
          forwardConditionIssues(condition.issues, { ruleId })
          continue
        }

        if (!Array.isArray(rawRule.then) || rawRule.then.length === 0) {
          emit('cascade.then', { ruleId })
          continue
        }

        const dependsOn = []
        const seenDeps = new Set()
        const addDep = (segments) => {
          const key = pathKey(segments)
          if (seenDeps.has(key)) return
          seenDeps.add(key)
          dependsOn.push(segments)
        }
        for (const path of condition.dependsOn) addDep(path)

        const effects = []
        let invalid = false

        for (const rawEffect of rawRule.then) {
          if (!isPlainObject(rawEffect)) {
            emit('cascade.effect.invalid', { ruleId })
            invalid = true
            break
          }

          const kind = rawEffect.kind
          if (kind !== 'set' && kind !== 'fetch') {
            emit('cascade.effect.unknown', { ruleId, kind })
            invalid = true
            break
          }

          const target = resolveTarget(rawEffect.target, group.scopePrefix)
          if (target.status === 'container') {
            emit('cascade.target.container', { ruleId })
            invalid = true
            break
          }
          if (target.status !== 'leaf') {
            emit('cascade.target.unknown', { ruleId })
            invalid = true
            break
          }

          if (kind === 'set' && !hasOwn(rawEffect, 'value')) {
            emit('cascade.effect.value', { ruleId })
            invalid = true
            break
          }

          let source
          let params
          if (kind === 'fetch') {
            source = rawEffect.source
            if (typeof source !== 'string' || source === '') {
              emit('cascade.source.invalid', { ruleId })
              invalid = true
              break
            }

            if (sources !== undefined) {
              const hasSource =
                sources instanceof Map
                  ? sources.has(source)
                  : typeof sources === 'object' &&
                    sources !== null &&
                    Object.hasOwn(sources, source)
              if (!hasSource) {
                emit('cascade.source.missing', { ruleId, source })
                invalid = true
                break
              }
            }

            if (
              rawEffect.params !== undefined &&
              !isPlainObject(rawEffect.params)
            ) {
              emit('cascade.params', { ruleId })
              invalid = true
              break
            }
            params = rawEffect.params ?? {}

            for (const [name, rawPath] of Object.entries(params)) {
              const resolved = resolveRulePath(rawPath, group.scopePrefix)
              if (!resolved) {
                emit('cascade.params', { ruleId, param: name })
                invalid = true
                break
              }
              addDep(resolved)
            }
            if (invalid) break
          }

          effects.push({
            ...rawEffect,
            kind,
            target: target.segments,
            targetKey: pathKey(target.segments),
            ...(kind === 'fetch' ? { source, params } : {}),
          })
        }

        if (invalid) continue

        cascadeRules.push({
          ...rawRule,
          id: ruleId,
          when: condition.condition,
          dependsOn,
          then: effects,
          ...(rawRule.group !== undefined ? { group: rawRule.group } : {}),
        })
      }
    }
  }

  const validations = []
  const rawValidations = raw.validations
  let validationCount = 0
  if (rawValidations !== undefined) {
    if (!Array.isArray(rawValidations)) {
      emit('validations.shape', {})
    } else {
      for (const rawRule of rawValidations) {
        if (validationCount >= MAX_RULES) {
          emit('document.validations.limit', { max: MAX_RULES })
          break
        }
        validationCount += 1

        if (!isPlainObject(rawRule)) {
          emit('validations.invalid', {})
          continue
        }
        const ruleId =
          typeof rawRule.id === 'string' && rawRule.id !== ''
            ? rawRule.id
            : undefined
        if (!ruleId) {
          emit('validation.id', {})
          continue
        }

        const group = groupContext(rawRule.group, 'validation.group', ruleId)
        if (!group.ok) continue

        const target = resolveTarget(rawRule.target, group.scopePrefix)
        if (target.status !== 'leaf') {
          emit('validation.target', { ruleId })
          continue
        }

        if (!Array.isArray(rawRule.dependsOn) || rawRule.dependsOn.length === 0) {
          emit('validation.dependsOn', { ruleId })
          continue
        }
        const dependsOn = []
        let invalid = false
        for (const rawPath of rawRule.dependsOn) {
          const resolved = resolveRulePath(rawPath, group.scopePrefix)
          if (!resolved) {
            emit('validation.dependsOn', { ruleId })
            invalid = true
            break
          }
          dependsOn.push(resolved)
        }
        if (invalid) continue

        const condition = validateCondition(
          rawRule.invalidWhen,
          conditionOptions(group.scopePrefix),
        )
        if (!condition.ok) {
          forwardConditionIssues(condition.issues, { ruleId })
          continue
        }

        if (
          typeof rawRule.message !== 'string' ||
          rawRule.message.trim() === ''
        ) {
          emit('validation.message', { ruleId })
          continue
        }

        validations.push({
          id: ruleId,
          target: target.segments,
          ...(rawRule.group !== undefined ? { group: rawRule.group } : {}),
          dependsOn,
          invalidWhen: condition.condition,
          message: rawRule.message,
        })
      }
    }
  }

  const document = {
    id: raw.id,
    version: raw.version,
    fields,
    fieldsById,
    permissionKeyByField,
    bindings,
    templateBindings,
    rules: {
      visibility: visibilityRules,
      cascades: cascadeRules,
    },
    validations,
    forcedHidden,
    issues,
  }

  return { ok: true, document, issues }
}
