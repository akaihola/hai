When trying to open project ~/prg/filemill/, I got `A tracker source is missing, inaccessible, or a symbolic link.`

This error message doesn't help me to track down and fix the problem. It needs to be more specific.

## Implementation plan, 2026-10-04

Report the absolute failing path and the specific reason a tracker source cannot
be opened. For linked descriptions, include the TASKS.md path and numbered
reference so the user can locate the broken link. Keep filesystem restrictions
and HTTP status codes intact.

Read-only reproduction found that Filemill's tracker references the missing
`/home/agent/prg/filemill/docs/tasks/37-py-j2-highlighting.md` file. Do not modify
Filemill as part of this issue.

Validate missing files and directories, permissions, symbolic links, nonregular
files, size limits, and API error propagation. Run `npm run check` before merging
and deploying. Completion remains unchecked until user acceptance.


## Completion, 2026-10-04

Errors now identify the absolute source path and specific filesystem reason.
Linked-description failures name their TASKS.md and numbered reference. Symbolic
links, nonregular files, size limits, invalid UTF-8, unavailable project roots,
and unsafe description directories retain their existing restrictions and HTTP
status codes. Nonregular-file checks also close their file descriptor safely.

Filemill now reports the missing `docs/tasks/37-py-j2-highlighting.md` linked by
`[66]` in `/home/agent/prg/filemill/TASKS.md`. Filemill was inspected read-only.

`npm run check` passed 22 Python tests, 80 client/API tests, 46 Chromium workflows,
TypeScript checks and the production build. Added five Python regression tests
covering missing sources/directories, permissions, links, directories, FIFOs,
size limits, invalid encoding and HTTP error propagation. The Python suite
passed again after closing HTTP error responses in test cleanup.

Deployment passed health, HTML, unchanged unrelated issues and Filemill error
checks on loopback, private HTTP port 5173 and private HTTPS port 8443. Backups
and validation evidence are retained in `/tmp/hai-issue15-4s9p_dsu/`.
