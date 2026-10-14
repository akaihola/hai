Support a backlog structure like the one used in `~/repos/nixos-config/`. Hai should function similarly to with `TASKS.md` so callers of `hai-tasks` (like kandev-pacer) can easily operate on tasks/issues.u
## Implementation plan, 2026-10-14

The nixos-config repository keeps one Markdown document per work item under
`docs/`, and the directory is the status: `issues/` (the inbox), `ideas/`,
`backlog/`, `in-progress/`, `completed/` and `rejected/`. `docs/README.md` and the
per-directory READMEs describe the criteria; the `/move-doc` skill moves files.
The file name is the identity and the first `# ` heading is the title. There are
no IDs, status fields or Hai metadata comments inside the files.

- Add a `BacklogStore` beside `ScratchStore`, opened from `<repo>/docs`,
  `<repo>/docs/<state>`, or a project directory that has `docs/backlog/` and no
  `TASKS.md`. Expose it through `open_source`, the CLI, the HTTP service and
  project discovery.
- Report `workflow: backlog` with the six directories as `sourceStates`:
  `issues` and `ideas` are Backlog, `backlog` is Todo, `in-progress` is In Progress,
  `completed` is Done and `rejected` is Canceled. Changing `sourceState` moves the
  file between directories without renaming it.
- Skip `README.md`, `.gitkeep` and non-Markdown entries. Use the first `# `
  heading as the title and fall back to the file name. Title edits rewrite or
  insert that heading; description edits replace the body; everything else in the
  file is preserved. Hai does not enforce the move-doc transition checklists.
- Revisions cover every document in the six directories. Writes use the shared
  advisory lock, atomic staging, no-overwrite publication and the same regular-file
  and symlink checks as the other local backends.
- Add `--state` filters to `query` and `report`, reuse the browser's source-state
  UI, and document the backend in `docs/backends.md`, `docs/python-api-cli.md` and
  the `hai-tasks` skill.

## Completion and validation, 2026-10-14

Implemented `hai_tasks/backlog.py` (`BacklogStore`), source detection in
`open_source` and the HTTP service, `<repo> / docs` entries in project discovery,
a `--state` filter for `query` and `report`, and browser support through the
existing source-state UI. Reading `~/repos/nixos-config` returns 276 documents
across the six directories; a file name that exists in two directories (one real
case in that repository) is identified as `<state>/<name>` instead of failing.

Validation in the feature worktree:

- Python: 49 tests passed, including 11 new backlog tests covering moves,
  retitling, body rewrites, creation, deletion, duplicate names, stale revisions,
  concurrent writers, invalid fields, symlinks, rollback, the CLI filter and HTTP.
- TypeScript: `tsc --noEmit` and the Node unit tests passed; the known flaky
  large-request test failed once and passed on rerun.
- Build and Playwright: 62 of 63 browser tests passed, including the new
  `backlog-backend.spec.ts`. The failing `workspace.spec.ts` cycle assertion is
  pre-existing and date-dependent: the demo seed's Cycle 12 ended 2026-10-11, so
  Cycle 13 is current now. It is unrelated to this issue and was left unchanged.

Out of scope: kandev-pacer still selects work by `sourceSection`; backlog sources
expose `sourceState` instead, so the pacer needs its own follow-up to pace them.
