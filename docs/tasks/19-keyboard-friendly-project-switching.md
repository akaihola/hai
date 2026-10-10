Make project switching keyboard friendly:

- click on `Switch project`
- type a few unique leading characters of a project name, and they end up in the filter/search field
- hit Enter to switch to the first found matching project

## Implementation, 2026-10-10

Opening the picker focuses Find project. Typing filters the existing project
catalog by name or path, and Enter opens the first visible match through
WorkspaceBackend.openWorkspace. With no matches, Enter keeps the picker open.
The search field is disabled while opening a project, and composition Enter
does not trigger the shortcut. Direct path entry remains available.

Browser regressions cover immediate typing, a unique leading-name match,
multiple matches, no matches, reopening focus, and desktop/mobile Enter
switching. Existing tests cover direct paths, catalog errors, and isolation.

Validation passed with `npm run check`: 32 Python tests, 89 client/API tests,
TypeScript, the production build, and 59 Chromium workflows. Earlier runs hit
the previously documented oversized-request EPIPE failure. The initial focus
regressions also caught React autoFocus running before the native dialog opened;
the final implementation focuses the search field after Dialog's opening effect.
Full validation logs are in `/tmp/hai-19-check-verified.log`.


After rebasing onto main, the build and all nine project-switching workflows
passed again. Merged and deployed on 2026-10-10. Loopback and both private
endpoints passed health, exact HTML/assets, and workspace API checks. Issue 19
is completed and unchecked pending acceptance. See `docs/deployment.md` for
deployment evidence and backup locations.
