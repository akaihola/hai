# Add a `hai-tasks` agent skill

## Why

The kandev-pacer worker prompt says "use hai_tasks for tracker updates with
revision checks". Nothing tells the worker that `hai_tasks` is this
repository's Python package and `hai-tasks` its CLI. On 2026-10-06 a
palindromi.fi worker (T3 thread `3ccc4d7e-ed76-454f-8464-238ecb69be71`) looked
for a `hai_tasks` tool, found none and edited `TASKS.md` by hand. No revision
check ran, and it resolved a rebase conflict in `## Scheduled` manually.
Workers in at least five repositories have saved "no hai_tasks tool, edit by
hand" to their agent memory.

## Intended result

`skills/hai-tasks/SKILL.md` in this repository, so a CLI change and the matching
skill change land in the same commit. Two related tasks use it:

- nixos-config links the skill into the Claude Code, Codex and Pi skill
  directories on agent@gogo and puts `hai-tasks` on `PATH`
  (`~/repos/nixos-config/docs/backlog/deploy-hai-tasks-skill.md`).
- kandev-pacer [42] names the command in its worker prompt.

## What the skill covers

The skill covers using the tool and nothing else. Tracker rules stay in each
tracker's `## Rules` section. The skill tells the agent to read that section
and does not restate it, so the two cannot drift apart.

- **Description.** One or two lines, because every session on the account loads
  it. Trigger on a `TASKS.md` with Hai's sections and `<!-- hai:` comments, and
  on prompts that mention `hai_tasks` or `hai-tasks`. Say plainly that these
  are a Python package and its CLI, not an MCP tool.
- **The loop.** Run `read` or `query` to get the revision and stable issue IDs,
  make one mutation with `--revision`, then read again before the next one.
- **Common moves.** Show the exact JSON for Ordered backlog → Scheduled →
  In Progress → Completed / Accepted. Check how each move maps to
  `sourceSection` and `status`, including whether In Progress writes the `[~]`
  marker.
- **Acceptance.** Never send `accepted: true` unless the user says so.
- **Stale revisions.** Re-read, check whether the change is already there, then
  reapply it on the new revision. After a partial save, stop and report instead
  of retrying.
- **New issues.** `create` puts a new issue at the top of its section (see [20]).
  Follow it with `reorder` when position matters.
- **Reference.** Link `docs/python-api-cli.md` for everything else.

## Verification

- Add a test that runs every command shown in `SKILL.md` against a fixture
  tracker in a temporary Git repository. A CLI change that breaks the skill then
  fails `npm test`.
- After nixos-config deploys the skill, start a Claude Code session in another
  repository with a Hai tracker and ask it to start an issue. Check that it
  loads the skill and runs `hai-tasks update --revision`.
