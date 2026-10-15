---
depends-on: [30]
---

# Switch kandev-pacer to workflow stages

Builds on [30]. The code lives in `~/prg/kandev-pacer`, filed here at the
user's request because it is the main external consumer of `hai_tasks`.

kandev-pacer selects and moves work by comparing `sourceSection` strings in
`t3.py`, `heartbeat.py` and `tasks_md.py`, so it can only pace TASKS.md
trackers. With stages it needs one code path for every backend.

## Requirements

- Eligible issues are those whose state has stage `ready` or `scheduled` and
  whose dependencies are done, read from the catalog instead of section names.
- Scheduling moves an issue to the catalog state with stage `scheduled` when
  the workflow has one, and is otherwise a no-op that keeps the issue in its
  `ready` state.
- The worker prompt and the heartbeat name the `active` and `done` states
  from the catalog instead of hard-coding In Progress and Completed /
  Accepted, and keep the acceptance rule only where `fields.accepted` is set.
- Pacing `.scratch/` features and `docs/backlog/` repositories works without
  provider-specific branches, including `ready-for-human` staying untouched.
- Tests cover eligibility and scheduling on all three workflows.

## Implementation and validation, 2026-10-15

Implemented in kandev-pacer commit `990d23d`, merged to its main branch.
Eligibility uses catalog stages, with scheduled work first and dependencies
completed within the same project. Scheduling leaves ready issues unchanged
when no scheduled stage exists. Both T3 and heartbeat prompts name catalog
active/done states and condition the acceptance rule on `fields.acceptance`.
T3 opens sources through Hai and resolves the Git root independently of the
source directory. Heartbeat discovers TASKS.md, scratch and backlog sources.

Validation: the full offline suite passed 856 tests, with 20 live tests skipped.
The final focused suite passed 158 tests, including real files, scheduling,
T3 launches and heartbeat prompts for all three workflows. Formatting and
Ruff/type checks passed with `darker --check` and `graylint`. Tests also cover
missing, unfinished and other-project dependencies. Scratch waiting states
remain untouched. Unrelated kandev-pacer TASKS.md edits were preserved exactly.

The manually started pacer process still needs an operator restart to load the
merged Python code. New CLI invocations use it immediately. No Hai application
code changed, so no Hai application deployment is needed. Completion does not
record user acceptance.
