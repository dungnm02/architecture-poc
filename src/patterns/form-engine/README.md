# Form engine

A config-driven form engine with React Hook Form (RHF) as the value, error and
dirty layer. One UI-schema document plus one entity produce an editable form, a
read-only view, or hidden fields, with cross-field validation, cascades, repeat
groups and a locked submit pipeline.

Design (source of truth):
[`problems/config-driven-architecture/docs/rhf-form-engine-design.md`](../../../problems/config-driven-architecture/docs/rhf-form-engine-design.md).

## Boundary

- **Engine owns** the document, permissions/modes, visibility, validation
  assembly, cross-field rules, cascades, repeat-group orchestration, complex-field
  registration and submit. `engine/` imports neither React nor RHF and is tested
  without a DOM.
- **RHF owns** values, errors, dirty state and the resolver call. RHF names are
  allowed only in `rhf/`.
- **Renderers own** fields: they receive slot values and call `slot.onChange`
  with plain values, never events or RHF names.

```text
document + entity data
        |
   engine (pure over a small port)
        |
   RHF (values, errors, dirty)
        |
   field renderers (VIEW / EDIT)
```

Permission grants are **rendering rules, not authorization**. The client still
holds the whole entity in `defaultValues` and submits it; a real server must omit
unauthorized values on read and enforce field authorization on write.

## Module map

```text
src/patterns/form-engine/
  engine/
    paths.js       segment parsing, toName/pathKey, pointer and template helpers
    issues.js      EngineIssue factory, blocking helpers, messageFor
    conditions.js  closed condition operator allowlist and evaluator
    modes.js       mode lattice, grant normalisation, resolveMode, mode planner
    document.js    parse + validate + normalise the UI schema
    visibility.js  inverted visibility index, isHidden, watched dependency union
    validation.js  fragment allowlist, schema assembly, validator cache, resolver,
                   AJV error mapping, cross-field rules
    cascades.js    cascade index, epoch/run-token state, set/fetch effects
    seed.js        emptyValueFor and seedBoundPaths
    repeat.js      newItem, row scope, itemKey resolution
    complex.js     form-level complex-field registry
    submit.js      locked submit pipeline and 422 mapping
    engine.js      composition root: document + cache + cascade state + resolver
  rhf/
    FormHost.jsx       useForm, providers, submit, mode toggle, debounce
    FieldHost.jsx      per-field mode resolution and renderer selection
    useSlot.js         useController adapter; the only RHF name boundary
    useSlotValue.js    read-only value subscription
    useFormEngine.js   engine context provider/hook
    useComplexHandle.js complex-handle registration helper
    useArrayError.js   group-path error reader for repeat groups
    BlockBoundary.jsx  render error boundary (field and form level)
    RenderCounter.jsx  render-count readout for the manual render checks
    slotPaths.js       absolute/relative slot path helpers
  registry/
    index.js           pure field-type metadata (no JSX, no RHF)
    renderers.js       type -> { EDIT, VIEW } component map
    fields/            Text, Date, InputWithNA, RepeatGroup, ComplexStub JSX
  fixtures/
    documents.js       fixture UI schema and entity
    sources.js         in-memory cascade sources (no network)
    demo.js            permission sets, save mock, demo exports
    demo.test.mjs      fixture/demo contract tests
  FormEngineDemo.jsx   switchboard entry: permission selector, 422 control
  form-engine.css      demo styles, using the repo CSS variables
  render.test.mjs      Vite SSR smoke tests
  README.md            this file
```

## Run the demo

```bash
npm run dev
```

Open the Vite URL and choose **Config-driven form engine** in the `App.jsx`
switchboard. `FormEngineDemo` parses `DOCUMENT`, seeds `ENTITY` through
`FormHost`, and remounts the form when the permission set changes.

```bash
npm test      # node --test (pure engine + tests + Vite SSR smoke)
npm run build # production build
npm run lint  # eslint .
```

## Test strategy

- `npm test` is the existing `node --test` runner. Pure engine modules are `.js`
  and their tests are `*.test.mjs` next to them.
- JSX cannot be imported by plain Node. `render.test.mjs` starts Vite with
  `createServer({ server: { middlewareMode: true } }).ssrLoadModule(...)` and
  renders with `react-dom/server`. This asserts static markup only: labels,
  seeded values, controls and the permission selector.
- There are **no DOM tests**. Vitest, RTL, TypeScript and extra build config are
  deliberately not added (design §22). Anything that needs clicks, focus,
  debounce timing or a browser is a manual check below.
- `npm run build` and `npm run lint` are part of acceptance for the React layer.

## Key contracts

### Document parse

`parseDocument(raw, { registry, sources })` returns `{ ok, document, issues }`.

- `ok: false` only when no usable document exists: bad root, `id`/`version`,
  empty `fields`, duplicate or unsafe field ids.
