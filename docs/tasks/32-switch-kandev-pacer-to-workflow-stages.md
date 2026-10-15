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
