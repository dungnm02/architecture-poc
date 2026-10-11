import { useEffect, useState } from 'react'
import { Provider } from 'react-redux'
import { store } from './store'
import { assetApi } from './api'
import { useRelatedAssets } from './useRelatedAssets'
import { getCallLog, seed, setFailRelations } from './mock-backend'

// Declared once and never changed between renders (invariant 7).
// Deliberately out of dependency order: LICENSE requires ATTACHMENT, the core re-orders them.
const TYPES = ['REMARK', 'LICENSE', 'COMMENT_HISTORY', 'ATTACHMENT']

const SUBJECTS = [
  { id: 'dataset-1', label: 'dataset-1 (full set)' },
  { id: 'model-1', label: 'model-1 (remark only)' },
]

// colours come from the global CSS vars in src/index.css so dark mode still reads
const box = { border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }

export default function RelatedAssetsDemo() {
  const [subjectId, setSubjectId] = useState(SUBJECTS[0].id)
  const [seedVersion, setSeedVersion] = useState(0)
  const [failWrites, setFailWrites] = useState(false)

  const onFailChange = (checked) => {
    setFailWrites(checked)
    setFailRelations(checked)
  }
  const onReseed = () => {
    seed() // also clears failRelations in the mock
    setFailWrites(false)
    store.dispatch(assetApi.util.resetApiState())
    setSeedVersion((version) => version + 1)
  }

  return (
    <Provider store={store}>
      <div style={{ padding: 16, maxWidth: 900, margin: '0 auto', textAlign: 'left' }}>
        <h1 style={{ fontSize: 22 }}>Related-asset fetching — PoC</h1>
        <p>
          The subject declares four supporting-asset types and gets four controllers. ATTACHMENT is
          read-only. LICENSE <code>requires</code> ATTACHMENT and reads it from <code>deps</code>.
        </p>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <label>
            Subject{' '}
            <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              {SUBJECTS.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={failWrites} onChange={(event) => onFailChange(event.target.checked)} />{' '}
            fail relation writes (test rollback)
          </label>
          <button onClick={onReseed}>Reseed data</button>
        </div>

        {/* remount on subject/reseed change so drafts never leak */}
        <Screen key={`${subjectId}-${seedVersion}`} subjectId={subjectId} />

        <CallLog />
      </div>
    </Provider>
  )
}

function Screen({ subjectId }) {
  const { REMARK, COMMENT_HISTORY, ATTACHMENT, LICENSE } = useRelatedAssets(subjectId, TYPES)

  return (
    <>
      <SinglePanel title="REMARK — single (1..1)" controller={REMARK} submitLabel="Save remark" />
      <ManyPanel title="COMMENT_HISTORY — many (1..n)" controller={COMMENT_HISTORY} />
      <ReadonlyPanel title="ATTACHMENT — readonly" controller={ATTACHMENT} />
      <SinglePanel title="LICENSE — single, requires ATTACHMENT" controller={LICENSE} submitLabel="Save license" />
    </>
  )
}

function SinglePanel({ title, controller, submitLabel }) {
  const { value, setValue, isDirty, save, reset, saving, error, blockedReason } = controller

  return (
    <section style={box}>
      <PanelTitle title={title} />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <Row>
        <button onClick={save} disabled={!isDirty || saving || Boolean(blockedReason)}>
          {submitLabel}
        </button>
        <button onClick={reset} disabled={!isDirty || saving}>
          Reset
        </button>
        <Status isDirty={isDirty} saving={saving} error={error} note={blockedReason} />
      </Row>
    </section>
  )
}

function ManyPanel({ title, controller }) {
  const { items, add, update, remove, isDirty, save, saving, error } = controller

  return (
    <section style={box}>
      <PanelTitle title={title} />
      {items.map((item, index) => (
        <Row key={item.id ?? `new-${index}`}>
          <input
            value={item.text ?? ''}
            placeholder="Write a comment…"
            onChange={(event) => update(index, event.target.value)}
            style={{ flex: 1 }}
          />
          <button onClick={() => remove(index)}>Remove</button>
        </Row>
      ))}
      <Row>
        <button onClick={add}>Add</button>
        <button onClick={save} disabled={!isDirty || saving}>
          Save list
        </button>
        <Status isDirty={isDirty} saving={saving} error={error} />
      </Row>
    </section>
  )
}

function ReadonlyPanel({ title, controller }) {
  const { data, refetch, isLoading, error } = controller

  return (
    <section style={box}>
      <PanelTitle title={title} />
      {isLoading && <p>loading…</p>}
      <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
        {data.map((row) => (
          <li key={row.id}>{row.name ?? row.id}</li>
        ))}
      </ul>
      <Row>
        <button onClick={() => refetch()}>Refetch</button>
        {error && <span style={{ color: '#ef4444' }}>{String(error.error ?? error)}</span>}
      </Row>
    </section>
  )
}

function PanelTitle({ title }) {
  return <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{title}</h3>
}

function Status({ isDirty, saving, error, note }) {
  return (
    <span>
      {isDirty ? 'dirty' : 'clean'}
      {saving && ' · saving…'}
      {note && <span style={{ color: '#ef4444' }}> · {note}</span>}
      {error && <span style={{ color: '#ef4444' }}> · {error}</span>}
    </span>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>{children}</div>
}

function CallLog() {
  const [entries, setEntries] = useState(() => [...getCallLog()])

  useEffect(() => {
    const timer = setInterval(() => setEntries([...getCallLog()]), 400)
    return () => clearInterval(timer)
  }, [])

  return (
    <section style={box}>
      <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Backend calls (two-phase read / write + rollback)</h3>
      <pre
        style={{
          margin: 0,
          background: '#12161a',
          color: '#8ef7a0',
          padding: 8,
          maxHeight: 220,
          overflow: 'auto',
          fontSize: 12,
        }}
      >
        {entries.map((entry, index) => (
          <div key={index}>{JSON.stringify(entry)}</div>
        ))}
      </pre>
    </section>
  )
}