- Recoverable problems keep `ok: true` with **blocking** issues: unknown field
  type (read-only fallback), bad visibility rule (target forced hidden, rule
  skipped), bad cascade (rule skipped), bad fragment (slot excluded), bad
  binding. The demo shows a banner and disables submit.
- Bindings are segment arrays. Template children are relative; everything else
  is absolute. Unsafe characters, reserved names, leading zeros and numeric
  non-array segments are rejected.

### Modes and permissions

Order: **permission allowlist → visibility → ancestor → form mode**. The lattice
is `HIDDEN < VIEW < EDIT`; lower wins.

- Only exact `'EDIT'`/`'VIEW'` grants survive `normalizePermissions`; `'edit'`,
  `true`, `'NONE'`, missing keys and typos resolve to HIDDEN in every form mode.
- A HIDDEN group hides its children; a VIEW group demotes EDIT children to VIEW.
- HIDDEN fields stay mounted and return `null` inside `FieldHost`, so they can
  reappear and their value is never cleared.
- The form remounts on document or permission changes with the
  `` `${doc.id}@${doc.version}:${permissionsRev}` `` key.

### Validation

- Per-slot fragments use a closed allowlist: `type`, `enum`, `const`,
  `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`,
  `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minItems`, `maxItems`.
  Syntax, `required`, `anyOf`/`oneOf`, `if`/`then`/`else`, `$data`, `format`,
  `uniqueItems`, nested fragments and sibling-observing keywords are rejected.
- Only effective-EDIT slots compile. The schema is leaf-only, so the resolver
  validates the whole values object directly: **no projection, no clone**.
- Required is injected by slot type (string/date `minLength: 1`, array
  `minItems: 1`, required number non-null). It is never a JSON Schema
  `required` list on the leaf.
- Cross-field rules (`{ id, target, group?, dependsOn, invalidWhen, message }`)
  run **after** AJV, only when the target and every dependency are EDIT. They
  live outside JSON Schema, so there is no `if/then`, `$data` or hidden-sibling
  read. AJV wins on a path.
- The validator cache key is `(ASSEMBLER_VERSION, doc.id, doc.version,
  sorted EDIT entries)`, LRU-capped at 20. Repeat groups compile once as a
  uniform `items` schema.
- Unmappable AJV errors go to `errors.root` and a visible banner; they are never
  dropped.

### Writes

`writeSlots(writes)` is the only user-write path:

1. write every value with `setValue(..., { shouldDirty: true })`,
2. abort pending fetches aimed at those paths,
3. run **one** cascade pass on the final values,
4. schedule **one** debounced validation (400 ms; immediate when the EDIT-set
   signature changes).

Multi-slot fields such as `InputWithNA` write both slots in one call, so a
cascade never observes `{ value: 'old', isNA: true }`. Values containing a
`target` key are stored verbatim: `setValue` does not sniff events, so no
`{ target }` wrapper is added.

### Cascades

- Rules are indexed under every condition dependency. A source path is matched
  through the template index (`items.*.name`) for repeat rows.
- `effect.source` is a frontend registry id, never a URL. Only the paths declared
  in `effect.params` leave the client.
- Set effects write only an EDIT target and never trigger another cascade.
- Fetch effects debounce 300 ms per target. At landing, the latest per-target run
  token, current epoch, unaborted signal, re-resolved target (by `itemKey` when
  present), still-true condition and matching slot type must all hold or the
  result is discarded. `AbortError` is ignored.
- Epoch/abort bumps on reset, mode change, remount, array mutation, submit start
  and unmount.

### Repeat groups

- `Scope = { segments, index, key, ancestorMode }`; child paths are
  group + index + relative child binding.
- React keys always use `field.__key` (`useFieldArray({ keyName: '__key' })`). A
  data `id` is a value, never the React key.
- `newItem(template)` builds a complete row from child defaults. Add, remove and
  move each bump the cascade epoch and schedule one validation.
- Nested repeat groups, flat scalar arrays and per-item visibility are rejected
  at parse. The documented flat-array upgrade path is a `{ value: scalar }`
  wrapper.

### Submit

`createSubmit` is a locked pipeline:

- **EDIT:** `form.trigger(undefined, { shouldFocus: true })` → complex
  `validate()` → wait for cascades (3 s) → clone values + `documentVersion` →
  save.
- **VIEW:** save current values only. No trigger, no complex work.
- The idempotency key is created once and reused until a create succeeds. Payload
  is `structuredClone`d so later RHF mutation cannot leak into it.
- 422 errors map through `setError`; unmapped paths go to the root banner.
- Success does `form.reset(savedEntity)`, moving the baseline and clearing dirty.
- A double submit returns `{ ok: false, stage: 'busy' }`.

### Mode toggle

Moving to VIEW while dirty asks for confirmation. Cancel means no reset and no
toggle. On apply: reset to the single `defaultValues` baseline, cancel the
debounce, bump the cascade epoch, abort fetches, clear errors, change mode and
restore focus to the heading. Errors from before the toggle must not reappear.

