import { useEffect } from 'react'
import { useFieldArray } from 'react-hook-form'
import { toName } from '../../engine/paths.js'
import { newItem, scopeFor, validateItemKey } from '../../engine/repeat.js'
import BlockBoundary from '../../rhf/BlockBoundary.jsx'
import FieldHost from '../../rhf/FieldHost.jsx'
import { useArrayError } from '../../rhf/useArrayError.js'
import { useFormEngine } from '../../rhf/useFormEngine.js'

/**
 * Repeat group. Rows are addressed by index at the RHF boundary, but React
 * identity is always `field.__key` from `useFieldArray`: a data `id` is visible
 * in the row values and is never used as the React key. `update()` would
 * remount a row, so the controls use `move()` for reordering.
 *
 * Every array operation bumps the cascade epoch (aborting in-flight work for
 * all rows) and schedules exactly one validation pass.
 */
export default function RepeatGroup({ def, mode }) {
  const { control, engine, record, scheduleValidate } = useFormEngine()
  const groupSegments = def.binding.value.segments
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: toName(groupSegments),
    keyName: '__key',
  })
  const groupError = useArrayError(groupSegments)

  // Diagnostics are an effect, not render: recording state during render would
  // re-render the host on every pass. One pass per rows change.
  useEffect(() => {
    for (const issue of validateItemKey(def, fields)) record(issue)
  }, [def, fields, record])

  const afterArrayChange = () => {
    engine.cascades.bumpEpoch()
    scheduleValidate()
  }

  const addRow = () => {
    append(newItem(def), { shouldFocus: false })
    afterArrayChange()
  }

  const removeRow = (index) => {
    // Always pass the index: v7's no-argument remove() clears every row.
    remove(index)
    afterArrayChange()
  }

  const moveRow = (from, to) => {
    move(from, to)
    afterArrayChange()
  }

  const addLabel = def.props?.addLabel ?? `Add ${def.label.toLowerCase()}`

  return (
    <section className="fe-repeat" aria-label={def.label}>
      <div className="fe-repeat-header">
        <div>
          <span className="fe-label">{def.label}</span>
          <span className="fe-muted">
            {' '}
            · {fields.length} {fields.length === 1 ? 'row' : 'rows'}
          </span>
        </div>
        {mode === 'EDIT' ? (
          <button type="button" className="fe-button" onClick={addRow}>
            {addLabel}
          </button>
        ) : null}
      </div>

      {groupError ? (
        <p className="fe-error fe-repeat-error" role="alert">
          {groupError}
        </p>
      ) : null}

      {fields.length === 0 ? (
        <p className="fe-muted">No rows yet.</p>
      ) : (
        <ol className="fe-repeat-rows">
          {fields.map((row, index) => {
            const rowScope = scopeFor(def, index, row, mode)
            return (
              <li className="fe-repeat-row" key={row.__key}>
                <div className="fe-repeat-row-header">
                  <span className="fe-muted">#{index + 1}</span>
                  {mode === 'EDIT' ? (
                    <div className="fe-repeat-controls">
                      <button
                        type="button"
                        className="fe-button"
                        onClick={() => moveRow(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`Move ${def.label} row ${index + 1} up`}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className="fe-button"
                        onClick={() => moveRow(index, index + 1)}
                        disabled={index === fields.length - 1}
                        aria-label={`Move ${def.label} row ${index + 1} down`}
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        className="fe-button fe-button-danger"
                        onClick={() => removeRow(index)}
                        aria-label={`Remove ${def.label} row ${index + 1}`}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="fe-repeat-fields">
                  {def.template.map((child) => (
                    <BlockBoundary key={child.id} label={child.label}>
                      <FieldHost def={child} scope={rowScope} />
                    </BlockBoundary>
                  ))}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/**
 * VIEW rows are read-only through the same FieldHost path; the group mode is
 * folded into each row's ancestorMode. No append/remove/move controls mount.
 */
export function RepeatGroupView({ def, mode }) {
  const { control } = useFormEngine()
  const groupSegments = def.binding.value.segments
  const { fields } = useFieldArray({
    control,
    name: toName(groupSegments),
    keyName: '__key',
  })
  const groupError = useArrayError(groupSegments)

  return (
    <section className="fe-repeat fe-view" aria-label={def.label}>
      <div className="fe-repeat-header">
        <span className="fe-label">{def.label}</span>
      </div>

      {groupError ? (
        <p className="fe-error fe-repeat-error" role="alert">
          {groupError}
        </p>
      ) : null}

      {fields.length === 0 ? (
        <p className="fe-muted">No rows.</p>
      ) : (
        <ol className="fe-repeat-rows">
          {fields.map((row, index) => {
            const rowScope = scopeFor(def, index, row, mode ?? 'VIEW')
            return (
              <li className="fe-repeat-row" key={row.__key}>
                <div className="fe-repeat-row-header">
                  <span className="fe-muted">#{index + 1}</span>
                </div>
                <div className="fe-repeat-fields">
                  {def.template.map((child) => (
                    <BlockBoundary key={child.id} label={child.label}>
                      <FieldHost def={child} scope={rowScope} />
                    </BlockBoundary>
                  ))}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
