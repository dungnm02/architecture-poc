import { useMemo, useState } from 'react'
import { parseDocument } from './engine/document.js'
import { DOCUMENT, PERMISSION_SETS, createSaveEntity } from './fixtures/demo.js'
import { ENTITY } from './fixtures/documents.js'
import { SOURCES } from './fixtures/sources.js'
import FormHost from './rhf/FormHost.jsx'
import './form-engine.css'

export default function FormEngineDemo() {
  const parsed = useMemo(
    () => parseDocument(DOCUMENT, { sources: SOURCES }),
    [],
  )
  // The save mock is per demo instance so its "fail next" flag resets when the
  // whole demo remounts. It is local and deterministic; no network.
  const saveEntity = useMemo(() => createSaveEntity(), [])
  const [permissionSetId, setPermissionSetId] = useState(PERMISSION_SETS[0].id)
  const [permissionsRev, setPermissionsRev] = useState(0)

  const selected =
    PERMISSION_SETS.find((set) => set.id === permissionSetId) ??
    PERMISSION_SETS[0]

  const onPermissionChange = (event) => {
    setPermissionSetId(event.target.value)
    setPermissionsRev((revision) => revision + 1)
  }

  if (!parsed.ok) {
    return (
      <div className="fe-demo">
        <h2 className="fe-demo-title">Config-driven form engine</h2>
        <div className="fe-panel fe-panel-error" role="alert">
          <p>The fixture document could not be parsed. No partial form is shown.</p>
          <ul>
            {parsed.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <code>{issue.code}</code>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  const doc = parsed.document

  return (
    <div className="fe-demo">
      <header className="fe-demo-header">
        <h2 className="fe-demo-title">Config-driven form engine</h2>
        <p className="fe-muted">
          One document + entity seeded into React Hook Form. Field mode is
          permission → visibility → ancestor → form mode; every write goes
          through <code>writeSlots</code>, and renderers never see RHF names.
        </p>
      </header>

      <div className="fe-toolbar">
        <label className="fe-label" htmlFor="fe-permission-set">
          Permission set
        </label>
        <select
          id="fe-permission-set"
          className="fe-select"
          value={permissionSetId}
          onChange={onPermissionChange}
        >
          {PERMISSION_SETS.map((set) => (
            <option key={set.id} value={set.id}>
              {set.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="fe-button"
          onClick={() => saveEntity.setFailNext(true)}
          title="The next save returns a path-level server error"
        >
          Simulate server 422
        </button>
        <span className="fe-muted">
          Remount key: {doc.id}@{String(doc.version)}:{permissionsRev}
        </span>
      </div>

      {parsed.issues.length > 0 ? (
        <div className="fe-panel" role="status">
          <p>Document issues</p>
          <ul>
            {parsed.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <code>{issue.code}</code> ({issue.severity})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FormHost
        key={`${doc.id}@${doc.version}:${permissionsRev}`}
        document={doc}
        entity={ENTITY}
        permissions={selected.permissions}
        permissionRev={permissionsRev}
        sources={SOURCES}
        saveEntity={saveEntity}
        initialMode="EDIT"
      />

      <section className="fe-panel fe-notes">
        <h3 className="fe-form-title">What this pattern shows</h3>
        <ul>
          <li>
            <code>FormHost</code> seeds every bound path and mounts one{' '}
            <code>FieldHost</code> per field, including hidden ones.
          </li>
          <li>
            <code>useSlot</code> is the only RHF name boundary; Text and Date
            unwrap DOM events before writing.
          </li>
          <li>
            Switching to Viewer remounts the form and renders read-only views.
          </li>
          <li>
            Set Country to <code>CA</code> or <code>GB</code>: one{' '}
            <code>writeSlots</code> pass sets Currency to CAD/GBP.
          </li>
          <li>
            The same write fetches Policy code from the in-module{' '}
            <code>policyCode</code> source after a per-target 300 ms debounce.
            Only the declared <code>country</code> param is sent; the demo makes
            no network requests.
          </li>
          <li>
            Set Country to <code>XX</code> to hide Notes. The host stays mounted
            and the value survives.
          </li>
          <li>
            Start date and End date are optional Date slots in the same{' '}
            <code>properties.policy</code> container. The cross-field rule runs
            after AJV, outside the JSON Schema: with a start date set, clearing
            End date surfaces{' '}
            <code>End date is required when a start date is set</code> beneath
            the field; restoring it clears the error. Both date slots use a
            fixture pattern that also accepts the empty value, because the
            closed fragment vocabulary has no <code>anyOf</code>.
          </li>
          <li>
            Participants is a repeat group. Rows are keyed by{' '}
            <code>__key</code>, never by the data <code>id</code>; add, remove
            and move each bump the cascade epoch and schedule one validation.
            Removing every row surfaces the group <code>minItems</code> error
            above the rows.
          </li>
          <li>
            Submit is one locked pipeline. EDIT validates values, then complex
            fields, then waits for cascades before saving; VIEW saves the
            current values without validation. A country of <code>ZZ</code> or
            the <code>Simulate server 422</code> button maps a path-level server
            error back through <code>setError</code>.
          </li>
          <li>
            Attachment is a complex stub. It registers a form-level handle,
            validates separately from submit, and never writes RHF values. Type{' '}
            <code>bad</code> to fail complex validation; its note also makes the
            form dirty.
          </li>
          <li>
            Edit / View toggles the form mode. Switching to VIEW while dirty asks
            for confirmation first, then discards drafts, cancels validation,
            bumps the cascade epoch, clears errors and restores focus to the
            heading.
          </li>
          <li>
            The repo has no DOM test runner. Rendering is covered by a Vite SSR
            smoke test; render counts per keystroke, the async race, mode-toggle
            cancel, hidden-value survival, <code>{'{ target: x }'}</code>{' '}
            round-trip and accessibility checks are a manual checklist in{' '}
            <code>README.md</code> <em>(Manual checks)</em> in this folder.
          </li>
        </ul>
      </section>
    </div>
  )
}
