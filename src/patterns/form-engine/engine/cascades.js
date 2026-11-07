import { evaluate } from './conditions.js'
import { createIssue } from './issues.js'
import {
  INDEX,
  pathKey,
  pathMatchesTemplate,
  pathStartsWith,
} from './paths.js'
import { slotValueMatches } from '../registry/index.js'

/**
 * Cascades are declarative value effects triggered by a write. They are indexed
 * once per document, execute in one pass after `writeSlots`, and never chain: a
 * cascade write is a raw `setValue`, not another `writeSlots` call.
 */

const DEFAULT_DEBOUNCE_MS = 300

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toSegments = (rawPath) => {
  if (Array.isArray(rawPath)) {
    return rawPath.every((segment) => typeof segment === 'string')
      ? [...rawPath]
      : null
  }
  if (typeof rawPath === 'string' && rawPath !== '') return rawPath.split('.')
  return null
}

function readValue(values, segments, itemIndex) {
  let current = values
  for (const segment of segments) {
    const key = segment === '*' ? itemIndex : segment
    if (key === undefined || key === null) return undefined
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}

/**
 * Index every cascade rule under every path its condition (or declared params)
 * reads. Template dependencies keep their `*` so a concrete write can match
 * them. A rule with several dependencies appears under each key.
 *
 * @param {object} document
 * @returns {Map<string, Array<{ rule: object, itemIndex: number|null }>>}
 */
export function buildCascadeIndex(document) {
  const index = new Map()
  const rules = document?.rules?.cascades

  if (!Array.isArray(rules)) return index

  for (const rule of rules) {
    if (!rule || !Array.isArray(rule.dependsOn)) continue
    for (const dependency of rule.dependsOn) {
      if (!Array.isArray(dependency) || dependency.length === 0) continue
      const key = pathKey(dependency)
      const entries = index.get(key) ?? []
      if (!entries.some((entry) => entry.rule === rule)) {
        entries.push({ rule, itemIndex: null })
        index.set(key, entries)
      }
    }
  }

  return index
}

/**
 * Exact dependencies match directly; entries with `*` match one array index.
 *
 * @param {Map<string, Array<object>>} index
 * @param {string[]} sourceSegments
 * @returns {Array<{ rule: object, itemIndex: number|null }>}
 */
export function matchCascadeRules(index, sourceSegments) {
  if (!(index instanceof Map) || !Array.isArray(sourceSegments)) return []

  const matches = []
  const add = (entries) => {
    for (const entry of entries ?? []) {
      if (!matches.includes(entry)) matches.push(entry)
    }
  }

  add(index.get(pathKey(sourceSegments)))

  for (const [key, entries] of index) {
    if (!key.includes('*')) continue
    if (pathMatchesTemplate(key.split('/'), sourceSegments)) add(entries)
  }

  return matches
}

/**
 * Cascade freshness state. `pending` holds the latest run per target, `timers`
 * holds the debounce handles, and `tasks` lets submit wait for landings.
 */
export function createCascadeState() {
  const state = {
    epoch: 0,
    runId: 0,
    pending: new Map(),
    tasks: new Set(),
    timers: new Map(),
    bumpEpoch() {
      state.epoch += 1
      state.abortAll()
      return state.epoch
    },
    nextRunId() {
      state.runId += 1
      return state.runId
    },
    abortTarget(key) {
      const timer = state.timers.get(key)
      if (timer !== undefined) {
        state.timers.delete(key)
        try {
          clearTimeout(timer)
        } catch {
          // A test-injected timer may not be a real handle.
        }
      }

      const run = state.pending.get(key)
      if (!run) return

      state.pending.delete(key)
      try {
        run.controller?.abort?.()
      } catch {
        // Abort is best effort; the pending delete already invalidates the run.
      }
      run.settle?.()
    },
    abortAll() {
      for (const [key, timer] of [...state.timers]) {
        state.timers.delete(key)
        try {
          clearTimeout(timer)
        } catch {
          // Ignore non-standard timer handles.
        }
      }

      const runs = [...state.pending.values()]
      state.pending.clear()
      for (const run of runs) {
        try {
          run.controller?.abort?.()
        } catch {
          // Ignore abort failures; clearing pending is the authority.
        }
        run.settle?.()
      }
    },
  }

  return state
}

/**
 * Substitute the source row index into `*`. Returns null when a wildcard has no
 * index, so callers skip instead of writing to a literal `*` key.
 *
 * @param {string[]} segments
 * @param {number|string|null|undefined} itemIndex
 * @returns {string[]|null}
 */
export function resolveTarget(segments, itemIndex) {
  if (!Array.isArray(segments)) return null

  let unresolved = false
  const resolved = segments.map((segment) => {
    if (segment !== '*') return segment
    if (itemIndex === null || itemIndex === undefined) {
      unresolved = true
      return segment
    }
    return String(itemIndex)
  })

  return unresolved ? null : resolved
}

/**
 * Build the source payload from the effect's declared params only. A parameter
 * value is a path; anything else in the form never leaves the client.
 *
 * @param {Record<string, string|string[]>} params
 * @param {unknown} values
 * @param {number|null} itemIndex
 */
export function buildParams(params, values, itemIndex) {
  const result = {}
  if (!isPlainObject(params)) return result

  for (const [name, rawPath] of Object.entries(params)) {
    const segments = toSegments(rawPath)
    result[name] = segments ? readValue(values, segments, itemIndex) : undefined
  }

  return result
}

/**
 * Find bound slots at an exact path, or under a repeat group's template path.
 * The caller uses this for EDIT checks and target slot-type validation.
 *
 * @param {object} document
 * @param {string[]} segments
 * @returns {Array<{ fieldId: string, slotName: string, type: string|null }>}
 */
export function collectBindingsAtSegments(document, segments) {
  const result = []
  if (!document || !Array.isArray(segments) || segments.length === 0) {
    return result
  }

  const seen = new Set()
  const add = (entries) => {
    for (const entry of entries ?? []) {
      if (!entry || typeof entry.fieldId !== 'string') continue
      const key = `${entry.fieldId}/${entry.slotName}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        fieldId: entry.fieldId,
        slotName: entry.slotName,
        type: entry.def?.slots?.[entry.slotName]?.type ?? null,
      })
    }
  }

  add(document.bindings?.get?.(pathKey(segments)))

  const groups = Array.isArray(document.fields) ? document.fields : []
  for (const group of groups) {
    if (!group?.isRepeat) continue
    const groupSegments = group.binding?.value?.segments
    if (!Array.isArray(groupSegments) || groupSegments.length === 0) continue
    if (segments.length <= groupSegments.length) continue

    if (!pathStartsWith(groupSegments, segments)) continue
    const indexSegment = segments[groupSegments.length]
    if (indexSegment !== '*' && !INDEX.test(indexSegment)) continue

    const relative = segments.slice(groupSegments.length + 1)
    if (relative.length === 0) continue

    const entries = document.templateBindings?.get?.(pathKey(relative))
    add((entries ?? []).filter((entry) => entry.groupId === group.id))
  }

  return result
}

function resolveItemIndex(rule, sourceSegments, document) {
  if (!rule || rule.group === undefined || rule.group === null) return null

  const group = document?.fieldsById?.get?.(rule.group)
  const groupSegments = group?.binding?.value?.segments
  if (!Array.isArray(groupSegments) || groupSegments.length === 0) return null
  if (!pathStartsWith(groupSegments, sourceSegments)) return null

  const indexSegment = sourceSegments[groupSegments.length]
  if (typeof indexSegment !== 'string' || !INDEX.test(indexSegment)) return null

  return Number(indexSegment)
}

function lookupSource(sources, id) {
  if (!sources) return undefined
  if (sources instanceof Map) return sources.get(id)
  if (typeof sources === 'object' && Object.hasOwn(sources, id)) {
    return sources[id]
  }
  return undefined
}

function recordIssue(api, issue) {
  if (typeof api.record === 'function') api.record(issue)
}

function recordException(api, rule, error) {
  if (error?.name === 'AbortError') return
  recordIssue(
    api,
    createIssue('cascade.exception', 'warning', {
      ruleId: rule?.id,
      message: error instanceof Error ? error.message : String(error),
    }),
  )
}

/**
 * Resolve group-relative param paths to absolute template paths before reading
 * the values. Absolute paths are left alone.
 */
function resolveParamPaths(params, rule, document) {
  const resolved = {}
  if (!isPlainObject(params)) return resolved

  const groupSegments =
    rule?.group !== undefined && rule?.group !== null
      ? document?.fieldsById?.get?.(rule.group)?.binding?.value?.segments
      : null

  for (const [name, rawPath] of Object.entries(params)) {
    const segments = toSegments(rawPath)
    if (!segments) {
      resolved[name] = []
      continue
    }

    const absolute =
      Boolean(document?.bindings?.has?.(pathKey(segments))) ||
      (Array.isArray(groupSegments) && pathStartsWith(groupSegments, segments))

    if (absolute || !Array.isArray(groupSegments)) {
      resolved[name] = segments
    } else {
      resolved[name] = [...groupSegments, '*', ...segments]
    }
  }

  return resolved
}

function applySet(rule, effect, context) {
  const { api, itemIndex, state } = context
  const target = resolveTarget(effect.target, itemIndex)
  if (!target) {
    recordException(api, rule, new Error('Unresolved cascade target'))
    return null
  }

  // A write owns the target: any in-flight fetch for it is now stale.
  state.abortTarget(pathKey(target))

  if (typeof api.isEditable !== 'function' || !api.isEditable(target)) {
    recordIssue(
      api,
      createIssue('cascade.target.readonly', 'warning', {
        ruleId: rule?.id,
        target: pathKey(target),
      }),
    )
    return null
  }

  if (typeof api.setValue === 'function') {
    api.setValue(target, effect.value, { schedule: false })
  }
  return null
}

async function executeFetch({
  rule,
  effect,
  target,
  key,
  run,
  api,
  state,
  source,
  itemIndex,
  controller,
}) {
  try {
    if (state.pending.get(key) !== run) return
    if (run.epoch !== state.epoch) return
    if (controller.signal.aborted) return

    const group =
      rule?.group !== undefined && rule?.group !== null
        ? api.document?.fieldsById?.get?.(rule.group)
        : null
    const itemKeyName = group?.itemKey
    const groupSegments = group?.binding?.value?.segments ?? []

    const before = api.getValues()

    const params = buildParams(
      resolveParamPaths(effect.params, rule, api.document),
      before,
      itemIndex,
    )
    const result = await source(params, { signal: controller.signal })

    const values = api.getValues()

    // All of these must hold at landing: latest run for the target, epoch
    // unchanged, signal live, target still bound and EDIT, condition still true,
    // and a value of the target slot's type.
    if (state.pending.get(key) !== run) return
    if (run.epoch !== state.epoch) return
    if (controller.signal.aborted) return

    let landingIndex = itemIndex
    let landingTarget = target

    if (itemKeyName && itemIndex !== null) {
      if (run.itemKey === undefined || run.itemKey === null) return
      const rows = readValue(values, groupSegments, null)
      if (!Array.isArray(rows)) return
      const nextIndex = rows.findIndex(
        (row) => row && row[itemKeyName] === run.itemKey,
      )
      if (nextIndex < 0) return
      landingIndex = nextIndex
      landingTarget = resolveTarget(effect.target, nextIndex)
      if (!landingTarget) return

      const landingKey = pathKey(landingTarget)
      if (
        landingKey !== key &&
        state.pending.has(landingKey) &&
        state.pending.get(landingKey) !== run
      ) {
        return
      }
    }

    if (typeof api.isEditable !== 'function' || !api.isEditable(landingTarget)) {
      return
    }
    if (rule.when && !evaluate(rule.when, values, { itemIndex: landingIndex })) {
      return
    }

    const slotType =
      typeof api.getSlotType === 'function'
        ? api.getSlotType(landingTarget)
        : null
    if (!slotValueMatches(slotType, result)) return

    if (typeof api.setValue === 'function') {
      api.setValue(landingTarget, result, { schedule: true })
    }
  } catch (error) {
    recordException(api, rule, error)
  } finally {
    if (state.pending.get(key) === run) state.pending.delete(key)
    run.settle?.()
  }
}

function applyFetch(rule, effect, context) {
  const { api, itemIndex, state } = context
  const target = resolveTarget(effect.target, itemIndex)
  if (!target) {
    recordException(api, rule, new Error('Unresolved cascade target'))
    return null
  }

  const key = pathKey(target)
  state.abortTarget(key)

  const source = lookupSource(api.sources, effect.source)
  if (typeof source !== 'function') {
    recordIssue(
      api,
      createIssue('cascade.source.missing', 'blocking', {
        ruleId: rule?.id,
        source: effect.source,
      }),
    )
    return null
  }

  const controller = new AbortController()
  const epoch = state.epoch
  const runId = state.nextRunId()
  const run = {
    epoch,
    runId,
    ruleId: rule?.id,
    targetKey: key,
    itemKey: undefined,
    sourceValue: undefined,
    controller,
  }

  // Item identity is captured when the run is scheduled, before the debounce.
  const group =
    rule?.group !== undefined && rule?.group !== null
      ? api.document?.fieldsById?.get?.(rule.group)
      : null
  if (group?.itemKey && itemIndex !== null) {
    const groupSegments = group.binding?.value?.segments ?? []
    run.itemKey = readValue(
      api.getValues(),
      [...groupSegments, String(itemIndex), group.itemKey],
      null,
    )
  }

  let resolveTask
  const task = new Promise((resolve) => {
    resolveTask = resolve
  })
  run.settle = resolveTask
  state.tasks.add(task)
  task.then(
    () => state.tasks.delete(task),
    () => state.tasks.delete(task),
  )
  state.pending.set(key, run)

  const delay = typeof api.delay === 'function' ? api.delay : setTimeout
  const debounceMs = Number.isFinite(api.debounceMs)
    ? api.debounceMs
    : DEFAULT_DEBOUNCE_MS

  let started = false
  let timer
  timer = delay(() => {
    started = true
    if (state.timers.get(key) === timer) state.timers.delete(key)
    executeFetch({
      rule,
      effect,
      target,
      key,
      run,
      api,
      state,
      source,
      itemIndex,
      controller,
    })
  }, debounceMs)

  // A synchronous test delay has already run and settled the task.
  if (!started) state.timers.set(key, timer)

  return task
}

function applyEffect(rule, effect, context) {
  switch (effect?.kind) {
    case 'set':
      return applySet(rule, effect, context)
    case 'fetch':
      return applyFetch(rule, effect, context)
    default:
      recordIssue(
        context.api,
        createIssue('effect.unknown', 'blocking', {
          ruleId: rule?.id,
          kind: effect?.kind,
        }),
      )
      return null
  }
}

function normaliseSources(sourceSegmentsOrList) {
  if (!Array.isArray(sourceSegmentsOrList)) return []
  if (sourceSegmentsOrList.length === 0) return []
  return Array.isArray(sourceSegmentsOrList[0])
    ? sourceSegmentsOrList
    : [sourceSegmentsOrList]
}

/**
 * One cascade pass for one write or a batch of write paths. Set effects run in
 * this pass; fetch effects debounce per target and land only after their
 * freshness checks. A failing rule never stops the others.
 *
 * @param {string[]|string[][]} sourceSegmentsOrList
 * @param {object} api
 * @returns {Promise<void>}
 */
export async function runCascades(sourceSegmentsOrList, api) {
  if (!api || typeof api.getValues !== 'function') return

  const sources = normaliseSources(sourceSegmentsOrList)
  if (sources.length === 0) return

  const state = api.state ?? createCascadeState()
  const index = api.cascadeIndex ?? buildCascadeIndex(api.document)
  const seenRules = new Set()
  const tasks = []

  for (const sourceSegments of sources) {
    if (!Array.isArray(sourceSegments)) continue

    const matches = matchCascadeRules(index, sourceSegments)
    for (const match of matches) {
      const rule = match?.rule
      if (!rule) continue
      const ruleKey = rule.id ?? rule
      if (seenRules.has(ruleKey)) continue
      seenRules.add(ruleKey)

      try {
        const itemIndex = resolveItemIndex(rule, sourceSegments, api.document)
        const values = api.getValues()
        if (rule.when && !evaluate(rule.when, values, { itemIndex })) continue

        for (const effect of rule.then ?? []) {
          try {
            const task = applyEffect(rule, effect, {
              api,
              state,
              itemIndex,
              sourceSegments,
            })
            if (task) tasks.push(task)
          } catch (error) {
            recordException(api, rule, error)
          }
        }
      } catch (error) {
        recordException(api, rule, error)
      }
    }
  }

  if (tasks.length > 0) await Promise.allSettled(tasks)
}
