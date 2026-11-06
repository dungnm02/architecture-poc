# Form Engine — Problem Statement

**Status:** requirements defined, no implementation started
**Scope:** one form engine for an entity with an open `properties` tree
**Last updated:** 2026-11-06

This note states the problem and the rules that must hold. It is not the
architecture report; that is
[config-driven-frontend-architecture.md](config-driven-frontend-architecture.md).
Nothing here is implemented.

---

## 1. The problem

The backend owns an entity whose body is open:

```text
entity
  id            fixed
  name          fixed
  properties    object of unknown keys, unknown nesting
                values may be scalars, objects or arrays
```

Today the frontend hardcodes one form per entity type. Every new property, group,
cascade rule or permission variation becomes a frontend change and a deploy.

The goal is **form generation**: the backend sends a UI schema at runtime, and a
generic engine composes the form from a vocabulary of field types that the
frontend owns.

The engine serves create, edit and view with the same document and the same
rendering path. Only the data, the permission payload and the form mode differ.

### What is fixed, what is sent

| Fixed in frontend code | Sent at runtime |
|---|---|
| field vocabulary: types, slots, slot types, VIEW and EDIT renderers | field instances, their order and their bindings |
| rule vocabulary: conditions and effects | rules built from that vocabulary |
| rule evaluation, validation assembly, submit orchestration | per-field and per-form validation rules |
| permission default (deny) | permission keys and modes |

A field type is code. A field instance is data. That boundary is the whole design.

---

## 2. Identifiers

Two identities, used for different things. Do not mix them.

| Identifier | Example | Used by |
|---|---|---|
| **data path** | `properties.address.city` | binding, cascade target, validation |
| **field id** | `addressCity` | permission, visibility target, render keys |

A cascade writes to a **data path**, because the data is the thing that changes.
Visibility and permission act on a **field id**, because they decide what is
rendered. Two fields can bind the same path; both must reflect a write to it.

---

## 3. Field vocabulary

The frontend registry maps a type key to one entry:

```text
InputWithNA
  slots
    value   -> string
    isNA    -> boolean
  VIEW      renderer for read-only
  EDIT      renderer for editing
```

Rules:

- A slot declares its expected type. The engine validates the slot on first
  render.
- VIEW and EDIT are separate renderers, not a disabled input.
- A registered type is a public contract. Renaming or removing one is a breaking
  change and needs a deprecation window.

### Binding validation, first render

| Case | Result |
|---|---|
| path exists, type matches slot | render |
| path missing | valid; slot value is `undefined` — normal in create mode |
| path exists, type mismatched | render the degraded form of the field, record it |

Validation is per slot and runs once per field instance per document version.
It does not run again on every render.

---

## 4. The UI schema

One merged document. The frontend consumes it as a unit; where the backend merges
validation into it is not the frontend's concern.

```text
document
  id, version
  fields[]                  ordered
    id
    type                    registry key
    binding                 slot -> full data path, declared explicitly
    permissionKey
    validation              slot -> local fragment for that slot
    defaultValue            create mode
    label, help, props      presentation metadata
  rules
    visibility[]            condition -> field ids to hide
    cascades[]              condition -> writes to data paths
                            effect: kind, target, source id, params
  validations[]             cross-field rules: target + dependsOn
```

Notes:

- Binding paths are **full paths**, supplied by the backend. The frontend does
  not derive slot suffixes.
- Validation is declared per slot, not one fragment per field. Cross-slot logic
  goes through `validations[]`.
- Cascade `effect.source` is a **source id** resolved by the frontend, never a
  URL. `effect.params` lists the only data paths that may leave the client.
- A repeat group declares `itemKey` (an optional stable item id path) and a
  template of child fields with relative bindings.
- Field order comes from the document. The frontend does not sort.
- The document is versioned, immutable once published, and rolled back by
  version. The form stores the version it rendered.

---

## 5. Modes and permissions

Three inputs decide what a field shows. Resolve them in one place, in this order:

