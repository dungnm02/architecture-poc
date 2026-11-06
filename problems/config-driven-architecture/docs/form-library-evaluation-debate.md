# Form Library Evaluation — Debate Supplement

**Decision note**
Status: debate complete, verdict upheld, no implementation started
Supplements: [form-library-evaluation.md](form-library-evaluation.md)
Last updated: 2026-11-07
Revision: independent review of the §8 verdict and §9 gates

This note records an adversarial review of the evaluation. Two reviewers read the
same document independently, exchanged one rebuttal each, and two judges scored the
result. It adds no new research; it tests whether the original verdict survives
challenge.

**Result: React Hook Form, behind `useSlot(path)`. The original verdict holds.
Both reviewers and both judges reached the same choice. The margin is adoption and
migration surface, not resolver design.**

---

## 1. What the debate changed

The evaluation's reasoning survives, with three corrections:

1. **Resolver fit is smaller than §8 implies.** TanStack's form-level validator can
   call AJV and read the current EDIT set. Both libraries still need the same AJV
   error-path mapping (`/properties/x/value` to dotted names). RHF's advantage is a
   shipped adapter and a documented seam, not a capability TanStack lacks.
2. **Flat scalar arrays are the one place TanStack is clearly ahead.** The
   `{ value: scalar }` wrapper is contained by `useSlot`, but not free: it changes
   AJV error paths, needs wrap/unwrap on reset and submit, and must define append
   defaults. If the wrapper reaches the payload or backend contract, the objection
   becomes real.
3. **VIEW retention (spike check 3) deserves equal weight.** The evaluation's own
   caveat says `shouldUnregister` and `reset` behavior is version-sensitive. Losing
   an unmounted value across a VIEW toggle breaks more than a field-array wrapper
   does.

Adoption remains the tie-breaker. The evaluation already warns it is not a fitness
proof; the debate agreed, and still ranked it above model elegance because the engine
will be read by people who did not write it.

---

## 2. Case for React Hook Form

- Validation is one seam: a resolver function the engine owns, swapped when the
  effective-EDIT set changes. `@hookform/resolvers` already ships AJV support.
- The primitives map directly: 2 × `useController` per `InputWithNA`, `setValue` by
  path for cascades, `shouldUnregister: false` for VIEW retention, `getValues()` for
  VIEW submit.
- Object-array handling is mature, and the render key is not payload.
- Stronger adoption signal: 209M downloads/month, Thoughtworks "adopted", named
  enterprise sponsors. Better debugging evidence for a generated-field bug.
- RHF v8's breaking changes are mostly field-array keys; TanStack v2 alpha rewrites
  arrays, listeners, stores, and validators — the exact APIs this engine depends on.

---

## 3. Case for TanStack Form

- Native flat scalar arrays; no wrapper, no altered error paths.
- Store-based model and explicit array API are cleaner than RHF's refs and proxies.
- A form-level validator is a first-class function; using AJV there is workable.
- v1 is stable. The case weakens because v2 alpha is already churning the APIs the
  engine would lean on.

**Choose TanStack instead if** flat scalar arrays are in scope and RHF v8 beta is not
acceptable, or if the team is fluent in TanStack Store and accepts the v2 alpha
migration. Do not choose it only to avoid the wrapper; the wrapper is bounded.

---

## 4. Decision and gates

Stay with React Hook Form. Before implementation, run the one-day spike from §9.
The debate narrowed the gates to:

| Gate | Flip if |
|---|---|
| 3. VIEW retention | unmounted values do not survive a VIEW toggle |
| 4. Resolver swap | swapping on EDIT-set change does not revalidate |
| 5. Flat arrays | `string[]` is required, v8 beta is unacceptable, and wrapping leaks into payload or error paths |
| 6. Array identity | the render key shadows a real payload `id` and the `keyName` workaround leaks |

Two or more failures across checks 3–6 reopen the decision. A single failure on check
3 or 4, or a leaking wrapper/key, is enough to switch. Otherwise the remaining
differences are preference.

---

## 5. Caveats

- Both reviewers and judges worked from this repository's evaluation, not from live
  package checks or benchmarks. No render measurement was taken.
- Both libraries have a major in flight: RHF v8 beta and TanStack v2 alpha. Pin the
  version and budget a migration either way.
- The debate did not test `shouldUnregister` or TanStack `reset` behavior. Confirm
  both in the spike.
- The verdict is reversible by design: keep `useSlot(path)` as the adapter boundary.
