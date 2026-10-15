---
depends-on: [31]
---

# Remove the sourceSection alias

Depends on [31] and on kandev-pacer issue 48 in `~/prg/kandev-pacer/TASKS.md`,
which was filed here as [32] until 2026-10-15. After Hai's own consumers and
kandev-pacer read `sourceState` and stages, drop the `sourceSection` read
alias and patch alias, the `--section` CLI alias and the `TaskSection` type,
and update the docs, the skill and the tests accordingly.

## Implementation, 2026-10-15

Removed `sourceSection` from TASKS.md reads, allowed mutation fields and the
shared issue type. The parser, mutations, backlog ordering, HTTP adapter and
remaining UI consumers use `sourceState`. Removed `TaskSection`, CLI `--section`
and the Python query's `section` filter. Updated current API/backend docs, the
repository skill and fixtures. Historical task and deployment notes retain their
original requirements and validation.

Regression tests require alias-free reads and reject alias-only and matching
state/alias patches without changing the source revision. CLI query/report reject
`--section`; state and stage filters still cover all three file workflows.

## Validation, 2026-10-15

55 Python tests, 100 TypeScript client/API tests, TypeScript checks and the
production build passed. Browser coverage passed 62/63 workflows after rerunning
two trace-output failures caused by overlapping validation runs. The remaining
ordinary-run failure is the previously documented Cycle 12 date assertion while
today is in Cycle 13. That workflow passed in a temporary copy with the clock
fixed to 2026-10-03; no unrelated test changes were retained.

Logs: `/tmp/hai33-check.log`, `/tmp/hai33-browser-rerun.log`,
`/tmp/hai33-fixed-cycle.log`. Predeployment backup:
`/tmp/hai33-before/source.tgz`.

## Completion and deployment, 2026-10-15

Rebased and fast-forward merged into main. Reinstalled Node dependencies, rebuilt
the main checkout and restarted `hai.service`. Loopback, private HTTP and private
HTTPS passed health checks, exact built HTML checks, catalog checks and alias-free
workspace reads. The canonical tracker was updated through the CLI to Completed /
Accepted with `[ ]`. A structured comparison confirmed every unrelated issue and
acceptance flag was preserved.

Deployment logs: `/tmp/hai33-main-install.log`, `/tmp/hai33-main-build.log`,
`/tmp/hai33-deploy.log`, `/tmp/hai33-smoke.log`.
