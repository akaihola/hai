# Eliminate runs of blank lines in TASKS.md

Allow max. one blank line between list items and around headings.

Apply this to tracker task separators and the six section headings whenever Hai
creates, edits, moves, deletes or reorders an issue. Keep task descriptions,
wrapped summaries, dependency bullets, metadata, reference links, unrelated prose
and the Rules body intact. Preserve LF and CRLF line endings and user acceptance.

## Implemented 2026-10-03

All write operations repair excessive task and section separators. Moving and
deleting tasks retain a paragraph break when either adjacent separator had one.
Insertion reuses the existing separator, preventing repeated writes from growing
blank-line runs. CRLF section boundaries now point before the entire line ending,
preventing duplicate carriage returns during insertion.

`npm run check` passed 36 unit/API tests, 24 Chromium tests, TypeScript checks and
the production build. Regressions cover
every mutation, repeated moves and metadata edits, LF and CRLF, task removal next
to prose, new description references, and preservation of inline descriptions,
code fences, metadata, rules and acceptance. User acceptance remains pending.
