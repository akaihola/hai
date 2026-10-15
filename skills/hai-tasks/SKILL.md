---
name: hai-tasks
description: >-
  Use for TASKS.md with Hai sections and hai: metadata comments, or prompts mentioning hai_tasks or hai-tasks.
  hai_tasks is a Python package; hai-tasks is its CLI, not an MCP tool.
---

# Hai tracker commands

Use `hai-tasks` for tracker mutations instead of editing Markdown by hand.
Read the source's tracker rules and directory READMEs before changing it.
Those rules govern workflow; the catalog does not grant transition permission.

If the CLI is missing from PATH, use `python3 -m hai_tasks` from a Hai checkout
or an environment where the package is installed. If neither works, report the
missing installation and stop tracker writes.

## Read and filter

Set `SOURCE` to the intended project, tracker, `.scratch/` feature or repository,
or `docs/backlog/` source. In a feature worktree, use its source for worktree
changes. The same commands below work for all three file workflows.

```bash
hai-tasks read "$SOURCE"
hai-tasks query "$SOURCE" --stage ready --no-accepted
hai-tasks report "$SOURCE" --stage done
```

`read` returns a `revision`, issues with stable `id` values, and an ordered
`capabilities.sourceStates` catalog of `{id, stage}`. Use the stable issue ID,
not its display number. `--state` filters by native state name; `--section` is
its deprecated alias. `--stage` filters by the shared vocabulary: `triage`,
`waiting`, `ready`, `scheduled`, `active`, `review`, `done`, `dropped`.
Reports count native states under `byState`. Stages can contain several states,
and not every source has every stage. Select the intended native state from
`read`; the helper below chooses the first state in the requested stage.

## Revision loop and moves

Define this Bash helper once. Each call reads a fresh snapshot, then selects a
state by stage. A state-only patch derives the display status automatically.
If a stage is absent the helper fails before any write.

```bash
select_stage() {
  SNAPSHOT=$(hai-tasks read "$SOURCE") || return
  REVISION=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["revision"])' "$SNAPSHOT") || return
  PATCH=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.dumps({"sourceState": next(s["id"] for s in d["capabilities"]["sourceStates"] if s["stage"] == sys.argv[2])}))' "$SNAPSHOT" "$1")
}
```

Set `ISSUE_ID` from the read output. Start work:

```bash
select_stage active && hai-tasks update "$SOURCE" "$ISSUE_ID" --revision "$REVISION" --json "$PATCH"
```

Complete it, pending user acceptance:

```bash
select_stage done && hai-tasks update "$SOURCE" "$ISSUE_ID" --revision "$REVISION" --json "$PATCH"
```

Return unaccepted work to a ready state:

```bash
select_stage ready && hai-tasks update "$SOURCE" "$ISSUE_ID" --revision "$REVISION" --json "$PATCH"
```

Never send `accepted: true` unless the user explicitly accepts the work.
Reopening accepted work requires explicitly clearing acceptance, following
source rules and user instructions. TASKS.md completion writes `[ ]`.

## Create

Creation uses the same catalog selection. Scratch requires a feature project;
this example selects the first project from `read`. Choose the intended project
when there are several. Other workflows omit that field.

```bash
select_stage ready && CREATE_PATCH=$(python3 -c 'import json,sys; p=json.loads(sys.argv[1]); d=json.loads(sys.argv[2]); p["title"]="New task"; p.update({"projectId": d["workspace"]["projects"][0]["id"]} if d["capabilities"].get("projectAssignment") == "required-on-create" else {}); print(json.dumps(p))' "$PATCH" "$SNAPSHOT") && hai-tasks create "$SOURCE" --revision "$REVISION" --json "$CREATE_PATCH"
```

Read again before every subsequent mutation, even if the previous write returned
a revision. TASKS.md creation appends to Ordered backlog; moves into that state
insert at the top after prerequisites. `reorder` is TASKS.md-specific and requires
every Ordered backlog ID exactly once, with prerequisites first. Check
capabilities before using source-specific operations or fields.

`dependencies` accepts prerequisite numbers on TASKS.md and ticket IDs on scratch.
Unsupported dependency writes fail. Directory sources move files but do not fill
in the destination's required template sections; follow repository READMEs.

## Failed writes

On a stale revision error, re-read and check whether the intended change already
exists. If so, do not repeat it. Otherwise reapply with the new revision. After
connection loss during a remote write, inspect a fresh read before retrying.

After a partial save, stop and report the error and affected files. Do not retry
or repair the tracker by hand.

For installation, remote sources, descriptions, other commands and API details,
see [Python API and CLI](../../docs/python-api-cli.md) in the Hai checkout.
