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
    validation              local rules for this field
    defaultValue            create mode
  rules
    visibility[]            condition -> field ids to hide
    cascades[]              condition -> writes to data paths
  validations[]             cross-field rules, each with dependsOn
```

Notes:

- Binding paths are **full paths**, supplied by the backend. The frontend does
  not derive slot suffixes.
- Field order comes from the document. The frontend does not sort.
- The document is versioned, immutable once published, and rolled back by
  version. The form stores the version it rendered.

---

## 5. Modes and permissions

Three inputs decide what a field shows. Resolve them in one place, in this order:

```text
form.mode === VIEW            -> VIEW
permission(field) missing     -> HIDDEN
visibility rule fails         -> HIDDEN
permission(field) === VIEW    -> VIEW
otherwise                     -> EDIT
```

**Invariant: the form can only demote, never promote.** A field never becomes
editable because the form is editable; it also needs its own permission. Hidden
beats view beats edit.

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

- **Conditions**: JSON Logic for simple cases, the vocabulary for complex ones.
  Both are JSON trees, so dependency collection and cycle detection work the same
  way for each.
- **Effects**: the vocabulary only, never JSON Logic. Effects need allowlisting,
  validation and static knowledge of what they touch.
- **Fail closed.** An unknown operator or unknown effect rejects the rule and
  records it. It is never ignored.

### Cascades

- Fire only when the user edits the source. Never on load. Stored data that
  violates a current rule stays as it is until someone touches the source.
- Always overwrite. The cascade wins over any value already in the target.
- Write to a data path, to one or many targets.
- Blocked when the target is HIDDEN or VIEW at fire time.
- Async: if the target is no longer effective EDIT when the result lands, discard
  it. If the array containing the target was reordered meanwhile, the path now
  points at a different item; re-resolve or cancel on array mutation.

### Visibility

- Condition evaluates against current form data; the effect hides field ids.
- Evaluated on every data change, not only on the source field's edit.
- Hiding does not clear the value. The value stays and is submitted.

---

## 7. Validation

- One JSON Schema, several fragments, assembled at load. AJV, sync rules only.
- Per-field rules live in `fields[].validation`. Cross-field rules live in
  `validations[]` and declare `dependsOn`.
- **Compile only effective-EDIT fields.** Hidden and VIEW fields never enter the
  compiled schema. This is what removes the classic hole where an `if` branch
  reads a hidden value and forces an error onto a visible field.
- A cross-field rule whose dependency is hidden is not compiled. That is the
  agreed meaning of "ignore".
- `required` is mode-derived, and falls out of the same filter: a field that is
  not compiled cannot be required.
- The assembler turns dotted paths into nested `properties` and `items`. This is
  the only non-trivial code in the validator, and it must handle arrays.
- Run debounced while editing, and again on submit.

Validation is declared per document version, not per session. Recompiling on
every keystroke is the failure to avoid; compile per document version and per
effective-EDIT set.

---

## 8. Submit

- The payload contains every stored value, including values in HIDDEN and VIEW
  fields. Nothing is stripped on the way out.
- Complex fields are not part of `properties`. They fetch and submit
  independently, register their own state, and receive the form data read-only.
- The form orchestrates: validate, then submit the entity and the complex
  fields, then report the outcome.

---

## 9. Out of scope, for now

- Validating the UI schema when it is authored. Deferred; the runtime must fail
  closed until it exists.
- Async validation rules such as uniqueness or remote checks.
- Whether a complex field may write into the form, and through which interface.
- Analytics and instrumentation.
- Multi-form pages and cross-form state.

---

## 10. Open items and accepted risks

**Open — decide before the first submit is written**

1. **Unbound properties.** If the entity holds a property that no field binds,
   is it echoed back on submit or dropped? Dropping it means the form silently
   destroys data it does not render.
2. **Partial failure.** The entity saves and a complex field fails, or the
   reverse. Is there a retry, a queue, or a visible partial-success state? No
   rollback is assumed.

**Accepted risks**

- **Async cascade sources are not allowlisted.** The administrator who authors
  the UI schema decides what the client fetches. Config can therefore point the
  client at arbitrary endpoints. Accepted; recorded here so it is not discovered
  later as a surprise.
- **No cascade on load.** Stored data can violate the current cascade rules until
  the source is edited.
- **Form size unknown.** Field count, nesting depth and array length have not
  been stated. The design assumes deep nesting and editable arrays; a number
  would change debounce and render strategy, not the rules above.

---

## 11. Invariants

Short list, worth checking against any implementation:

1. Form mode demotes, never promotes.
2. Permission is default-deny when the key is absent.
3. A cascade writes to a path; visibility hides a field.
4. A cascade only writes into an effective-EDIT target.
5. Validation compiles only effective-EDIT fields.
6. Hidden values are kept on submit; unsaved edits are discarded on toggling to
   VIEW.
7. Unknown rule operators and effects fail closed.
8. The field vocabulary is code and is versioned like an API.
