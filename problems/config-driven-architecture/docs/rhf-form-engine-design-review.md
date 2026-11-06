# RHF Form Engine Design - Deep Review

**Review note**
Status: resolved 2026-11-07 — see
[rhf-form-engine-design.md §0](rhf-form-engine-design.md#0-review-resolution)
Reviewed: [rhf-form-engine-design.md](rhf-form-engine-design.md)
Companion: [problem-form-engine.md](problem-form-engine.md),
[form-library-evaluation.md](form-library-evaluation.md)
Last updated: 2026-11-06
Revision: merged review; replaces the earlier RHF-API-only pass

Verified against RHF v7 docs and source (useForm, useController, useWatch,
useFieldArray, watch, getValues, reset, setValue, trigger, formState), RHF
changelog and issues, AJV 8, JSON Schema draft-07, and the repo itself
(`package.json`, `README.md`, `src/patterns/`).

**Verdict: architecture right, contract not ready. 14 blockers. Four can leak
or destroy data: mode resolution, validation projection, cascade payload,
submit. Do not start the spike until those four are fixed.**

---

## 0. Corrections to the previous revision of this review

The earlier pass mixed valid RHF API facts with a stale read of the design.
Three findings no longer apply and one safety claim was wrong.

- **`stripInternal` / `__rid` stripping is gone.** The design now says the
  render key lives in `fields`, not values. Correct. Do not strip anything.
- **Pointing `keyName` at the backend id is gone.** The current text says use
  `__key` or the hook key. Correct. The remaining bug is the key expression,
  not the storage (blocker 7).
- **`__rid` inside validated values is moot.** It never enters `getValues()`.
- **"`trigger()` with no args is safe because nothing subscribes to whole
  errors" is false.** RHF docs say `trigger()` with no arguments re-renders the
  entire form state, and `useController` reads errors through
  `fieldState.error`. Every field re-renders on each debounced validation until
  measured otherwise (blocker 14).

Findings 1, 3, 5, 6, 7, 8, 9, 10, 12-24 from the earlier pass still hold and
are folded in below.

---

## 1. Blockers

### 1. Mode resolution is a privilege escalation

Current order returns `VIEW` before the permission check:

```ts
if (ctx.formMode === 'VIEW') return 'VIEW'
const grant = ctx.permissions[fieldId]
if (!grant) return 'HIDDEN'
```

Four defects:

1. **Form VIEW promotes missing permission and hidden fields to VIEW.** A field
   with no grant renders read-only when the form switches to VIEW. That is a
   data leak and contradicts "hidden beats view beats edit".
2. **Any truthy grant becomes EDIT.** `'HIDDEN'`, `'NONE'`, `true`, a typo:
   all fall through `grant === 'VIEW' ? 'VIEW' : 'EDIT'`. Default deny is gone.
3. **Plain-object lookup hits the prototype.** `permissions['constructor']`
   returns a function. Field id `constructor` becomes EDIT. Same bug in
   `registry[def.type]`: `registry['toString']` returns a function and
   `Entry.Edit` is undefined.
4. **`permissionKey` is ignored.** The problem document has
   `fields[].permissionKey`; the design indexes `permissions[fieldId]`. If the
   permission payload uses `permissionKey`, every field is denied. If it uses
   field id, `permissionKey` is dead data.

Fix, permission first and allowlist only:

```ts
function resolveMode(fieldId: string, values: Values, ctx: ModeContext): Mode {
  const key = ctx.permissionKeyByField.get(fieldId) ?? fieldId
  const grant = ctx.permissions instanceof Map
    ? ctx.permissions.get(key)
    : Object.hasOwn(ctx.permissions, key) ? ctx.permissions[key] : undefined

  if (grant !== 'EDIT' && grant !== 'VIEW') return 'HIDDEN'
  if (isHidden(fieldId, values, ctx)) return 'HIDDEN'
  if (ctx.formMode === 'VIEW') return 'VIEW'
  return grant
}
```

Also:

- Use `Map` or null-prototype objects for permissions, registry, `pathToField`,
  and `fieldByPath`. Validate grant enums at document load.
- Reject field ids and paths containing `__proto__`, `constructor`,
  `prototype` at parse.
- Update `problem-form-engine.md` section 5, which also puts form VIEW first.

**Client-side permission is not authorization.** The design loads all entity
values into `defaultValues` and submits hidden values. A denied user can read
those values in the API response or the browser payload. If these grants are
security, the server must omit unauthorized values and enforce field-level
authorization. Say so in both docs, or stop calling it default-deny.

### 2. Validation validates values the schema excluded

`assembleSchema` includes only effective-EDIT fields, but the resolver
validates the full `values` object. False errors and silent passes follow:

- Hidden key `b` with a parent `additionalProperties: false` produces an error
  on `b`. No field can receive it. `trigger()` returns false, submit blocks,
  the user sees nothing.
- Same for VIEW values, unbound entity properties, and any client bookkeeping.
- Parent `propertyNames`, `patternProperties`, `dependentRequired`,
  `dependentSchemas` also react to excluded keys.
- A local fragment can read a hidden sibling through `if/then`. JSON Schema has
  no `dependsOn`; the design's claim that excluding hidden fields closes that
  hole is false.
- `required` at a parent path still requires a hidden child unless the
  assembler prunes it.

Fix: validate a projected clone containing only effective-EDIT bound paths and
their parent containers, then return the original values.

```ts
const { compiled, project, pathToField } = compiledFor(key, () =>
  assembleSchema(doc, values, ctx)
)
const candidate = project(values)              // EDIT paths + ancestors
if (compiled(candidate)) return { values, errors: {} }
```

Also:

- Prune every parent `required` array to EDIT fields only.
- A cross-field rule needs a **target** path, not only `dependsOn`. Include it
  only when the target and every dependency are EDIT. Otherwise an invisible
  field blocks submit.
- Restrict per-field fragments to their own binding and descendants. Forbid
  `if`/`then`/`else`, `$data`, `dependent*`, `propertyNames`,
  `additionalProperties`, `unevaluatedProperties`, and external `$ref`.
  Cross-path logic goes through `validations[]` with a restricted vocabulary.
- Send every unmappable error to `errors.root` and render a form-level banner.
  Never drop it.
- Test: hidden value plus closed parent schema; hidden `salary` read by a
  visible `bonus` fragment.

### 3. Cascade fetch exfiltrates the whole form

```ts
fetchSource(effect.source, { values, signal: controller.signal })
```

`values` is the entire form, including hidden and VIEW fields. `effect.source`
comes from the backend document. The accepted risk in the problem statement is
"the client can be pointed at arbitrary endpoints". It does not accept sending
all entity data to those endpoints. That is a data-exfiltration primitive
reachable by config.

Also unspecified: URL scheme, origin allowlist, credentials, method, headers,
CSRF, redirects, timeout, response status, content type, size, shape, PII in
query strings, and rate limiting. A text source fires one request per
keystroke.

Fix:

- `effect.source` is a **source id** resolved through a frontend registry, not
  a URL. If arbitrary URLs stay, allowlist origins and methods explicitly.
- Send only declared `params` paths. Never the whole form.
- `credentials: 'omit'`, `redirect: 'error'`, size cap, timeout,
  `response.ok`, content-type check, JSON parse guard.
- Validate result shape and slot type before `setValue`.
- Debounce remote sources or fire on blur.
- Surface failure in the field or a form-level banner; `record()` alone is
  invisible.

### 4. Async cascades have no freshness token, so they write stale data

The landing check only asks "is the target still EDIT". That is not enough:

- `country = US` starts a tax fetch; user switches to `CA`; both land; the US
  result is written because the target is still EDIT. `rule.when` is not
  re-evaluated.
- VIEW, reset, VIEW, EDIT round-trip: the target is EDIT again, so the
  pre-reset result is accepted.
- `items[0].price` fetch lands after `move(0, 1)`: the path now points at a
  different item.
- Submit captures values while a fetch is pending; the entity saves old data;
  the fetch lands after and writes new data. Payload and form disagree.
- `AbortController.abort()` does not stop a `.then()` that already has a
  resolved response. A request id is still required.
- `AbortError` is recorded as "cascade failed", polluting diagnostics on every
  normal abort.
- `runCascades` captures `values` once. Effect 1 can hide field B; effect 2
  still sees B as EDIT and writes.
- `cascadeIndex` is keyed by one source. A rule whose `when` reads three paths
  fires only when the keyed one changes. Fan it out under every dependency, or
  reject multi-source rules.
- Unknown effect kind falls into the fetch branch. That is fail-open.
- `setValue(..., undefined)` throws.

Fix: capture a run token and require all of it at landing.

```ts
type CascadeRun = {
  runId: number
  formEpoch: number
  documentVersion: string
  ruleId: string
  targetPath: string
  targetItemKey?: string
  sourceValue: unknown
  controller: AbortController
}
```

At landing check `runId` is still latest for the target, `formEpoch` is
current, the signal is not aborted, the target is EDIT, the item key still
matches, the source value and `rule.when` still hold. Bump the epoch on reset,
mode change, document change, array mutation, submit, and unmount. Abort on the
same events plus any write to the same target. Ignore `AbortError`. Re-read
`getValues()` per effect. Use an explicit `switch` with a closed default for
effect kinds. Catch per rule so one bad rule does not kill the change handler.

### 5. Submit is not a pipeline and can persist data it never validated

The sketch is missing the closing brace for the `EDIT` branch, so the `VIEW`
path returns nothing. Illustrative or not, it shows the path was never run.
More important:

- **`ComplexHandle.validate()` is never called.** A rich-text or file field can
  be invalid after the entity is already saved.
- **`Promise.allSettled` returns `{ ok: true }` even when every complex submit
  rejects.** Callers cannot tell success from partial failure.
- **No double-submit guard.** Two clicks create two entities.
- **`getValues()` is a shallow copy.** Nested objects are shared with RHF
  state. A later edit mutates the payload while it is in flight.
- **No `reset(saved)` after success.** `isDirty` stays true and the baseline
  stays at load, so a later VIEW toggle discards values the user just saved.
- **No `document.version`.** The problem statement says the form stores the
  version it rendered; submit never sends it.
- **No server error mapping.** A 422 becomes an opaque `entity` object.
- **No `try/catch`.** `trigger()` and `saveEntity()` can reject and leave the
  UI stuck.
- **No cascade settlement.** A pending fetch can land after the payload is
  captured.
- **VIEW submit still calls `complexHandles.submit()`.** If that validates
  internally, VIEW submit validates, contradicting the requirement.
- **Complex submit gets no entity.** An attachment cannot attach to an id that
  does not exist yet.

Fix shape:

```ts
let inFlight = false

async function submit() {
  if (inFlight) return { ok: false, stage: 'busy' }
  inFlight = true
  try {
    if (ctx().formMode === 'EDIT') {
      const ok = await form.trigger()
      if (!ok) return { ok: false, stage: 'validation' }
    }

    const complexErrors = (await Promise.all(
      [...complexHandles.values()].map(h => h.validate())
    )).flat()
    if (complexErrors.length) {
      return { ok: false, stage: 'complex-validation', errors: complexErrors }
    }

    await settleCascades()
    const values = structuredClone(form.getValues())
    const entity = await saveEntity({ ...values, documentVersion: doc.version })
    if (!entity.ok) {
      applyServerErrors(entity.errors)
      return { ok: false, stage: 'entity', entity }
    }

    const settled = await Promise.allSettled(
      [...complexHandles.values()].map(h => h.submit(entity.value))
    )
    form.reset(entity.value ?? values)

    return {
      ok: settled.every(r => r.status === 'fulfilled' && r.value.ok),
      entity,
      complex: settled,
    }
  } catch (err) {
    return { ok: false, stage: 'exception', error: err }
  } finally {
    inFlight = false
  }
}
```

Decide whether VIEW submit runs complex validation. If it must not, then
`ComplexHandle.submit()` must not validate; split `validate` and `submit`.

### 6. The slot adapter neither runs cascades nor feeds the renderer

`useSlot` returns `field.onChange` directly. The `change()` wrapper exists only
in prose, two sections away. Any renderer that follows the adapter contract
silently skips every cascade. The module map calls `useSlot` "the only place
RHF appears in a field component", so cascades must live there or nowhere.

It also drops:

- `field.ref`. Without it, `setFocus`, `shouldFocusError`, and error focus
  cannot work.
- `field.name`. Renderers reconstruct names, duplicate paths collide.
- `disabled`, `isTouched`. Form-level disabled and touched-based error display
  are impossible.
- Any slot type check, though the problem statement requires one on first
  render.

And `field.onChange` treats **any object with a `target` key** as an event.
Open `properties` data can contain `{ target: ... }`. Wrap it at the adapter,
but test for a real event first or you will wrap the event itself:

```ts
function toFieldArg(next: unknown) {
  if (typeof Event !== 'undefined' && next instanceof Event) return next
  if (next && typeof next === 'object' && 'target' in next) {
    return { target: { value: next } }
  }
  return next
}

export function useSlot(path: string) {
  const { control, runCascades } = useFormEngine()
  const { field, fieldState } = useController({ control, name: toName(path) })

  const onChange = useCallback((next: unknown) => {
    field.onChange(toFieldArg(next))
    runCascades(path)
  }, [field, path, runCascades])

  return {
    value: field.value,
    onChange,
    onBlur: field.onBlur,
    ref: field.ref,
    name: field.name,
    error: fieldState.error?.message,
    invalid: Boolean(fieldState.error),
  }
}
```

Also: `undefined` and `null` cannot be written through `setValue`/`onChange`
without normalization. Decide per slot (`''`, `null`, `false`) and do it in one
place.

### 7. Repeat groups have no per-item scope

This is the largest structural hole. A repeat group is a field with a template,
but nothing in the design carries which item is being rendered.

Concrete failures:

- `FieldHost({ def })` receives only the template field. Child bindings are
  relative (`name`), but no absolute path (`properties.items[3].name`) is
  passed. Every row either binds the same path or needs renderer-side string
  building the adapter does not expose.
- `resolveMode(fieldId, values, ctx)` has no item index. A rule that reads a
  sibling inside the same item cannot be evaluated per row.
- `useResolvedMode(def.id)` is identical for every row, so per-item visibility
  is impossible.
- `<BlockBoundary id={def.id}>` repeats the same DOM and React id per row.
- `React.memo` on `def` identity skips re-render when `move`/`remove` changes
  the row's data.
- `fieldByPath(effect.target)` is exact-match. A cascade targeting
  `items[3].name` does not resolve to template `itemName`.
- `assembleSchema` filters `doc.fields`; template children are not top-level
  fields unless recursively expanded.
- A hidden `RepeatGroup` does not hide or demote its children. They stay EDIT,
  enter the schema, and can be required while invisible.
- Per-item cross-field validation has no item scope: "`name` depends on
  `date`" applies to which item?
- `cascadeIndex` keyed by exact source path cannot match `items[*].name`.

Fix: introduce scope, and fold ancestor mode.

```ts
type Scope = { path: string; index: number; key?: string }

resolveMode(def, values, scope, ctx)
FieldHost({ def, scope })
useSlot(scope.path)
```

- Child name = `${groupPath}[${index}].${childBinding}`.
- Any HIDDEN ancestor makes the descendant HIDDEN; a VIEW ancestor demotes
  EDIT to VIEW.
- Resolve rule dependencies relative to the item, or forbid item-relative
  rules. Pick one; do not leave it implicit.
- Memo key and React key include `scope.path` or `scope.key`.
- `fieldByPath` resolves exact paths, template patterns, and parent prefixes.
- Do not filter hidden fields out of the mounted tree. Mount every `FieldHost`
  and return `null` inside. A parent that filters them never subscribes, so a
  hidden field can never become visible again.

Other repeat-group gaps:

- `append` must include a complete item built from template defaults. A
  partial object leaves missing slots `undefined` and React warns about
  uncontrolled inputs. Add a `newItem()` builder.
- `itemKey` can be missing, duplicated, or unstable. Validate uniqueness and
  fall back to the hook key, recording the fallback.
- Nested repeat groups: `useFieldArray` requires a fixed `name` for the life of
  the hook; a parent reorder changes the child name. Spike it or reject
  nesting.
- Array-root errors (`minItems`, "at least one item") have no display path.
  `useSlot` exposes leaf errors only.
- Flat scalar arrays: v7 requires object rows. Wrapper or v8 beta. Decide
  before modelling the data.
- `name` is fixed per mounted hook. Keying the group by document version and
  path is not enough after a parent reorder; remount explicitly.
- Key contract, pick one and write it down:
  - default `keyName: 'id'` -> React key is `field.id`; a data `id` is shadowed
    inside `fields` but intact in values;
  - `keyName: '__key'` -> React key is `field.__key`; data `id` stays visible
    in `fields`;
  - backend id as React key -> read it from values. The hook key is then
    unused. `key={field.id}` with `keyName: '__key'` is a bug.

### 8. `required` passes empty strings and null

JSON Schema `required` checks presence, not emptiness. The concurrent fix for
missing paths is to seed `''`. Together they make every required text field
pass:

- `{ type: 'string' }` with `''` is present, so `required` passes.
- `null` passes `required`.
- `[]` passes `required`.
- Create mode is wide open.

Fix: define `required` as non-empty for this engine. The assembler knows the
slot type, so inject the emptiness rule; do not trust backend fragments to
remember it.

```ts
if (required) {
  if (slotType === 'string') fragment.minLength = 1
  if (slotType === 'array') fragment.minItems = 1
  if (nullable) fragment.not = { type: 'null' }
}
```

Keep `0` and `false` valid. Decide whether whitespace-only strings count as
empty, and test it.

### 9. No document validation and no fail-closed path

`document.ts` says "parse and normalise", not "validate". Every index assumes
the document is valid. The problem statement says authoring validation is
deferred and the runtime must fail closed. Nothing implements that.

Validate at parse:

- field ids unique, non-empty, safe; duplicate bindings allowed only by
  explicit rule;
- every `type` and slot exists in the registry;
- every binding path is canonical, with no reserved segments, no ambiguous
  numeric object keys, no unaddressable characters;
- every `permissionKey` exists and every grant is `EDIT` or `VIEW`;
- every rule parses, every operator is known, every effect kind is known,
  every target is bound, every `dependsOn` field exists;
- per-field fragments stay inside the allowed keyword subset; `dependsOn`
  covers every path the condition reads;
- repeat templates have unique child ids and a valid `itemKey`;
- schema depth, pattern length, rule count, and array limits are bounded;
- no visibility cycles.

Fail closed:

- invalid document -> error panel, no partial form, submit blocked;
- invalid visibility rule -> hide the target fields, not show them;
- invalid cascade rule/effect -> skip it and record a blocking diagnostic;
- unknown effect kind -> never fall into the fetch branch;
- unknown field type -> non-editable fallback plus a blocking diagnostic;
- malformed AJV fragment -> block submit.

Define `record` while you are there:

```ts
type EngineIssue = {
  code: string
  severity: 'blocking' | 'warning'
  fieldId?: string
  ruleId?: string
  detail?: unknown
}
```

`console.warn` is not a fail-closed policy. Blocking issues need a visible
state and a disabled submit.

### 10. Paths are unsafe for an open property tree

- **"Normalise once at parse" contradicts every hook.** Section 6 and section
  10 call `toName` at the boundary, while section 5 says the engine only sees
  one form. If bindings are normalised at parse, backend cascade targets are
  still dotted and `fieldByPath(effect.target)` misses. Pick one boundary.
- **A numeric segment is not always an array index.** An open tree can hold an
  object key `"2024"` or `"0"`. `toName` turns `years.2024.value` into
  `years[2024].value`. RHF `set` can create an array where an object was
  expected. That is silent data corruption, not the accepted "property named
  0" limitation.
- **RHF cannot address keys containing `.`, `[`, `]`, `'`, or `"`.**
  `stringToPath` splits on them. Either reject such keys at parse with a
  visible diagnostic, or keep segments as arrays and build names from
  segments.
- **JSON Pointer escapes are not decoded.** `~1` is `/` and `~0` is `~`.
  AJV error paths need decoding before mapping.
- **Prototype keywords are silently ignored by RHF.** Reject `__proto__`,
  `prototype`, `constructor` at parse rather than render dead fields.
- **Leading-zero indices** (`items.01`) become object keys, not elements.
  Reject them.
- **"The stored entity keeps the original dotted form" is wrong.**
  `getValues()` returns a nested object. If the backend expects dotted keys, a
  serializer is missing. Say which shape leaves the client.

### 11. AJV, cache, and resolver sketches are not runnable

**Resolver sketch:**

```ts
const { schema } = assembleSchema(doc, values, currentContext())
const validate = getCompiled(schema)
toFieldErrors(validate.errors, pathToField)   // pathToField is not destructured
```

- `compiledFor(signature)` is defined in 9.2 and never called.
- `getCompiled` receives a fresh schema object every call. Cache by object
  identity never hits; cache by hash costs more than it saves. Pass the key.
- `doc` and `currentContext()` are ambient. Two forms or two tests collide.
  Build one resolver per form.
- `async` with no `await` adds microtask reordering and stale-result races for
  no reason. Make it synchronous; AJV compiled validation is synchronous.
- No `try/catch`. A malformed fragment or AJV strict error rejects `trigger()`
  and `submit()` with no visible state.

**AJV configuration is unspecified and the defaults are wrong:**

- `allErrors: false` returns one error. If it is a structural keyword
  (`anyOf`, `oneOf`, `allOf`, `not`, `if`) and `toFieldErrors` drops it, the
  resolver returns `{}` while `validate()` returned false. The form is
  "valid" with errors.
- `coerceTypes`: HTML inputs produce strings. A `type: 'number'` schema rejects
  `"5"`. Turning coercion on lets AJV mutate the values object RHF owns.
  Normalize at the slot boundary instead.
- Formats: AJV 8 ships none. `format: 'date'` throws or is ignored without
  `ajv-formats`.
- Draft mismatch: AJV 8 defaults to draft-07. `items[]` tuple syntax changes
  in 2019-09/2020-12. Pin the meta-schema.
- `$ref`: forbid external refs and `$async`; `$data` off unless explicitly
  supported.
- `useDefaults` and `removeAdditional` mutate or strip values behind RHF's
  back. Leave both off.
- Backend `pattern` is an arbitrary regex. Cap length and nesting to limit
  ReDoS.

Set them explicitly, not by default:

```ts
const ajv = new Ajv({
  allErrors: true,
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  $data: false,
})
```

**Cache key is under-specified and can collide across documents:**

```text
document.version | sorted editable field ids | array lengths
```

No `document.id`, no assembler version. `customer@1` and `order@1` with the
same field ids share a compiled validator. `|` can collide. Use a JSON tuple,
include `doc.id` and `ASSEMBLER_VERSION`, cap with an LRU, and cache
`{ validate, pathToField, project }` together. After a cache hit the error
mapper still needs the path map.

`assembleSchema` still walks every field and calls `resolveMode` on every
resolver invocation even on a compile hit. Measure it, or cache the assembled
schema under the same key.

**Error mapping:**

- Build the hierarchical form RHF expects, including arrays with `null` holes:
  `{ participants: [null, { name: fieldError }] }`. A dense object or dotted
  keys will not populate `fieldState.error`.
- Decide `criteriaMode`. Default `firstError` shows one error per field;
  `all` changes `fieldState.error` to an array and breaks `useSlot`'s
  `.message`.
- Unescape JSON Pointer `~0`/`~1` before building names.
- `required`/`additionalProperties` at root or on an unbound path need
  `errors.root` and a visible banner.
- `messageFor` needs a label. "required" is not a user message, and raw
  constraint values can leak schema internals.

### 12. Mode toggle discards or keeps the wrong state

```ts
if (next === 'VIEW' && form.formState.isDirty) {
  warnUnsavedChanges()
  form.reset(savedSnapshot.current)
}
```

- **`isDirty` is stale in an event handler.** RHF subscribes formState only for
  properties read during render. Read it in `FormHost` render and pass it down,
  or compare `getValues()` against the baseline with a deep equal.
- **The warning result is ignored.** If the user cancels, the reset still runs
  and the mode still toggles. `warnUnsavedChanges()` must return
  `boolean | Promise<boolean>` and gate the reset.
- **Complex `isDirty()` is never consulted.** Unsaved rich-text or file edits
  vanish without a warning.
- **No reset baseline after save.** `savedSnapshot.current = values` does not
  change `defaultValues` or clear `isDirty`. Call `form.reset(savedEntity)`.
- **Pending work is not cancelled.** The debounce timer and in-flight cascades
  land after the toggle. Clear the timer and bump the cascade epoch.
- **Errors survive the toggle.** A form with errors and no edits keeps them,
  goes to VIEW, then shows them again on return. Clear or revalidate on mode
  change.
- **`formModeRef` update order is unspecified.** A resolver or cascade in the
  same tick can see the old mode. Set the ref synchronously before reset and
  state.
- **Focus is lost.** Accepted in the doc, but restore focus to the toggle or
  the form heading and announce the mode for keyboard users.
- **One baseline, not two.** Use RHF `defaultValues` as the saved baseline and
  `form.reset()` with no arguments to discard drafts. A separate snapshot plus
  a separate dirty check is more state to drift. If you keep it, deep-clone at
  capture.

### 13. Multi-slot writes are not atomic

`InputWithNA` writes `value` and `isNA` in one user action. With one
`onChange` per slot, the sequence is: write value -> run cascades -> write NA ->
run cascades. A cascade keyed on `value` runs before `isNA` is set and reads the
old state. A cascade keyed on `isNA` can overwrite the value just written. The
result depends on callback order and can leave `{ value: 'old', isNA: true }`.

Fix: one field-level write.

```ts
changeField(fieldId, { value: nextValue, isNA: nextNA })
```

Write every slot synchronously, then run cascades once with the final values.
Also define per-slot defaults, per-slot validation, and per-slot error targets.
A single field-level fragment cannot express "value required unless isNA"
without a cross-slot rule.

### 14. The per-field render claim is unproven and partly impossible

- `form.trigger()` with no name re-renders the entire form state (RHF docs).
  `useSlot` reads `fieldState.error`, which subscribes to errors. Every
  debounced validation can therefore re-render every field. Section 15 says
  "nothing else" re-renders. Count renders before repeating the claim.
- `React.memo` on `FieldHost` "compared by `def` identity and mode" cannot
  work as written: mode comes from a hook inside the component. A comparator
  cannot see hook state. Split into a memoised shell keyed by `def` and
  `scope`, and an inner subscriber; or pass mode down from a parent that
  already watches it.
- The `deps` array in `useResolvedMode` is rebuilt every render, and `useWatch`
  treats a new name array as a new subscription. `useMemo` by rule identity and
  dedupe.
- `useWatch({ name: [] })` and `snapshot()` are undefined behaviour. Skip the
  hook when there are no rules, and read full values from `getValues()` rather
  than reconstructing a tree from watched leaves.
- `useWatch` returns an array for a name array, in dependency order. If
  `snapshot()` assumes an object keyed by path, every condition reads
  `undefined`.
- `form.watch(cb)` is deprecated; use
  `form.subscribe({ formState: { values: true }, callback })`. Both deep-clone
  form values on every change, so measure the debounce path.
- `useEffect(..., [form])` is a documented future break. Depend on the stable
  methods.
- `useSlot` per slot means `InputWithNA` has two subscriptions, not one per
  field. Say so and count it.
- Never subscribe `isValid`. It validates the whole schema on mount and every
  change, defeating the debounce.
- Memoise provider values. An inline `{ form, document, permissions, mode }`
  object re-renders every field on every host render.

---

## 2. High findings

- **`defaultValues` is not a load strategy.** RHF reads and caches it at mount.
  Edit mode fetches after mount, create mode needs document defaults, and the
  two race `useFieldArray`. Render after data arrives, or use `useForm({ values })`
  with `keepDirtyValues`. Seed every bound path; never seed `undefined`.
- **Unbound data policy is a data-loss decision.** Submit sends `getValues()`,
  so anything not seeded is dropped. Preserve the loaded entity and overlay
  bound values, or state the drop in the payload contract. If you preserve,
  the root schema must allow unbound keys (`additionalProperties` open), which
  conflicts with blocker 2 unless validation is projected.
- **Duplicate bindings break singular maps.** Two fields may bind one path;
  both must update. `fieldByPath` and `pathToField` must be
  `Map<Path, FieldDef[]>`. A cascade should require **every** bound field to be
  EDIT, and an error should apply to all. Different `permissionKey` values on
  one path need an explicit rule.
- **Container writes bypass descendant mode.** A `set` effect on
  `properties.address` overwrites `city` even if `city` is VIEW. Restrict
  effects to leaf paths, or gate every descendant and define deep-merge
  semantics.
- **Server errors, concurrency, and idempotency are missing.** Map 422 to
  `setError`; send the loaded entity version; add an idempotency key for create.
  Without them a retry duplicates data and a conflict silently overwrites.
- **Accessibility has no contract.** Return `id`, `describedBy`, `invalid`,
  `required`, and `disabled` from the adapter. Announce errors, focus the first
  invalid field with `trigger({ shouldFocus: true })` or `setFocus`, and restore
  focus after hide and mode toggle.
- **Presentation metadata is missing.** No labels, help, placeholders, options,
  or i18n keys. A generic engine cannot render a usable form from `type` and
  `binding` alone. Add per-type props with a schema.
- **RichText is an XSS surface.** Backend HTML in VIEW must be sanitized and
  covered by CSP.
- **JSON Logic is a trust boundary.** `json-logic-js` CVE-2021-4329 allows
  prototype walking and command injection through standard `var`/`method`
  operators. Pin `>= 2.0.2`, sanitize `var` paths, or write a restricted
  evaluator with an operator allowlist. "Unknown operator fails closed" does
  not cover it.
- **Complex handles are mount-bound.** Hidden or VIEW fields unmount, so their
  handle disappears and submit silently skips them. Register handles at the
  form level, keyed by field instance; make StrictMode double-mount idempotent.
  Define reset, error shape, ordering, and retry.
- **`BlockBoundary` sits inside `FieldHost`.** An error from `useResolvedMode`
  or the registry lookup throws before the boundary. Move it outside the hook,
  or add a form-level boundary.
- **Duplicate field ids break React and DOM.** Validate uniqueness; derive DOM
  ids from `fieldId` plus path.
- **Document and permission changes mid-session are undefined.** A republish or
  role change must invalidate rules, validation, snapshot, and pending
  cascades, or remount the form.
- **`useForm` `context` is dead config.** The design passes it and never reads
  it. Use the resolver's context argument, or remove it.
- **`useFieldArray` details need a spike.** `append` focuses the new row
  (`shouldFocus: false`), `remove()` without an index removes all rows, and
  `update` remounts. None of this is stated.
- **The engine purity claim is false.** `runCascades`, `submit`, and the
  debounce touch RHF. Define a `FormApi` port (`getValues`, `setValue`,
  `trigger`, `reset`, `fetch`, `record`) if the pure/testable boundary matters.
  Right now `submit.ts` cannot be tested without RHF.
- **Snapshot immutability.** `reset(values)` adopts the passed object as the
  new `defaultValues`. Deep-clone at capture, and do not share references with
  the entity or form values.
- **Type-mismatch handling has no code.** "Degraded field, recorded" needs a
  type guard per slot, one check per instance per document version, and a
  read-only fallback so the user cannot write the wrong type.
- **Messages can leak schema internals.** Enum values, regexes, and internal
  paths should not reach the user. `messageFor` owns that decision.
- **`formState` at the root is overbroad, not forbidden.** Reading only
  `isDirty` in `FormHost` subscribes to dirty, not errors. The rule should be
  "never subscribe errors or isValid at the root".

---

## 3. What the design gets right

- The split is correct: RHF owns values, errors, dirty; the engine owns
  document, modes, rules, validation assembly.
- `useController` per slot and `useWatch` per dependency are the right
  primitives. Two subscriptions for `InputWithNA` is fine.
- A resolver is the right single AJV injection point, and RHF caches it by
  identity.
- `shouldUnregister: false` is right for VIEW unmount survival (it is also the
  default; the load-bearing part is never setting it true).
- Avoiding `handleSubmit` for VIEW submit is justified, provided the custom
  pipeline rebuilds `isSubmitting`, `submitCount`, double-submit protection,
  error focus, and reset-after-save.
- Debouncing `trigger()` outside the resolver is right. Do not debounce inside
  an async resolver.
- No cascade chaining removes cycles by construction.
- Keeping hidden values on submit matches the requirement.
- Complex fields outside AJV is right, if their validation is orchestrated.
- `setValue(..., { shouldDirty: true })` is correct; `setValue` does not mark
  dirty by default.
- `reset` is the right mechanism for discarding drafts and moving the saved
  baseline.
- Fail-closed intent is right; the implementation rules are missing.
- Production precedent supports the shape: TrueFoundry FormBuilder and
  catjam.fi both ship RHF as the state engine with a backend schema and
  declarative validation.

---

## 4. Contradictions to resolve

| Where | Conflict | Resolution |
|---|---|---|
| problem 5 vs invariant | form VIEW checked before permission, so HIDDEN becomes VIEW | permission and visibility first, form VIEW last (blocker 1) |
| problem 7 vs design 9.1 | schema "assembled at load" vs assembled per resolver call | assemble on EDIT-set change, cache by signature |
| problem 4 vs design 7 | `permissionKey` exists in the document, unused in mode resolution | resolve `permissionKey ?? fieldId` |
| problem 8 vs design 14 | complex fields read form data read-only vs a declared setter | decide the write interface before implementing |
| problem 8 vs design 12 | "validate, then entity and complex" vs complex never validated | call `validate()` before the entity write |
| design 1 vs 10/12 | "nothing in the engine imports RHF" vs `runCascades`/`submit` | define a port, or drop the purity claim |
| design 5 vs 6/10 | normalise once at parse vs `toName` at every boundary | one boundary; segments internally |
| design 15 | one subscription per field vs one per slot | state per slot, count `InputWithNA` as two |
| design 15 vs 13 | no `formState` at root vs dirty gate | allow `isDirty` only, never `errors`/`isValid` |
| design 15 vs 7 | `React.memo` compares mode vs mode comes from a hook | memoise the shell, not hook output |
| design 6 | "cascade wins in the same paint" | true only for synchronous `set`; async lands later |
| design 11/12 | render key "must not be stripped" vs "not in getValues" | it is not in values; nothing to strip |
| problem 7 | `required` "falls out of the EDIT filter" | presence is not emptiness; inject minLength/minItems |
| problem 3 vs design 4 | missing path is valid as `undefined` vs RHF needs a seed | semantic missing is fine; seed for RHF |
| design 9.1 vs problem 4 | one validation fragment per field vs per-slot binding | define per-slot fragments or one root fragment |
| design 9.2 | cache key omits `document.id` | add it |
| design 9.3 | `compiledFor(signature)` vs `getCompiled(schema)` | one API, key in, compiled + map out |
| design 11 | `keyName` `__key` vs `key={field.id}` | pick one key expression |
| design 12 | VIEW runs no validation, yet calls complex `submit()` | split validate and submit |
| design 16 | reorder discard claim with no identity check | token + item key (blocker 4) |

---

## 5. Repo reality

The design is written for a product, not for this repo. From `AGENTS.md`,
`package.json`, and the tree:

- **Plain JavaScript, no TypeScript.** No `typescript` dependency, no
  `tsconfig.json`, components are `.jsx`, and the existing logic is `.js`. The
  design is `.ts`/`.tsx` and uses RHF `Resolver` types. Either add TS tooling
  with a stated reason and a lint config for it, or write the sketches in JS
  plus JSDoc. Do not smuggle TS in through a demo.
- **No dependencies installed.** `package.json` has no `react-hook-form`,
  `ajv`, `ajv-formats`, `@hookform/resolvers`, or `json-logic-js`. The review
  and the design both need a version pin before code: RHF 7.x, AJV 8.x,
  `json-logic-js >= 2.0.2`.
- **No DOM test tooling.** `npm test` is `node --test`; the only test is
  `diffLists.test.mjs`. Pure engine tests fit. `useSlot`, `FieldHost`, and
  `useFieldArray` tests need a DOM renderer and a testing library. Adding
  Vitest/RTL is new tooling; say why in one line, or drop the render-count
  claims until measured.
- **README does not list the form-engine docs.** The problem README lists four
  research docs and none of `problem-form-engine.md`,
  `rhf-form-engine-design.md`, this review, or `form-library-evaluation.md`.
  Add them or they are invisible.
- **One pattern per experiment.** `AGENTS.md` says self-contained demos,
  preference for repetition over abstraction. This design is seven engine
  modules, four RHF modules, a registry, fixtures, AJV, JSON Logic, cascades,
  arrays, permissions, and submit. Split it:
  (a) paths, mode, permission; (b) validation assembly; (c) repeat groups;
  (d) cascades; (e) submit and complex fields.
- **`App.jsx` is a switchboard.** The design never says which demo appears
  there, which fixture it loads, or how to run it. Add that or the spike has no
  entry point.
- **No secrets, no real endpoints.** A config-supplied cascade URL is exactly
  the wrong thing to demo against the internet. Use a local mock endpoint and
  state that document URLs are untrusted in the fixture README.
- **Lint config is JS-only.** `.ts`/`.tsx` will not lint without a parser and
  plugin. A demo with 200 lint errors is not a finished demo.

---

## 6. Test matrix

Each item maps to a blocker or high finding. Paint the truth table before the
first component.

**Modes and permissions**

1. Form VIEW, `permissions = {}` -> every field HIDDEN, not VIEW.
2. Form VIEW plus a visibility rule -> hidden field stays HIDDEN.
3. Grant `'edit'`, `'NONE'`, `true`, `'HIDDEN'` -> HIDDEN, recorded.
4. Field id `constructor` / `toString` -> HIDDEN, no crash.
5. `permissionKey` distinct from field id -> correct grant.
6. Group hidden -> children HIDDEN; group VIEW -> children VIEW.
7. Duplicate field id -> document rejected.

**Paths and keys**

8. Object key `2024` or `0` -> no array creation, no data loss.
9. Key containing `.`, `[`, `]`, `~`, `/` -> rejected or addressed.
10. Path `__proto__.x` / `constructor.x` -> rejected at parse.
11. Leading-zero index `items.01` -> rejected.
12. Entity leaves the client nested vs dotted -> one documented shape.
13. JSON Pointer `~0` / `~1` -> decoded before mapping.

**Validation**

14. Hidden value plus parent `additionalProperties: false` -> no error on it.
15. Visible field's `if` reads a hidden sibling -> fragment rejected.
16. Required leaf with missing parent -> error lands on the field.
17. Root `required` -> visible form-level error, not silent block.
18. `required` + `''` / `null` / `[]` -> fail; `0` / `false` -> pass.
19. Two fields bind one path with conflicting type -> blocked or deterministic.
20. Error object with arrays and `null` holes -> `fieldState.error.message`
    populated.
21. `anyOf`/`oneOf`-only failure -> not dropped; visible.
22. Compile error, unknown keyword, remote `$ref` -> banner, submit blocked.
23. Text input bound to number schema -> defined conversion or error.
24. Optional date cleared to `''` -> valid or normalized, not a format error.
25. `criteriaMode` firstError vs all -> both shapes handled by `useSlot`.
26. Same version, different `document.id` -> no cache collision.
27. Repeated validation on a stable signature -> no recompile; LRU capped.

**Cascades**

28. Source changes during a fetch -> older result discarded.
29. VIEW, EDIT round-trip during a fetch -> discarded.
30. Array `move`/`remove` during a fetch -> correct item or discarded.
31. Sync `set` while an async result is pending on the same target -> aborted.
32. Rule reads three paths -> fires when each one changes.
33. Unknown effect kind -> no fetch, blocking diagnostic.
34. `set` on a container path -> descendants not clobbered.
35. Fetch 404 -> error state, no write.
36. Fetch timeout -> error state, no hang.
37. Wrong response type -> rejected before `setValue`.
38. Normal abort -> no "cascade failed" noise.
39. Text source with a remote rule -> request rate bounded.

**Submit and mode**

40. `isDirty` read in the toggle handler -> correct, not stale.
41. Cancel unsaved warning -> no reset, no toggle.
42. Complex dirty only -> warned or explicitly discarded.
43. Save success -> `isDirty === false`, baseline moved to the saved entity.
44. Complex validation fails -> entity not saved.
45. Complex submit partial failure -> `ok === false` with per-handle detail.
46. Double click -> one entity, one side resource.
47. VIEW submit -> no `trigger()`, payload unchanged.
48. VIEW submit with complex handles -> defined behaviour.
49. `saveEntity` throws -> caught, visible, form not stuck.
50. 422 from the server -> field errors mapped.
51. Submit with a pending cascade -> settled or aborted, payload consistent.
52. Submit before the entity load finishes -> disabled.

**Arrays**

53. `append` from template defaults -> complete object, no uncontrolled inputs.
54. Remove/reorder with a pending cascade -> identity token.
55. Hidden repeat group -> values survive, then reappear.
56. Nested repeat group, parent reorder -> child rows, values, errors survive.
57. `minItems` violation -> visible array-level error.
58. Flat scalar array -> wrapper decision or v8.
59. Data `id` preserved in `getValues()` while the render key is separate.
60. `keyName: '__key'` -> React key is `field.__key`, not `field.id`.
61. Duplicate or missing `itemKey` -> fallback plus record.
62. `reset`/`replace` while rows are mounted -> no stale rows.

**React and RHF**

63. Typing in one field -> render count; verify the `trigger()` re-render claim.
64. Visibility deps array stable -> no re-subscribe per render.
65. Field with no visibility rules -> no whole-form subscription.
66. StrictMode double mount -> complex registry has one handle.
67. Data object `{ target: x }` -> stored as data; a real Event -> event.
68. `null`/`undefined` slot values -> no controlled/uncontrolled warning.
69. Form root subscribes to `errors` or `isValid` -> absent.
70. Document invalid -> error panel, no partial render, submit blocked.
71. Async entity load -> form populates after mount, arrays included.
72. Accessibility: label, `aria-invalid`, `aria-describedby`, announced error,
    focus first invalid, focus restored after mode toggle.

---

## 7. Fix order

1. **Mode resolution.** Permission -> visibility -> ancestor -> form demote.
   Add `permissionKey` and grant allowlisting. Update both docs.
2. **Parse and validate the document.** Paths, ids, types, rules, grants,
   sizes. Fail closed with a blocking issue list.
3. **Validation.** Projected clone, fragment subset, parent `required` pruning,
   cross-field target, `required` emptiness, AJV options, error shape.
4. **Slot adapter.** Cascades inside `useSlot`, `ref`/`name`, event-vs-data
   wrapping, per-slot defaults, slot type check.
5. **Cascade state machine.** Epoch, run token, item identity, declared
   params, timeout, response validation, abort on every mutation.
6. **Submit state machine.** Lock, complex validate, deep clone, version,
   server errors, settle cascades, reset baseline, catch.
7. **Mode toggle and arrays.** Dirty gate from render, warning veto, complex
   dirty, pending work cancellation, scope model, append defaults, key
   contract.
8. **Then one vertical slice.** One `Text`, one `InputWithNA`, one visibility
   rule, one sync cascade, one AJV rule, one async cascade, one repeat group.
   Measure render counts with `trigger()`. Decide the validation dispatch from
   the measurement, not the assumption.

Pin versions before coding: `react-hook-form@7.x`, `ajv@8.x`, `ajv-formats`,
`json-logic-js@>=2.0.2`. Or commit to v8 beta and update every v7 note. Do not
mix.

---

## Sources

- RHF v7 docs: useForm, useController, useWatch, useFieldArray, watch,
  getValues, reset, setValue, trigger, formState - react-hook-form.com/docs
- RHF useFieldArray source (v7.x) - generated key overwrite and `keyName`
- RHF issues #1245, #3378, #7562, #8932, #8935, #9246, #10078, #12254;
  discussions #10775, #11942; changelog 7.40.0
- RHF docs on `trigger` re-rendering form state and `formState` proxy
  subscription; `handleSubmit` `isSubmitting`/`submitCount`
- AJV 8 options docs; JSON Schema draft-07 (`required`, `additionalProperties`,
  `items` vs `prefixItems`)
- client-side-form.com/framework-adapters-custom-hooks/react-form-hook-architecture
  - debounce + abort pattern
- TrueFoundry FormBuilder; catjam.fi/articles/building-complex-forms
- CVE-2021-4329 (NVD, GHSA-67j4-2mh6-8627); Snyk package health
  (`json-logic-js` maintenance inactive)

## Caveats

- No RHF v8 deep check. The beta changes `useFieldArray` keys, removes
  `keyName`, and changes `watch(cb)`. Pin v7 or budget the migration.
- No benchmark. Render-scope claims rest on subscription semantics and must be
  measured with a counter, especially after `trigger()`.
- `useWatch` `exact` semantics changed in v7 patches. Leave the default
  (`false`) for visibility dependencies until a real build proves `true` does
  not miss ancestor writes.
- No code was run; this is a design and source review.

## Bottom line

The split is right. The document is not a contract yet. Fix blockers 1-5 first:
they are the ones that leak data, lose data, or block submit with no message.
Everything else is engineering, not architecture.
