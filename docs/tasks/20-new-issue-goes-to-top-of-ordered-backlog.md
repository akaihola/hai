A new issue created through the UI should go at the bottom of the ordered backlog instead.

## Implementation (2026-10-10)

- `hai_tasks/markdown.py` `mutate_tasks`: a created issue destined for
  `Ordered backlog` is inserted after the last task in that section. Moves into
  the section keep the previous behaviour (top of section, after prerequisites).
- Regression test in `tests/tasks-markdown.test.ts`; behaviour note in
  `docs/backends.md`.
