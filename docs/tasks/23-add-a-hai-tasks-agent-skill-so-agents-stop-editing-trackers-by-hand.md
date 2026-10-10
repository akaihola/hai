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

## Implementation notes, 2026-10-10

Added `skills/hai-tasks/SKILL.md` with the Python package / CLI distinction,
revision loop, exact move patches, acceptance guard, stale-write handling,
partial-save stop condition, creation/reorder examples and API reference.

Correction to the original creation requirement: the merged implementation of
[20] appends newly created issues to Ordered backlog. The skill documents that
behavior. Creation in other sections still inserts at the top; moves into
Ordered backlog insert at the top after prerequisites. No CLI behavior changed.

`tests/python/test_skill.py` extracts every Bash example from the skill and runs
it through the published console entry point against a fixture tracker in a
temporary Git repository. It checks revisions, all four section/status mappings,
`[~]`, unchecked completion, creation position, reordering, and the Python module
fallback. It runs automatically under `npm test`. The skill validator passed.

Skill installation and the cross-repository Claude Code discovery check remain
with the related nixos-config deployment task. This change requires no web
service restart.

Validation: `npm run check` passed 33 Python tests, 90 client/API tests,
TypeScript checks, the production build and all 59 Chromium workflows. The
final stronger example test also passed separately. The first check lacked
Node dependencies; after `npm ci`, the complete check passed. Full output is
retained in `/tmp/hai-23-check.log`. The skill validator passed using an isolated
temporary Python environment with PyYAML.

Merged into main. Issue [23] is completed and remains unchecked for user
acceptance.
