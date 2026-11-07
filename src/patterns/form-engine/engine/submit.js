/**
 * The submit pipeline is locked and ordered. It is pure over a small FormApi
 * port, so it has no React or RHF imports.
 *
 * EDIT: validate values, validate complex fields, settle cascades, save.
 * VIEW: save the current data unchanged. VIEW never triggers validation and
 * never touches complex handles; the requirement is that a read-only form can
 * still be saved with existing errors present.
 */

const DEFAULT_SERVER_MESSAGE = 'The server rejected this value.'

const newIdempotencyKey = () => globalThis.crypto.randomUUID()

/**
 * Apply a 422-style error list. Empty, missing or invalid paths go to the root
 * banner; every entry produces exactly one `setError` call so an error is never
 * silently dropped.
 *
 * @param {{ setError: (path: string, error: { type: string, message: string }) => void }} form
 * @param {Array<{ path?: unknown, message?: unknown }>} errors
 */
export function applyServerErrors(form, errors) {
  if (!Array.isArray(errors)) return

  for (const error of errors) {
    const rawPath = error?.path
    const path =
      typeof rawPath === 'string' && rawPath.trim() !== ''
        ? rawPath.trim()
        : 'root'
    const message =
      typeof error?.message === 'string' && error.message.trim() !== ''
        ? error.message
        : DEFAULT_SERVER_MESSAGE

    form.setError(path, { type: 'server', message })
  }
}

/**
 * @param {{
 *   form: { getValues: Function, trigger: Function, reset: Function, setError: Function },
 *   engine: { ctx: Function, cascades: { bumpEpoch: Function }, settleCascades: Function },
 *   complex: { values: () => Array<object> },
 *   saveEntity: (payload: object, options: { idempotencyKey: string }) => Promise<object>,
 *   doc: { version: unknown },
 * }} options
 */
export function createSubmit({ form, engine, complex, saveEntity, doc }) {
  let inFlight = false
  let idempotencyKey = newIdempotencyKey()

  return async function submit() {
    if (inFlight) return { ok: false, stage: 'busy' }

    inFlight = true
    try {
      // Submit invalidates every pending cascade landing. A fetch that lands
      // after this point must not write over the values being saved.
      engine.cascades.bumpEpoch()

      const mode = engine.ctx().formMode

      if (mode === 'EDIT') {
        if (!(await form.trigger(undefined, { shouldFocus: true }))) {
          return { ok: false, stage: 'validation' }
        }

        const handles = complex?.values?.() ?? []
        const complexErrors = (
          await Promise.all(handles.map((handle) => handle.validate()))
        ).flat()

        if (complexErrors.length > 0) {
          return { ok: false, stage: 'complex-validation', errors: complexErrors }
        }

        if (!(await engine.settleCascades(3000))) {
          return { ok: false, stage: 'cascade-timeout' }
        }
      }

      // structuredClone protects the payload from RHF mutation while the save
      // adapter is in flight.
      const values = structuredClone(form.getValues())
      const entity = await saveEntity(
        { ...values, documentVersion: doc.version },
        { idempotencyKey },
      )

      if (entity.ok === false) {
        applyServerErrors(form, entity.errors)
        return { ok: false, stage: 'entity', entity }
      }

      let complexResults = []
      if (mode === 'EDIT') {
        const handles = complex?.values?.() ?? []
        complexResults = await Promise.allSettled(
          handles.map((handle) => handle.submit(entity.value)),
        )
      }

      // The saved entity becomes the new dirty baseline. This also clears
      // isDirty after a successful save. A partial complex failure does not
      // roll back the entity, so the baseline still moves.
      form.reset(structuredClone(entity.value ?? values))
      idempotencyKey = newIdempotencyKey()

      return {
        ok: complexResults.every(
          (result) => result.status === 'fulfilled' && result.value?.ok === true,
        ),
        entity,
        complex: complexResults,
      }
    } catch (error) {
      return { ok: false, stage: 'exception', error }
    } finally {
      inFlight = false
    }
  }
}
