# Handoff — config-driven form engine

**Status:** design resolved, no implementation started.
**Date:** 2026-11-07.
**Next session:** start the slice, or sync the TanStack note first.

This file is the entry point for the next session. It records what changed, why,
and where to continue.

## What happened

1. `rhf-form-engine-design-review.md` raised 14 blockers against the RHF form
   engine design.
2. The blockers were resolved through a two-side debate. Both judges selected
   debater B's final position (A's architecture plus corrections).
3. `rhf-form-engine-design.md` was rewritten as rev 2 with the resolved
   contract.
4. `problem-form-engine.md` was updated to match: mode order, closed condition
   vocabulary, validation rules, submit decisions, invariants.

## Files

| File | State |
|---|---|
| `docs/rhf-form-engine-design.md` | **rev 2**, the implementation contract |
| `docs/problem-form-engine.md` | requirements synced with rev 2 |
| `docs/rhf-form-engine-design-review.md` | body unchanged; status line says resolved |
| `docs/tanstack-form-engine-design.md` | stale banner added; body not synced |
| `docs/form-library-evaluation.md` | unchanged; RHF verdict stands |
| `README.md` | indexes all docs |

## Resolved decisions worth remembering

- Mode is a lattice: permission allowlist → visibility → ancestor → form mode.
  Missing or invalid grant is HIDDEN in every mode. `permissionKey ?? fieldId`.
- Client permission is rendering, not authorization. Server must omit
  unauthorized values.
- Validation does **not** project values. A closed leaf-only fragment vocabulary
  prevents sibling observation; cross-field rules are engine rules with
  `target` + `dependsOn`.
- `required` injects non-empty rules; `''`, `null`, `[]` fail.
- Cascades use frontend source ids, declared `params` only, and an epoch plus
  per-target run token. No arbitrary URLs.
- Submit is a locked pipeline; VIEW saves only, with no validation or complex
  work. Complex `validate()` and `submit(entity)` are split.
- `writeSlots(writes[])` is the only write path: all slots, one cascade pass,
  one validation schedule. No `{target}` wrapping on `setValue`.
- Repeat groups use `Scope`, `keyName: '__key'`, `newItem()`. No per-item
  visibility, nested groups, or flat scalar arrays in v1.
- JSON Logic is dropped for a closed in-repo evaluator with caps.
- Plain JS + JSDoc, `react-hook-form@^7.91.0`, `ajv@^8.17.1`, `node --test`.
  No TypeScript, Vitest, RTL, or `ajv-formats`.

## Next session

Build order in `docs/rhf-form-engine-design.md` §22:

1. **S1** — paths, document parse/validation, modes, permissions; pure tests.
2. **S2** — validation assembly, sync resolver, error mapping; pure tests.
3. **S3** — `FormHost`, `useSlot`, registry, visibility, render counter.

Install the two dependencies when S1 starts. Do not add other tooling.

Open questions, all deferred deliberately:

- `messageFor` ownership (frontend now, backend later).
- Partial-failure retry UI.
- Whitespace-only required strings.
- Complex field write interface.
- RHF v8 migration.

## Verification

```bash
npm run lint
npm test
```

No code was added this session, so both should pass unchanged.

## Risks to keep visible

- `trigger()` render fan-out is unmeasured until the S3 counter runs.
- Date patterns accept invalid calendar dates.
- Backend regexes can backtrack; cap length, prefer server-side or RE2.
- Numeric object keys (`2024`) cannot be bound; fails loud by design.