```text
permission(field) missing     -> HIDDEN
permission not EDIT or VIEW   -> HIDDEN   (allowlist, never truthy)
visibility rule fails         -> HIDDEN
ancestor group HIDDEN         -> HIDDEN
permission(field) === VIEW    -> VIEW
ancestor group VIEW           -> VIEW
form.mode === VIEW            -> VIEW
otherwise                     -> EDIT
```

`permissionKey ?? fieldId` selects the grant. Grants are read through a `Map` or
with an own-property check, never a plain-object lookup.

**Invariant: the form can only demote, never promote.** A field never becomes
editable because the form is editable; it also needs its own permission. Hidden
beats view beats edit, and a hidden group hides every child.

**Permission is not authorization.** The client loads entity values and submits
hidden ones. A denied user can still read those values in the API response or
the browser payload. This model is only safe if the server omits unauthorized
values on read and enforces field-level authorization on write.

Consequences that follow, and are therefore not separate rules:

- Validation covers **effective EDIT** only. When the form is VIEW, nothing
  validates.
- A cascade writes only into an effective-EDIT target.
- An async result is discarded when its target stopped being effective EDIT.

### Lifecycle

- The form mode changes on user action only. It never flips mid-typing.
- Toggling EDIT to VIEW **discards unsaved changes**, behind the existing
  form-level warning. Values loaded from the backend are not discarded; only
  edits that were never saved.
- Toggling unmounts every field and mounts the other renderer. Form state lives
  above the renderer, in the store, or it is lost on every toggle.
- Submit is available in VIEW mode. It sends the current data unchanged and runs
  no validation, because no field is effective EDIT.

---

## 6. Rules

One shape for both visibility and cascades:

```text
rule
  when    condition
  then    effect[]
```

