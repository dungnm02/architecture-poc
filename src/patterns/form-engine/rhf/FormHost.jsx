import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useForm, useFormState } from 'react-hook-form'
import {
  buildCascadeIndex,
  collectBindingsAtSegments,
  runCascades,
} from '../engine/cascades.js'
import { createComplexRegistry } from '../engine/complex.js'
import { createEngine } from '../engine/engine.js'
import { createIssue, blockingIssues, hasBlocking } from '../engine/issues.js'
import {
  computeModes,
  normalizePermissions,
  planModeChange,
} from '../engine/modes.js'
import { pathKey, toName } from '../engine/paths.js'
import { createSubmit } from '../engine/submit.js'
import { seedBoundPaths } from '../engine/seed.js'
import { createResolver, signature } from '../engine/validation.js'
import { buildVisibilityIndex, isHidden } from '../engine/visibility.js'
import BlockBoundary from './BlockBoundary.jsx'
import FieldHost from './FieldHost.jsx'
import RenderCounter from './RenderCounter.jsx'
import { FormEngineContext } from './useFormEngine.js'

const EMPTY_SOURCES = new Map()

const errorText = (error) =>
  error instanceof Error ? error.message : String(error)

const defaultWarnUnsavedChanges = () => {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm('Discard unsaved changes and switch to VIEW?')
  }
  return true
}

/**
 * FormHost owns the only `useForm` instance, the engine composition root and the
 * provider value. It intentionally reads only `isDirty` from form state and a
 * scoped `root` subscription for the banner.
 */
