---
inclusion: always
---
# Tech stack

- Language: TypeScript in strict mode everywhere.
- Monorepo: pnpm workspaces.
- Apps: Vite + React, built as installable PWAs (web manifest and service worker) that load and run offline after the first visit.
- Styling: Tailwind CSS.
- Shared data: Yjs (Y.Doc, Y.Map, Y.Array, Y.Text).
- On-device storage: y-indexeddb.
- Sync server: not chosen yet. Apps reach it only through one sync adapter in packages/core, so the server can change without touching the apps.
- Tests: Vitest for unit tests, fast-check for property-based tests.

## Rules
- packages/core must not depend on React or on any app. Apps depend on core, never the other way round.
- Apps never write their own merge logic. Merge behaviour comes only from the rules declared through core.
- Counters live in core as one tally per device, summed to get the total, because Yjs has no counter type.
- Never use device clock time to decide which edit wins.
- Anything that merges needs property-based tests proving convergence: any order, any grouping and duplicate updates all produce identical data.
- Explain why before adding a dependency. Prefer small, well-maintained ones.
- No secrets in the repo. Configuration comes from environment variables.