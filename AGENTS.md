# AGENTS.md

## What this repo is

A learning playground for React frontend patterns and architecture. Each experiment
tests one pattern or architectural approach, so I can understand the tradeoffs and
apply what works at my job. This is not a production app and not a shared product:
correctness of a demo matters less than showing a pattern clearly.

## Stack

- React 19 (`react`, `react-dom`), plain JavaScript (`.jsx`, no TypeScript yet)
- Vite 8, `@vitejs/plugin-react`
- ESLint 10 flat config (`eslint.config.js`), `react-hooks`, `react-refresh`

## Commands

```bash
npm run dev      # start dev server (HMR)
npm run build    # production build
npm run lint     # eslint .
npm run preview  # serve the build
```

## Layout

```
src/
  main.jsx       # entry, mounts <App /> in StrictMode
  App.jsx        # root component / demo switchboard
  index.css      # global styles
  assets/        # images, svgs
public/          # static files served as-is
problems/        # one folder per design problem, each with its own README.md
```

## Working here

- One pattern per experiment. Keep each demo self-contained under `src/` (e.g.
  `src/patterns/<name>/`) so experiments never import each other and one can be
  read or deleted without touching the rest.
- Show the pattern, not a framework. No state library, router, or data layer
  unless that library *is* the pattern being tested.
- Prefer repetition over premature abstraction across demos. Two similar demos are
  fine; a shared helper for them usually hides the very difference being studied.
- When a demo makes a design choice, add a short comment on the tradeoff and when
  it would (or would not) apply at work. This is the point of the repo.
- Keep `App.jsx` a plain list/switchboard of demos, not a place for pattern logic.
- Match existing code style: functional components, hooks, 2-space indent, no
  semicolons, named `export default` for components.

## Guardrails

- No secrets, no real API keys. Use mocks or public endpoints.
- Don't delete an existing demo to make room for a new one; add alongside.
- Don't introduce build config, aliases, or new tooling for a single demo without
  saying why in one line.
- Run `npm run lint` before finishing a change.