export default function FormHost({
  document,
  entity,
  permissions,
  permissionRev = 0,
  sources = EMPTY_SOURCES,
  saveEntity,
  initialMode = 'EDIT',
  warnUnsavedChanges = defaultWarnUnsavedChanges,
}) {
  const [runtimeIssues, setRuntimeIssues] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [modeAnnouncement, setModeAnnouncement] = useState('')
  const headingRef = useRef(null)

  const record = useCallback((issue) => {
    setRuntimeIssues((current) => [...current, issue])
  }, [])

  // `permissionRev` is part of the contract even though the payload itself is
  // memoised: the caller bumps it when the permission set changes.
  const permissionState = useMemo(
    () => ({
      // The revision is part of the memo value so a caller can force a fresh
      // normalisation without changing the permissions object identity.
      revision: permissionRev,
      ...normalizePermissions(permissions),
    }),
    [permissions, permissionRev],
  )

  // Never mutate `document.issues`; combine it with permission and runtime
  // issues in a separate, memoised list.
  const issues = useMemo(
    () => [
      ...(document.issues ?? []),
      ...permissionState.issues,
      ...runtimeIssues,
    ],
    [document, permissionState, runtimeIssues],
  )

  const blocking = blockingIssues(issues)
  const blocked = hasBlocking(issues)

  const visibilityIndex = useMemo(
    () => buildVisibilityIndex(document),
    [document],
  )
  const cascadeIndex = useMemo(() => buildCascadeIndex(document), [document])

  const [mode, setMode] = useState(() =>
    initialMode === 'VIEW' ? 'VIEW' : 'EDIT',
  )
  const modeRef = useRef(mode)

  // Form-level complex registry. It survives a renderer's EDIT/VIEW swap
  // because ComplexStub is the same component in both mode slots.
  const complex = useMemo(() => createComplexRegistry(), [])

  // Refs are for event handlers, not render. The live mode is `mode` above; the
  // ref mirror is written after commit for M6's synchronous toggle handler.
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  // The submit pipeline must call the latest saveEntity prop without being
  // recreated (the idempotency key lives inside createSubmit). The ref is only
  // read from the submit handler, never during render.
  const saveEntityRef = useRef(saveEntity)
  useEffect(() => {
    saveEntityRef.current = saveEntity
  }, [saveEntity])

  const renderCounts = useRef(new Map())
  const noteRender = useCallback((fieldId) => {
    const counts = renderCounts.current
    counts.set(fieldId, (counts.get(fieldId) ?? 0) + 1)
  }, [])

  const engine = useMemo(
    () => createEngine({ document, record, sources }),
    [document, record, sources],
  )

  // Read live permissions, mode and visibility on every resolver/mode call.
  // Replacing the provider each render keeps it in step with the memoised maps
  // without putting non-serialisable state into RHF.
  engine.setContextProvider(() => ({
    permissions: permissionState.permissions,
    permissionKeyByField: document.permissionKeyByField,
    formMode: mode,
    visibility: (fieldId, getValues) =>
      isHidden(fieldId, getValues, {
        index: visibilityIndex,
        forcedHidden: document.forcedHidden,
      }),
  }))

  const resolver = useMemo(() => createResolver(engine), [engine])
  const defaultValues = useMemo(
    () => seedBoundPaths(document, structuredClone(entity ?? {})),
    [document, entity],
  )

  const form = useForm({
    defaultValues,
    shouldUnregister: false,
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
    criteriaMode: 'firstError',
    resolver,
  })

  // Only isDirty is read from formState. The ref exists so M6's mode toggle can
  // consult a synchronous value from an event handler.
  const { isDirty } = form.formState
  const isDirtyRef = useRef(isDirty)
  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  const rootState = useFormState({ control: form.control, name: 'root' })
  const rootMessage = rootState.errors?.root?.message

  // One locked submit pipeline per form. It is created lazily in the submit
  // handler so the render pass never touches the saveEntity ref; a new prop
  // identity is picked up on the next save without resetting the key.
  const submitRef = useRef(null)
  const getSubmit = useCallback(() => {
    if (!submitRef.current) {
      submitRef.current = createSubmit({
        form,
        engine,
        complex,
        saveEntity: (...args) => saveEntityRef.current(...args),
        doc: document,
      })
    }
    return submitRef.current
  }, [form, engine, complex, document])

  const onSubmit = useCallback(async () => {
    if (submitting || blocked) return

    setSubmitting(true)
    setSubmitResult(null)

    try {
      setSubmitResult(await getSubmit()())
    } catch (error) {
      // The pipeline catches its own exceptions; this protects the button from
      // an adapter bug leaving it stuck in the submitting state.
      setSubmitResult({ ok: false, stage: 'exception', error })
    } finally {
      setSubmitting(false)
    }
  }, [getSubmit, submitting, blocked])

  const timerRef = useRef(null)
  const lastSignatureRef = useRef(null)

  const cancelValidation = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // The toggle handler never trusts a stale closure for dirty/mode state. The
  // planner owns the warning/reset decision so it can be tested without React.
  const requestMode = useCallback(
    (next) => {
      const plan = planModeChange({
        next,
        mode: modeRef.current,
        dirty: isDirtyRef.current,
        complexDirty: complex.isDirty(),
        warn: warnUnsavedChanges,
      })

      if (!plan.apply) return

      // `defaultValues` is the only baseline: the last saved entity, or the
      // original entity until the first save. Dropping drafts returns to it.
      if (plan.reset) form.reset()

      modeRef.current = next
      cancelValidation()
      engine.cascades.bumpEpoch()
      engine.cascades.abortAll?.()
      form.clearErrors()
      setMode(next)
      setModeAnnouncement(`Form mode changed to ${next}.`)

      // Restore focus to the form heading (tabIndex -1) after the mode change.
      headingRef.current?.focus?.()
    },
    [cancelValidation, complex, engine, form, warnUnsavedChanges],
  )

  const runValidation = useCallback(() => {
    try {
      const result = form.trigger()
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          record(
            createIssue('validation.trigger', 'warning', {
              message: errorText(error),
            }),
          )
        })
      }
    } catch (error) {
      record(
        createIssue('validation.trigger', 'warning', {
          message: errorText(error),
        }),
      )
    }
  }, [form, record])

  const scheduleValidate = useCallback(() => {
    let signatureChanged = false

    try {
      const values = form.getValues()
      const modes = computeModes(document, values, engine.ctx())
      const nextSignature = signature(document, modes)
      signatureChanged =
        lastSignatureRef.current !== null &&
        nextSignature !== lastSignatureRef.current
      lastSignatureRef.current = nextSignature
    } catch (error) {
      // Scheduling is not allowed to surface an exception into React.
      record(
        createIssue('validation.schedule', 'warning', {
          message: errorText(error),
        }),
      )
    }

    cancelValidation()

    if (signatureChanged) {
      runValidation()
      return
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      runValidation()
    }, 400)
  }, [form, engine, document, cancelValidation, runValidation, record])

  // Cascade effects read live values when they run and write through this raw
  // port. It deliberately has no `writeSlots`: a cascade write must never start
  // a second cascade pass.
  const cascadeApi = useMemo(
    () => ({
      state: engine.cascades,
      sources: engine.ctx().sources,
      document,
      cascadeIndex,
      getValues: () => form.getValues(),
      setValue(segments, value, opts) {
        form.setValue(toName(segments), value, { shouldDirty: true })
        if (opts?.schedule) scheduleValidate()
      },
      isEditable(segments) {
        const values = form.getValues()
        const modes = computeModes(document, values, engine.ctx())
        const entries = collectBindingsAtSegments(document, segments)
        return (
          entries.length > 0 &&
          entries.every((entry) => modes.get(entry.fieldId) === 'EDIT')
        )
      },
      getSlotType(segments) {
        return collectBindingsAtSegments(document, segments)[0]?.type ?? null
      },
      record,
      debounceMs: 300,
    }),
    [engine, document, cascadeIndex, form, scheduleValidate, record],
  )

  const writeSlots = useCallback(
    (writes) => {
      const list = writes ?? []
      for (const write of list) {
        // No `{ target }` wrapping and no event sniffing: setValue stores the
        // value verbatim, so data shaped `{ target: ... }` round-trips.
        form.setValue(toName(write.path), write.value, { shouldDirty: true })
      }

      // A user write owns its path: any in-flight fetch aimed there is stale.
      const paths = list.map((write) => write.path)
      for (const path of paths) {
        engine.cascades.abortTarget(pathKey(path))
      }

      if (paths.length > 0) {
        try {
          const task = runCascades(paths, cascadeApi)
          if (task && typeof task.catch === 'function') {
            task.catch((error) => {
              record(
                createIssue('cascade.exception', 'warning', {
                  message: errorText(error),
                }),
              )
            })
          }
        } catch (error) {
          record(
            createIssue('cascade.exception', 'warning', {
              message: errorText(error),
            }),
          )
        }
      }

      // One cascade pass has been scheduled, then one validation schedule. The
      // fetch landing schedules validation when it writes.
      scheduleValidate()
    },
    [form, engine, cascadeApi, scheduleValidate, record],
  )

  useEffect(
    () => () => {
      cancelValidation()
      engine.cascades.bumpEpoch()
    },
    [cancelValidation, engine],
  )

  const contextValue = useMemo(
    () => ({
      form,
      control: form.control,
      document,
      engine,
      complex,
      mode,
      modeRef,
      permissions: permissionState.permissions,
      permissionKeyByField: document.permissionKeyByField,
      visibilityIndex,
      writeSlots,
      scheduleValidate,
      cancelValidation,
      record,
      renderCounts,
      noteRender,
      issues,
    }),
    [
      form,
      document,
      engine,
      complex,
      mode,
      modeRef,
      permissionState.permissions,
      visibilityIndex,
      writeSlots,
      scheduleValidate,
      cancelValidation,
      record,
      renderCounts,
      noteRender,
      issues,
    ],
  )

  const contextLabel = document.id
  const contextVersion = document.version
  const showBanner = Boolean(rootMessage) || blocking.length > 0

  return (
    <FormEngineContext.Provider value={contextValue}>
      <BlockBoundary
        label="form"
        onError={(error) =>
          record(
            createIssue('render.form', 'warning', { message: errorText(error) }),
          )
        }
      >
        <section className="fe-form" aria-label={`${contextLabel} form`}>
          <header className="fe-form-header">
            <h3 className="fe-form-title" ref={headingRef} tabIndex={-1}>
              {contextLabel}{' '}
              <span className="fe-muted">v{String(contextVersion)}</span>
            </h3>
            <p className="fe-muted">
              Seeded from the fixture entity and rendered through FormHost.
            </p>
            <p className="fe-announce" role="status" aria-live="polite">
              {modeAnnouncement}
            </p>
          </header>

          {showBanner ? (
            <div className="fe-banner" role="alert">
              {rootMessage ? <p>{rootMessage}</p> : null}
              {blocking.length > 0 ? (
                <>
                  <p>The form is blocked by configuration issues.</p>
                  <ul>
                    {blocking.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>
                        <code>{issue.code}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="fe-form-actions">
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting || blocked}
              aria-busy={submitting || undefined}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>

            <div className="fe-mode-toggle" role="group" aria-label="Form mode">
              <button
                type="button"
                className="fe-button"
                aria-pressed={mode === 'EDIT'}
                onClick={() => requestMode('EDIT')}
              >
                Edit
              </button>
              <button
                type="button"
                className="fe-button"
                aria-pressed={mode === 'VIEW'}
                onClick={() => requestMode('VIEW')}
              >
                View
              </button>
            </div>

            <span className="fe-muted">
              {mode} · {isDirty ? 'dirty' : 'clean'}
              {blocked ? ' · configuration blocked' : ''}
            </span>
            <RenderCounter />
          </div>

          {submitResult ? (
            <div
              className={`fe-panel fe-submit-result ${
                submitResult.ok ? 'fe-submit-ok' : 'fe-submit-error'
              }`}
              role="status"
            >
              <p>
                <strong>
                  Submit {submitResult.ok ? 'succeeded' : 'failed'}
                </strong>
                {submitResult.stage
                  ? ` · stage: ${submitResult.stage}`
                  : ' · stage: saved'}
              </p>

              {submitResult.stage === 'complex-validation' &&
              Array.isArray(submitResult.errors) ? (
                <ul>
                  {submitResult.errors.map((error, index) => (
                    <li key={`${error.fieldId}-${index}`}>
                      {error.fieldId}: {error.message}
                    </li>
                  ))}
                </ul>
              ) : null}

              {submitResult.stage === 'entity' &&
              Array.isArray(submitResult.entity?.errors) ? (
                <ul>
                  {submitResult.entity.errors.map((error, index) => (
                    <li key={`${String(error?.path)}-${index}`}>
                      <code>{error?.path || 'root'}</code>: {error?.message}
                    </li>
                  ))}
                </ul>
              ) : null}

              {submitResult.stage === 'exception' ? (
                <p className="fe-error">{errorText(submitResult.error)}</p>
              ) : null}

              {Array.isArray(submitResult.complex) &&
              submitResult.complex.length > 0 ? (
                <ul>
                  {submitResult.complex.map((entry, index) => (
                    <li key={index}>
                      {entry.status === 'fulfilled'
                        ? entry.value?.ok
                          ? 'Complex field saved.'
                          : 'Complex field rejected.'
                        : `Complex field error: ${errorText(entry.reason)}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <form
            className="fe-fields"
            noValidate
            onSubmit={(event) => event.preventDefault()}
          >
            {document.fields.map((def) => (
              <BlockBoundary key={def.id} label={def.label}>
                <FieldHost def={def} scope={null} />
              </BlockBoundary>
            ))}
          </form>
        </section>
      </BlockBoundary>
    </FormEngineContext.Provider>
  )
}
