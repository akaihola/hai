# Drag issues between groups

Allow dragging an issue from one list group to another, for example from
Ordered backlog to Unverified proposals. Persist the move through
`WorkspaceBackend.updateIssue`, including the source section when two groups
share the same status.

Keep empty groups visible as drop targets and allow drops on collapsed group
headers. Highlight the destination while dragging. Preserve source-order backlog
reordering and its Alt+Up/Down controls. Other sort modes still allow group moves.
The issue editor remains available for keyboard and touch users.

Honor backend capabilities and reject moves of accepted issues. Moving work to
Completed / Accepted must leave it unchecked for user acceptance. Preserve task
identities, descriptions, dependencies, references, and unrelated tracker text.

## Implemented 2026-10-03

List and board views share the move guards and destination feedback. Empty list
groups remain visible unless a section/status filter excludes them. Moves persist
through the backend; accepted and read-only issues cannot be dragged.

`npm run check` passed 36 unit/API tests, 24 Chromium tests, TypeScript checks and
the production build. Browser regressions cover same-status section moves,
collapsed and empty destinations, alternate sorting, reload persistence,
acceptance, descriptions, read-only backends, and existing backlog reordering.
Desktop and mobile layouts were also checked. User acceptance remains pending.
