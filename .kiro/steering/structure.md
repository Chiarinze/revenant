---
inclusion: always
---
# Project structure

revenant/
- .kiro/ : steering, specs and hooks. Always committed, never gitignored.
- packages/core/ : the skeleton (schema and merge rules, local store, sync adapter, sync status).
- apps/stock-book/ : demo app 1.
- apps/health-log/ : demo app 2.
- server/ : the sync server.
- docs/ : architecture notes for the write-up.

## Conventions
- Feature-based folders inside each package, for example packages/core/src/counter/ and packages/core/src/sync/.
- Tests sit next to the code they test, named *.test.ts.
- Core's public API is exported only from packages/core/src/index.ts.
- Apps contain only their UI and their own schema declaration.
- File names in kebab-case, React components in PascalCase, functions and variables in camelCase.