- **Conditions**: a frontend-owned, closed condition tree. The vocabulary is
  fixed in code: `eq`, `neq`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`, `empty`,
  `and`, `or`, `not`. Conditions are JSON trees, so dependency collection works
  on every path they read.
- **Effects**: the vocabulary only, never conditions. Effects need allowlisting,
  validation and static knowledge of what they touch.
- **Fail closed.** An unknown operator or unknown effect rejects the rule and
  records a blocking issue. It is never ignored.

### Cascades

- Fire only when the user edits the source. Never on load. Stored data that
  violates a current rule stays as it is until someone touches the source.
- Always overwrite. The cascade wins over any value already in the target.
- Write to one or many **leaf** data paths. Container targets are rejected at
  parse; there is no deep-merge semantics.
- `effect.source` is a frontend source id, never a URL. Only the paths declared
  in `effect.params` leave the client; never the whole form.
- Blocked when the target is HIDDEN or VIEW at fire time.
- Async: capture an epoch, a per-target run id, the source value and the item
  identity. At landing, require all of them to still hold: the run is the latest
  for the target, the epoch is current, the target is still effective EDIT, the
  item key still matches, and `when` still holds. Otherwise discard.
- Array mutation, reset, mode change, document change, submit and unmount bump
  the epoch and abort pending runs. A normal abort is not an error.

### Visibility

- Condition evaluates against current form data; the effect hides field ids.
- Evaluated on every data change, not only on the source field's edit.
- Hiding does not clear the value. The value stays and is submitted.
- Visibility targets whole fields or whole groups. It never targets a template
  child; per-item visibility is rejected at parse, because validation and array
  identity assume uniform rows.

---

## 7. Validation

- One JSON Schema, several fragments, assembled when the effective-EDIT set
  changes. AJV, sync rules only. The resolver validates the full values object;
  no projection.
- Per-slot rules live in `fields[].validation`. Cross-field rules live in
  `validations[]` and declare both a `target` and `dependsOn`.
- **Compile only effective-EDIT fields.** Hidden and VIEW fields never enter the
  compiled schema.
- Per-slot fragments are restricted to a closed keyword subset and to the
  field's own binding and descendants. Forbidden: `if`/`then`/`else`, `$ref`,
  `$data`, `dependent*`, `propertyNames`, `additionalProperties`,
  `unevaluatedProperties`. Cross-path logic goes through `validations[]`. This
  is what closes the hidden-sibling hole; filtering fields alone does not.
- A cross-field rule is compiled only when its target and every dependency are
  effective EDIT. Otherwise an invisible field can block submit with no message.
- `required` means non-empty, not merely present: inject `minLength: 1` for
  strings, `minItems: 1` for arrays, and reject `null` for nullable slots. `0`
  and `false` stay valid. Whitespace-only strings count as non-empty in v1.
- The assembler turns dotted paths into nested `properties` and `items`, emits
  one uniform `items` schema per repeat template, and never emits
  `additionalProperties: false`.
- Unmappable errors go to a form-level error banner, never dropped.
- Run debounced while editing, and again on submit.

Validation is declared per document version, not per session. Recompiling on
every keystroke is the failure to avoid; compile per document version and per
effective-EDIT set.

---

## 8. Submit

- The payload contains every stored value, including values in HIDDEN and VIEW
  fields and unbound entity properties. Nothing is stripped on the way out.
- Complex fields are not part of `properties`. They fetch and submit
  independently, register their own state, and receive the form data read-only.
  They do not write form values in v1.
- The form orchestrates: validate AJV, validate complex fields, settle pending
  cascades, save the entity, submit complex fields with the saved entity, then
  reset the baseline. Partial failure is reported per handle; there is no
  rollback.
- VIEW submit saves the current data unchanged. It runs no validation.

---

## 9. Out of scope, for now

- Validating the UI schema when it is authored. Deferred; the runtime must fail
  closed until it exists.
- Async validation rules such as uniqueness or remote checks.
- Whether a complex field may write into the form, and through which interface.
- Nested repeat groups, flat scalar arrays and per-item visibility. All are
  rejected at parse in v1; each needs its own spike.
- AJV `format` and calendar-aware date validation.
- Analytics and instrumentation.
- Multi-form pages and cross-form state.

---

## 10. Decisions and accepted risks

**Resolved**

1. **Unbound properties: preserved.** Seed the whole entity into
   `defaultValues`, never emit `additionalProperties: false`, and submit
   `getValues()`. Dropping unbound data is the worse failure.
2. **Partial failure: reported, no rollback.** The entity saves first; complex
   fields submit second. `ok` is false with per-handle detail, and failed
   handles can be retried.
3. **Complex write interface: none in v1.** Complex fields read form values only.

**Accepted risks**

- **Cascade source choice stays with the document author.** Sources resolve
  through a frontend registry, so the frontend owns the code, but the document
  still chooses which registered source runs. Payload minimisation is mandatory:
  only declared `params` paths leave the client.
- **No cascade on load.** Stored data can violate the current cascade rules until
  the source is edited.
- **Backend regexes can backtrack.** Pattern length is capped, but production
  should precompile patterns server-side or use RE2.
- **Form size unknown.** Field count, nesting depth and array length have not
  been stated. The design assumes deep nesting and editable arrays; a number
  would change debounce and render strategy, not the rules above.

---

## 11. Invariants

Short list, worth checking against any implementation:

1. Permission is checked first; form mode and ancestors only demote.
2. Permission is default-deny when the key is absent or not `EDIT`/`VIEW`.
3. A cascade writes to a leaf path; visibility hides a field or group.
4. A cascade only writes into an effective-EDIT target.
5. Validation compiles only effective-EDIT fields, and the compiled schema
   observes only their subtrees. Per-item visibility is forbidden.
6. Hidden values are kept on submit; unsaved edits are discarded on toggling to
   VIEW.
7. Unknown rule operators and effects fail closed.
8. The field vocabulary is code and is versioned like an API.
9. Invalid documents fail closed: no partial form, submit disabled.
10. `required` means non-empty, not merely present.
11. Unbound entity properties survive submit.
12. Cascade sources are registry ids; only declared params leave the client.
