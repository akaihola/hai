Even though both Completed and Accepted tasks are in the same section in `TASKS.md`, separate them into their own groups in the Hai UI. This allows filtering out the Accepted group when viewing the list of issues.

## Implementation, 2026-10-03

List and board views split `Completed / Accepted` by the issue's acceptance flag.
The Completed and Accepted tabs and Section filter select each group separately;
Hide accepted removes accepted work while retaining other sections.

The source Markdown section and acceptance checkboxes stay unchanged. Moving or
creating an issue in Completed leaves it unchecked. Accepted is not a creation or
drag destination; acceptance still requires the explicit editor action.

## Validation, 2026-10-03

44 unit/API tests, 31 Chromium workflows, TypeScript and production build pass.
Browser checks ran with one worker and an isolated output directory after a
concurrent validation run collided with the default test artifacts. Later
filesystem review fixes passed the full unit suite and another production build.
The work is complete and remains unchecked pending explicit user acceptance.
