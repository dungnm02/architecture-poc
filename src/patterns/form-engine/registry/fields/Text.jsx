import { useSlot } from '../../rhf/useSlot.js'
import { useSlotValue } from '../../rhf/useSlotValue.js'
import { slotSegments } from '../../rhf/slotPaths.js'

const describedByFor = (def, slot) => {
  const ids = []
  if (def.help) ids.push(slot.describedBy)
  if (slot.invalid) ids.push(`${slot.id}-error`)
  return ids.filter(Boolean).join(' ') || undefined
}

export default function Text({ def, scope }) {
  const segments = slotSegments(def, 'value', scope)
  const slot = useSlot(segments, def.slots.value)
  const describedBy = describedByFor(def, slot)

  return (
    <div className="fe-field">
      <label className="fe-label" htmlFor={slot.id}>
        {def.label}
        {slot.required ? <span className="fe-required"> *</span> : null}
      </label>
      <input
        className="fe-input"
        id={slot.id}
        name={slot.name}
        type="text"
        value={slot.value ?? ''}
        disabled={slot.disabled}
        required={slot.required}
        aria-invalid={slot.invalid || undefined}
        aria-describedby={describedBy}
        ref={slot.ref()}
        onChange={(event) => slot.onChange(event.target.value)}
        onBlur={slot.onBlur}
      />
      {def.help ? (
        <p className="fe-help" id={slot.describedBy}>
          {def.help}
        </p>
      ) : null}
      {slot.invalid ? (
        <p className="fe-error" id={`${slot.id}-error`}>
          {slot.error}
        </p>
      ) : null}
    </div>
  )
}

export function TextView({ def, scope }) {
  const segments = slotSegments(def, 'value', scope)
  const value = useSlotValue(segments)
  const shown = value === null || value === undefined || value === ''
    ? '—'
    : String(value)

  return (
    <div className="fe-field fe-view">
      <span className="fe-label">{def.label}</span>
      <span className="fe-value">{shown}</span>
    </div>
  )
}