## Additions and deviations from the design module map

The design's module map is the baseline. This demo adds or splits:

- **Pure registry split:** `registry/index.js` holds metadata only so
  `node --test` can import it; `registry/renderers.js` and `registry/fields/*.jsx`
  hold renderers. No React/RHF in the pure module.
- **`engine/engine.js`:** composition root for the document, validator cache and
  cascade state, so `FormHost` and tests do not duplicate it.
- **`engine/repeat.js`:** pure `newItem`, scope and item-key helpers, testable
  under Node.
- **`engine/seed.js`:** `seedBoundPaths`/`emptyValueFor` implement design §4's
  seeding rule as a pure helper.
- **`engine/complex.js`:** the form-level complex registry backing design §13.
- **`rhf/BlockBoundary.jsx`:** class error boundary around field and form
  renderers (design prose names it).
- **`rhf/FieldHost.jsx`:** one mounted host per field, including HIDDEN ones.
- **`rhf/useArrayError.js`:** reads group-path `minItems` errors; `useSlot` shows
  leaf errors only.
- **`rhf/useComplexHandle.js`:** idempotent complex-handle registration for
  StrictMode.
- **`rhf/RenderCounter.jsx`:** render-count readout for the manual measurement.
- **`rhf/slotPaths.js`:** absolute/relative slot path resolution shared by
  renderers.
- **`form-engine.css`:** demo styling built from the repo CSS variables.
- **Vite SSR test harness:** `render.test.mjs` uses Vite and
  `react-dom/server`; no Vitest/RTL/TypeScript is added.

## v1 limits and deferred work

- Nested repeat groups are rejected (RHF v7 `useFieldArray` needs a fixed name).
- Flat scalar arrays are rejected; use `{ value: scalar }` rows as the upgrade
  path.
- Per-item visibility is rejected at parse; visibility targets whole fields or
  groups.
- Container fragments (an object/array-level fragment) are not supported.
- `uniqueItems`, `format` and `ajv-formats` are not supported. Timestamps/other
  formats need an explicit pattern or a later slice.
- Numeric object keys (`2024`, `0`) cannot be bound; this fails loud and needs
  JSON Pointer or segment-preserving addressing in production.
- Whitespace-only strings pass required in v1.
- Date patterns accept invalid calendar dates such as `2026-02-31`.
- Backend `pattern` length is capped, but catastrophic backtracking (ReDoS)
  remains a residual production risk. Precompile server-side or use RE2.
- Frontend permissions are not authorization.
- Complex fields are a stub with `validate()`/`submit(entity)` and no write
  interface. A real file/rich-text field is a later slice.
- RHF v7 is pinned; v8 changes `useFieldArray` keys and removes `keyName`.
- The optional date fixture pattern `^(?:\d{4}-\d{2}-\d{2})?$` is a deliberate
  demo choice: the closed fragment vocabulary has no `anyOf`, so an empty
  optional date needs its own pattern instead of the injected date pattern.

## Manual checks

The repo has no DOM test runner, so the browser-only checks from design §19 are
manual. Run `npm run dev`, open the demo, then verify:

1. **Render counts per keystroke and per debounced validation.** Type in Notes
   and watch the render counter. A write schedules one validation after 400 ms;
   a change that alters the EDIT-set signature validates immediately.
2. **Async race.** Switch Country to `CA`, then quickly to `GB`. Only the last
   `policyCode` fetch may land; the stale one is aborted/discarded.
3. **Mode toggle with dirty and cancel.** Edit a field, press View, and cancel
   the confirmation. The form stays in EDIT with the draft intact. Accepting
   discards the draft, clears errors and restores focus to the form heading.
4. **Hidden value survives and reappears.** Set Notes to a value, set Country to
   `XX` (Notes hides), then set it back to `US`. Notes and its value return.
5. **`{ target: x }` round-trip through `writeSlots`.** Use a value of that shape
   in a Text slot (or the repeat row) and confirm it is stored verbatim, not
   unwrapped as an event.
6. **Cross-field end date.** With Start date set, clear End date: the message
   "End date is required when a start date is set" appears under End date.
   Restore End date and the error clears.
7. **Accessibility.** Every field has a label; invalid fields set
   `aria-invalid` and `aria-describedby`; submitting an EDIT form focuses the
   first invalid field; the mode toggle restores focus after switching.
8. **Submit paths.** Submit in EDIT with a valid form; set Country to `ZZ` or
   press *Simulate server 422* and confirm the path-level server error appears.
   Switch to VIEW and submit without validation running.

## Fixture trust

Fixture data is demo-only. The document, its bindings, cascade source ids and any
URL-like values are treated as **untrusted input**: `parseDocument` fail-closes on
unsafe shapes and `sources` is a frontend registry id, never a URL. `sources.js`
contains in-module mocks with latency, and `createSaveEntity()` is deterministic
and local. **The demo makes no network requests.**
