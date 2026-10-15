---
name: hai-tasks
description: >-
  Use for TASKS.md with Hai sections and hai: metadata comments, or prompts mentioning hai_tasks or hai-tasks.
  hai_tasks is a Python package; hai-tasks is its CLI, not an MCP tool.
---

# Hai tracker commands

Use `hai-tasks` for tracker mutations instead of editing Markdown by hand.
Hai trackers have workflow sections and `<!-- hai:` metadata comments.
Read the target tracker's `## Rules` before changing it. Those rules govern
the workflow; this skill only explains the commands.

If the CLI is missing from PATH, use `python3 -m hai_tasks` from a Hai checkout
or an environment where the package is installed. If neither works, report
the missing installation and stop tracker writes.

## Revision loop

Set `SOURCE` to the intended tracker path or project directory. In a feature
worktree, use its tracker for worktree changes. Run either command:

```bash
hai-tasks read "$SOURCE"
hai-tasks query "$SOURCE" --no-accepted
```

Read `revision` and the issue's stable `id` from the result. Query rows include
their own source and revision. Set `REVISION` and `ISSUE_ID` to those values,
not the display number such as `[23]`. Make one mutation with `--revision`,
then run `read` again before the next mutation, even if the write returned a
revision. The commands below are separate examples, each requiring a fresh read.

## Common moves

`sourceSection` selects the tracker section; `status` must agree with it.
Ordered backlog maps to `todo` and Unverified proposals to `backlog`, so use
`sourceSection` to distinguish them. These patches show the full mapping.

Return an unaccepted issue to Ordered backlog:

```bash
hai-tasks update "$SOURCE" "$ISSUE_ID" --revision "$REVISION" --json '{"sourceSection":"Ordered backlog","status":"todo"}'
```

Schedule it:

```bash
hai-tasks update "$SOURCE" "$ISSUE_ID" --revision "$REVISION" --json '{"sourceSection":"Scheduled","status":"todo"}'
```

Start it. The CLI writes the `[~]` marker:

```bash
hai-tasks update "$SOURCE" "$ISSUE_ID" --revision "$REVISION" --json '{"sourceSection":"In Progress","status":"in_progress"}'
```

Complete it. The CLI writes `[ ]`, pending user acceptance:

```bash
hai-tasks update "$SOURCE" "$ISSUE_ID" --revision "$REVISION" --json '{"sourceSection":"Completed / Accepted","status":"done"}'
```

Never send `accepted: true` unless the user explicitly accepts the work.
Reopening an accepted issue requires explicitly clearing acceptance; follow
the tracker rules and user instructions before doing so.

## Create and position

Specify a section; without one, creation defaults to Unverified proposals.

```bash
hai-tasks create "$SOURCE" --revision "$REVISION" --json '{"title":"New task","sourceSection":"Ordered backlog","status":"todo"}'
```

New issues append to Ordered backlog, as implemented by [20]. In other sections,
creation inserts at the top. Moves into Ordered backlog insert at the top,
after any prerequisites. When backlog position matters, read again and reorder.
Include every Ordered backlog ID exactly once, with prerequisites first.
Replace these example IDs with the IDs from that read:

```bash
hai-tasks reorder "$SOURCE" --revision "$REVISION" --json '{"issueIds":["NEW_ISSUE_ID","OTHER_BACKLOG_ID"]}'
```

## Dependencies

`dependencies` lists the numbers of the issues a task depends on. It writes
one `- Depends on: [N], [M]` bullet under the summary and keeps `depends-on:`
frontmatter in the description file consistent. An empty list removes them.
Unknown numbers, self-dependencies and cycles are rejected, as is an Ordered
backlog order that leaves a dependent before its prerequisite; reorder first.

```bash
hai-tasks update "$SOURCE" "$ISSUE_ID" --revision "$REVISION" --json '{"dependencies":[1]}'
```

## Local issue and backlog directories

`.scratch/<feature>` tickets and `docs/backlog/`-style repositories (`docs/issues`,
`ideas`, `backlog`, `in-progress`, `completed`, `rejected`) use `sourceState`
instead of `sourceSection`. `read` lists the states with their statuses under
`capabilities.sourceStates`. Move a document by patching `sourceState` with the
matching `status`, for example `{"sourceState":"in-progress","status":"in_progress"}`,
and filter with `query "$SOURCE" --state backlog`. Read the repository's
`docs/README.md` and the directory READMEs for the sections each state expects;
Hai moves the file but does not fill in the template. See
[Markdown backlog directories](../../docs/python-api-cli.md#markdown-backlog-directories).

## Failed writes

On a stale revision error, re-read and check whether the intended change is
already present. If it is, do not repeat it. Otherwise, reapply the change with
the new revision. After connection loss during a remote write, inspect a fresh
read before retrying because the write may have succeeded.

After a partial save, stop and report the error and affected files. Do not retry
or repair the tracker by hand.

For installation, remote sources, descriptions, other commands and API details,
see [Python API and CLI](../../docs/python-api-cli.md) in the Hai checkout.
