import { useMemo, useRef, useState } from 'react'
import { useComplexHandle } from '../../rhf/useComplexHandle.js'

/**
 * The demo's complex-field contract. It is not a real rich-text or file field:
 * it proves that a handle can validate, submit and report dirty state without
 * writing into RHF values.
 *
 * `validate()` and `submit(entity)` are deliberately separate. `submit` never
 * validates. VIEW renders the same component read-only, so the handle stays
 * registered when the form mode flips.
 */
export default function ComplexStub({ def, mode }) {
  const [note, setNote] = useState('')
  const [lastSubmitted, setLastSubmitted] = useState('')
  const noteRef = useRef('')
  const savedRef = useRef('')

  const handle = useMemo(
    () => ({
      validate: async () => {
        if (noteRef.current !== 'bad') return []
        return [
          {
            fieldId: def.id,
            message: `${def.label} note cannot be "bad".`,
          },
        ]
      },
      submit: async (entity) => {
        // Record the submitted note and move the dirty baseline. No form value
        // is written: complex data is not in RHF values in v1.
        savedRef.current = noteRef.current
        setLastSubmitted(noteRef.current)
        return { ok: true, entityId: entity?.id }
      },
      isDirty: () => noteRef.current !== savedRef.current,
    }),
    [def.id, def.label],
  )

  useComplexHandle(def.id, handle)

  const inputId = `fe-complex-${def.id}`
  const helpId = `${inputId}-help`
  const readOnly = mode === 'VIEW'
  const shown = note === '' ? '—' : note

  const onChange = (event) => {
    noteRef.current = event.target.value
    setNote(event.target.value)
  }

  return (
    <div className={`fe-field fe-complex${readOnly ? ' fe-view' : ''}`}>
      <label className="fe-label" htmlFor={readOnly ? undefined : inputId}>
        {def.label}
      </label>

      {readOnly ? (
        <span className="fe-value">{shown}</span>
      ) : (
        <input
          className="fe-input"
          id={inputId}
          name={inputId}
          type="text"
          value={note}
          aria-describedby={helpId}
          onChange={onChange}
        />
      )}

      <p className="fe-help" id={helpId}>
        {def.help ??
          'Complex stub: not part of form values. Type "bad" to fail complex validation.'}
      </p>

      {readOnly && lastSubmitted !== '' ? (
        <p className="fe-muted">Submitted note: {lastSubmitted}</p>
      ) : null}
    </div>
  )
}
