import { useSlot } from '../../rhf/useSlot.js'
import { useSlotValue } from '../../rhf/useSlotValue.js'
import { useFormEngine } from '../../rhf/useFormEngine.js'
import { slotSegments } from '../../rhf/slotPaths.js'

const describedByFor = (def, valueSlot, naSlot) => {
  const ids = []
  if (def.help) ids.push(valueSlot.describedBy)
  if (valueSlot.invalid) ids.push(`${valueSlot.id}-error`)
  if (naSlot.invalid) ids.push(`${naSlot.id}-error`)
  return ids.filter(Boolean).join(' ') || undefined
}

/**
 * Two slots, one atomic write. The value change clears N/A and the N/A change
 * clears the value, so no cascade can ever observe `{ value: 'old', isNA: true }`.
 */
export default function InputWithNA({ def, scope }) {
  const { writeSlots } = useFormEngine()
  const valueSegments = slotSegments(def, 'value', scope)
  const isNASegments = slotSegments(def, 'isNA', scope)
  const valueSlot = useSlot(valueSegments, def.slots.value)
  const isNASlot = useSlot(isNASegments, def.slots.isNA)
  const describedBy = describedByFor(def, valueSlot, isNASlot)

  const writeBoth = (nextValue, nextIsNA) => {
    writeSlots([
      {
        path: valueSegments,
        value: def.slots.value.normalize(nextValue),
      },
      {
        path: isNASegments,
        value: def.slots.isNA.normalize(nextIsNA),
      },
    ])
  }

  return (
    <div className="fe-field">
      <label className="fe-label" htmlFor={valueSlot.id}>
        {def.label}
        {valueSlot.required ? <span className="fe-required"> *</span> : null}
      </label>
      <div className="fe-row">
        <input
          className="fe-input"
          id={valueSlot.id}
          name={valueSlot.name}
          type="text"
          value={valueSlot.value ?? ''}
          disabled={valueSlot.disabled || Boolean(isNASlot.value)}
          required={valueSlot.required}
          aria-invalid={valueSlot.invalid || undefined}
          aria-describedby={describedBy}
          ref={valueSlot.ref()}
          onChange={(event) => writeBoth(event.target.value, false)}
          onBlur={valueSlot.onBlur}
        />
        <label className="fe-checkbox" htmlFor={isNASlot.id}>
          <input
            id={isNASlot.id}
            name={isNASlot.name}
            type="checkbox"
            checked={Boolean(isNASlot.value)}
            disabled={isNASlot.disabled}
            aria-invalid={isNASlot.invalid || undefined}
            aria-describedby={describedBy}
            ref={isNASlot.ref()}
            onChange={(event) => writeBoth('', event.target.checked)}
            onBlur={isNASlot.onBlur}
          />
          N/A
        </label>
      </div>
      {def.help ? (
        <p className="fe-help" id={valueSlot.describedBy}>
          {def.help}
        </p>
      ) : null}
      {valueSlot.invalid ? (
        <p className="fe-error" id={`${valueSlot.id}-error`}>
          {valueSlot.error}
        </p>
      ) : null}
      {isNASlot.invalid ? (
        <p className="fe-error" id={`${isNASlot.id}-error`}>
          {isNASlot.error}
        </p>
      ) : null}
    </div>
  )
}

export function InputWithNAView({ def, scope }) {
  const valueSegments = slotSegments(def, 'value', scope)
  const isNASegments = slotSegments(def, 'isNA', scope)
  const value = useSlotValue(valueSegments)
  const isNA = useSlotValue(isNASegments)
  const shown =
    isNA || value === null || value === undefined || value === ''
      ? 'N/A'
      : String(value)

  return (
    <div className="fe-field fe-view">
      <span className="fe-label">{def.label}</span>
      <span className="fe-value">{shown}</span>
    </div>
  )
}
