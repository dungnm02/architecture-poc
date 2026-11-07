import { useState } from 'react'
import { useFormEngine } from './useFormEngine.js'

/**
 * Reads the ref-backed render counter only on demand. Subscribing to it or
 * writing it through state on every render would defeat the measurement.
 */
export default function RenderCounter() {
  const { renderCounts } = useFormEngine()
  const [snapshot, setSnapshot] = useState([])

  const read = () => {
    const entries = [...renderCounts.current.entries()]
    entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    setSnapshot(entries)
  }

  const reset = () => {
    renderCounts.current.clear()
    setSnapshot([])
  }

  return (
    <div className="fe-render-counter">
      <button type="button" onClick={read}>
        Read render counts
      </button>
      <button type="button" onClick={reset}>
        Reset
      </button>
      {snapshot.length > 0 ? (
        <ul className="fe-render-list">
          {snapshot.map(([fieldId, count]) => (
            <li key={fieldId}>
              <code>{fieldId}</code> {count}
            </li>
          ))}
        </ul>
      ) : (
        <span className="fe-muted">Counts are read on demand.</span>
      )}
    </div>
  )
}
