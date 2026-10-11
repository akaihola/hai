Deleting an issue that has a description file removes its bullet from TASKS.md, but
leaves its `[N]: docs/tasks/N-….md` link and the description file behind. Remove
both when the issue is deleted, and keep its number reserved.

## What happened, 2026-10-10

Antti deleted test issues in the Hai web UI: [24] and [25] in this tracker, and
[45] in `~/prg/kandev-pacer/TASKS.md`. Each one left its link line in TASKS.md and
an untracked file under `docs/tasks/`: `24-this-is-a-test-issue.md`,
`25-test-issue.md` and `45-test-issue.md`. [45] was cleaned up by hand in
kandev-pacer commit `ee64311`. [24] and [25] are still in this checkout.

The leftovers also make the checkout dirty. kandev-pacer's T3 pacer schedules work
only from a clean checkout, so it skips the tracker until someone removes or commits
the stray file.

## Reproduction

The web UI deletes through `DELETE /api/issues/:id` in `hai_server/http.py`, which
calls `TasksStore.mutate("delete", ...)`. On a scratch tracker:

1. Create an issue with a description. `[1]: docs/tasks/1-test-issue.md` and the
   file appear.
2. Delete it. The bullet is gone, but the link and the file stay, and
   `hai:reserved-numbers:1` is kept.

## What to change

- On delete, remove the issue's own reference link and description file, unless
  another issue still uses them.
- Keep the number in `hai:reserved-numbers`, as now, so it is never reused.
- docs/backends.md says that file mutations preserve unrelated reference links. The
  deleted issue's own link isn't unrelated, so say what delete removes.

## Implementation and validation, 2026-10-11

Deletion removes the issue reference and unused description file, preserves shared
references and files, and retains the reserved-number ledger. File removal uses
the store rollback checks; a recreated file is preserved on partial failure.
GitHub mutations stage the description deletion along with the tracker.

`npm run check` passed 38 Python tests, 90 client/API tests, TypeScript, the
production build, and all 61 Chromium workflows. Regression coverage includes
shared references and descriptions, CRLF and rules preservation, retired-number
allocation without Git, deletion failures, rollback and GitHub persistence.
The first full run also hit the previously documented oversized-request EPIPE
failure; the complete rerun passed. Validation log: `/tmp/hai26-check-rerun.log`.
