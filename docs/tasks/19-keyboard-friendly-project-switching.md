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

