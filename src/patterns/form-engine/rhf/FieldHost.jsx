import { useEffect, useMemo, useRef, useState } from 'react'
import { useWatch } from 'react-hook-form'
import { createIssue } from '../engine/issues.js'
import { resolveMode } from '../engine/modes.js'
import { getAtSegments, toName } from '../engine/paths.js'
import { slotValueMatches } from '../registry/index.js'
import { renderers } from '../registry/renderers.js'
import { watchedPaths } from '../engine/visibility.js'
import { useFormEngine } from './useFormEngine.js'
import { slotSegments } from './slotPaths.js'

function DegradedField({ def, reason }) {
  return (
    <div className="fe-field fe-degraded" role="note">
      <span className="fe-label">{def.label}</span>
      <span className="fe-degraded-note">{reason}</span>
    </div>
  )
}

/**
 * Template children bind relative segments, so a type check must resolve the
 * row scope first. `getAtSegments` keeps a removed row from throwing.
 */
function scopedSlotMismatches(def, values, scope) {
  const mismatches = []

  for (const [slotName, binding] of Object.entries(def?.binding ?? {})) {
    const slot = def?.slots?.[slotName]
    if (!slot || !Array.isArray(binding?.segments)) continue

    const actual = getAtSegments(values, slotSegments(def, slotName, scope))
    if (!slotValueMatches(slot.type, actual)) {
      mismatches.push({
        fieldId: def.id,
        slotName,
        expected: slot.type,
        actual,
      })
    }
  }

  return mismatches
}

/**
 * One host per field, always mounted, including HIDDEN fields. Hiding returns
 * null *inside* the component so visibility subscriptions stay live and the
 * field can reappear without remounting.
 *
 * Mode is resolved on every render from live RHF values; the field subscribes
 * only to the union of its visibility dependencies.
 */
export default function FieldHost({ def, scope = null }) {
  const {
    control,
    document,
    engine,
    form,
    noteRender,
    record,
    visibilityIndex,
  } = useFormEngine()

  const dependencyNames = useMemo(
    () =>
      watchedPaths(def.id, visibilityIndex).map((segments) => toName(segments)),
    [def.id, visibilityIndex],
  )

  // Stable hook call: disabled when there are no dependencies. The returned
  // values are intentionally unused; the subscription itself triggers the
  // re-render that re-evaluates the mode.
  useWatch({
    control,
    name: dependencyNames,
    disabled: dependencyNames.length === 0,
  })

  const mode = resolveMode(def, () => form.getValues(), scope, engine.ctx())

  // Once per field instance, which is once per document version because the
  // host remounts on document/permission changes. A repeat row keeps its
  // instance across move/reorder; the initial scope is the right snapshot for
  // this guard. `useState`'s lazy initialiser keeps the scope out of a memo
  // dependency list that would otherwise re-run on every parent render.
  const [mismatchState] = useState(() => ({
    version: document.version,
    mismatches: scopedSlotMismatches(def, form.getValues(), scope),
  }))
  const mismatches = mismatchState.mismatches

  const recordedRef = useRef(false)
  useEffect(() => {
    if (mismatches.length === 0 || recordedRef.current) return
    recordedRef.current = true
    record(
      createIssue('field.slot.type', 'warning', {
        fieldId: def.id,
        mismatches,
      }),
    )
  }, [mismatches, record, def.id])

  // Ref-backed counter; never state, so counting renders cannot loop.
  useEffect(() => {
    noteRender(def.id)
  })

  if (mode === 'HIDDEN') return null

  if (def.unknownType) {
    return <DegradedField def={def} reason="Unknown field type." />
  }

  if (mismatches.length > 0) {
    const slots = mismatches.map((mismatch) => mismatch.slotName).join(', ')
    return <DegradedField def={def} reason={`Type mismatch: ${slots}.`} />
  }

  const entry = renderers.get(def.type)
  if (!entry) {
    return <DegradedField def={def} reason="No renderer registered." />
  }

  const Component = entry[mode] ?? entry.VIEW
  return <Component def={def} scope={scope} mode={mode} />
}
