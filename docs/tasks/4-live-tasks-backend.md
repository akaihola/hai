---
depends-on: [2, 3]
---

# Edit the repository tracker from Hai

Use the real repository `TASKS.md` as the default data source through a local Node
service. Preserve Filemill section names, stable task identity, numbered reference
links, simple tasks, dependencies, description documents, rules, and unrelated text.

Completion and user acceptance are separate states. Moving a task to Completed /
Accepted must leave it unchecked. Do not fabricate projects, members, or cycles.
Expose unsupported fields and actions honestly in the frontend.

Read/write the configured tracker only. Validate requests, reject conflicting
revisions, atomically replace each changed file, and retain unrecognized metadata. Serve the production
frontend from the same service. Verify parser round trips, mutations, external
changes, request boundaries, and browser workflows against a temporary tracker.

## Completed 2026-10-03

Implemented the Node file service, HTTP adapter, native task sections, separate
acceptance action, exports, and source refresh. Revision checks cover the tracker
and descriptions. Per-file replacements are atomic; multi-file saves are not
crash-atomic. Guarded rollback preserves later external edits and reports partial
saves for review. See [backend behavior](../backends.md).

Validation passed 24 unit/API tests and 17 Chromium tests, plus TypeScript and the
production build. Production HTTPS edits persisted to the real tracker without
altering descriptions or accepting completed tasks.
