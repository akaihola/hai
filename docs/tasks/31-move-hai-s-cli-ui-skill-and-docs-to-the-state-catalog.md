---
depends-on: [30]
---

# Move Hai's CLI, UI, skill and docs to the state catalog

Builds on [30]. Once every backend declares `sourceStates` with stages,
Hai's own consumers should stop special-casing TASKS.md sections.

## Requirements

- CLI: `--state` filters by native state name and `--stage` by the stage
  vocabulary, on `query` and `report`. `--section` becomes an alias of
  `--state` and is marked deprecated in help text. Reports count by state.
- UI: list groups, board columns, editor selections and drag targets come
  from `capabilities.sourceStates` for every backend. Remove the hard-coded
  `TASK_SECTIONS` grouping; the Completed and Accepted split comes from the
  acceptance flag. All projects groups issues by stage, so different
  providers share columns.
- Skill: rewrite the `hai-tasks` examples so one set of commands works on
  TASKS.md, `.scratch/` and `docs/backlog/` sources, selecting states by
  stage from `read` output. Keep the skill test executing every example.
- Docs: `docs/python-api-cli.md` and `docs/backends.md` describe the catalog,
  the stage vocabulary and the filters; README mentions the shared model.
- Tests cover the CLI filters, the UI grouping on all three workflows and the
  skill examples.

## Implementation and validation, 2026-10-15

CLI query/report filters resolve native names and stages through the source
catalog. `--section` is a deprecated state alias; reports expose `byState`.
The UI uses catalog entries for groups, editor choices and drag destinations.
Acceptance remains a separate flag. All projects derives stage groups per
source, preserving native states even when names collide across providers.

The skill uses one executable command sequence for TASKS.md, scratch and docs
sources, with fresh revisions and state selection by stage. Its test executes
every Bash block on each workflow. CLI regressions cover every catalog entry;
UI regressions cover all workflows, acceptance and mixed-source stage collisions.

Validation: 55 Python tests, 100 TypeScript client/API tests, TypeScript checks
and the production build passed. `npm run check` passed 61/63 Chromium workflows;
a demo export-label regression was fixed and its workflow passed on rerun,
bringing passing coverage to 62/63. The remaining failure is the previously
recorded date-dependent Cycle 12 assertion, while today is in Cycle 13.
Logs: `/tmp/hai31-check.log`, `/tmp/hai31-final-unit.log`,
`/tmp/hai31-final-build.log`, `/tmp/hai31-readonly-rerun.log`.
