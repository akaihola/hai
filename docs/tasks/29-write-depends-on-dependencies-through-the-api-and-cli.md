`hai_tasks` reads `Depends on:` lines but cannot write them. `dependencies` is a
read-only field, so agents using `hai-tasks` must edit `TASKS.md` by hand to record
a dependency, which [23] set out to avoid. Found on 2026-10-14 while adding [28],
which builds on [22] but could not declare it.

## Requirements

- Accept `dependencies` in `create` and `update` patches as a list of issue
  numbers, matching the read model. An empty list removes all dependencies.
- Write them as one indented `- Depends on: [N], [M]` bullet under the summary, in
  the existing format. Leave the task block untouched when dependencies don't
  change.
- Keep `depends-on:` frontmatter in a numbered task's description file consistent
  with the bullet, as the tracker rules require.
- Reject unknown numbers, self-dependencies and cycles.
- Reject a write that would leave a dependent before its prerequisite in Ordered
  backlog, with the same error as `reorder`. Dependencies on issues in other
  sections are allowed.
- The HTTP API accepts the same field through the shared mutation code.
- Update `docs/python-api-cli.md` and `skills/hai-tasks/SKILL.md`, and cover the
  new field in `tests/python/` and the skill test.

Out of scope: a dependency control in the browser editor, and `Blocked by:` lines
in local Markdown issues.
