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
