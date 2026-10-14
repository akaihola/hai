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
