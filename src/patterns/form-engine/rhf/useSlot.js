import { useController } from 'react-hook-form'
import { toName } from '../engine/paths.js'
import { createIssue } from '../engine/issues.js'
import { useFormEngine } from './useFormEngine.js'

const isEvent = (value) =>
  typeof Event !== 'undefined' && value instanceof Event

const domId = (segments) =>
  `fe-${segments.join('-').replace(/[^A-Za-z0-9_-]/g, '-')}`

/**
 * The only place RHF field names appear in a renderer. It takes values, never
 * events: renderers unwrap `event.target.value` first. `writeSlots` is the only
 * write path, so cascades and validation scheduling see every change.
 *
 * @param {string[]} segments
 * @param {object} slotConfig
 */
export function useSlot(segments, slotConfig) {
  const { control, writeSlots, record } = useFormEngine()
  const name = toName(segments)
  const { field, fieldState } = useController({ control, name })

  return {
    id: domId(segments),
    name,
    value: field.value,
    onChange: (next) => {
      if (import.meta.env?.DEV && isEvent(next)) {
        record(
          createIssue('slot.event', 'warning', {
            message: 'A renderer passed a DOM Event to useSlot.onChange.',
          }),
        )
      }
      writeSlots([{ path: segments, value: slotConfig.normalize(next) }])
    },
    onBlur: field.onBlur,
    // A function accessor rather than `field.ref` directly: the repo's
    // react-hooks/refs lint rule treats an object literal containing a ref value
    // as ref-like and then flags every property read on the slot adapter. The
    // accessor preserves the adapter contract (`slot.ref()` returns RHF's
    // callback ref) without that false positive.
    ref: () => field.ref,
    error: fieldState.error?.message,
    invalid: Boolean(fieldState.error),
    isTouched: fieldState.isTouched,
    required: slotConfig.required,
    disabled: slotConfig.disabled,
    describedBy: slotConfig.helpId,
  }
}
