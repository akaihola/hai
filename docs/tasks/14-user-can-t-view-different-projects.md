For example, now I'd like to open ~/prg/drum-transcribe/ and work on its issues that are stored in the TASKS.md format.

## Implementation, 2026-10-03

Open another project with the sidebar's Open project button. Enter an absolute
server directory, a `~/` directory, or its `TASKS.md` path. Recent projects make
switching back easy, and the browser remembers the last successful selection.
The sidebar and breadcrumb identify the current project.

Each selection gets its own `WorkspaceBackend`. All reads, edits, reordering,
and exports stay bound to that canonical tracker. Switching clears the previous
project's editor, search, filters and navigation. Failed opens leave the current
workspace available; an unavailable remembered source shows an error without
silently substituting another project's issues.

The service permits the configured tracker and sibling projects by default.
`HAI_PROJECT_ROOTS` can specify other allowed roots, separated by the operating
system's path delimiter, `:` on gogo. Files and description links retain the
existing containment, regular-file and revision checks. Trackers must follow the
supported five-section TASKS.md format; opening a project does not rewrite it.
This is source selection, not creation of project/cycle records in TASKS.md.

The example `/home/agent/prg/drum-transcribe/` did not exist on this host during
implementation. Missing directories report an error; no example tracker is
created in its place. Automated workflows use temporary sibling projects.

## Validation, 2026-10-03

44 unit/API tests, 31 Chromium workflows, TypeScript and production build pass.
Browser checks ran with one worker and an isolated output directory after a
concurrent validation run collided with the default test artifacts. Later
filesystem review fixes passed the full unit suite and another production build.
The work is complete and remains unchecked pending explicit user acceptance.
