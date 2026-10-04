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
