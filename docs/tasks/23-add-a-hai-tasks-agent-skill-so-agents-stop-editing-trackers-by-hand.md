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

## Deployment and agent verification, 2026-10-14

This update supersedes the earlier note that skill installation and the
cross-repository Claude Code check were pending. The user reported completion
of the nixos-config deployment thread `9ccb4cca-cfdf-400f-bb7d-e58ec7b8c7c3`
and rebuilds of atom and gogo. On agent@gogo, the installed `hai-tasks` command
resolves, and the Claude Code, Codex and Pi skill links expose the canonical
Hai skill. The related deployment document separately records a pending fleet
audit; this behavior test did not verify that audit or run agents on atom.

Independent review on 2026-10-11 found no actionable findings or proposed
fixes at `4c5667f058f6afc6d41ef98613ebdb93e2c57416`. The reviewer passed the
executable-example test, six focused CLI/storage tests and diff checks. It did
not independently rerun the full application/build/browser suite.

Nine fresh agent sessions ran on gogo against disposable Git trackers on
2026-10-14. Initial prompts asked agents to start a scheduled dummy issue
without naming the skill or command. Completion turns explicitly withheld
user acceptance. Separate sessions tested a real concurrent CLI mutation
between an agent's read and update, producing stale-revision status 412.

| Agent / prompt | Start and completion | Stale-revision recovery |
| --- | --- | --- |
| Claude Code, default configuration | Passed | Passed |
| Codex CLI, default configuration | Passed | Passed |
| Fresh T3 Codex thread in a T3-managed worktree | Passed | Not tested |
| Pi, default configuration, unprompted | Failed | Not reached |
| Pi with the current explicit pacer instructions | Passed | Passed |

Passing runs loaded the skill, used stable issue IDs and revision-checked CLI
updates, retained the numbered description reference, wrote `[~]` on start
and `[ ]` on completion, and preserved the other issue and prior acceptance.
Successful stale-revision runs re-read and retried with a fresh revision while
retaining the competitor's priority change.

Pi used its configured `openai-codex/gpt-5.6-luna` model with minimal thinking.
Its system skill catalog contained `hai-tasks`, but it ignored the skill in
two unprompted fresh sessions and edited Markdown directly. It lost the `[1]`
reference; the first session also left the issue in Scheduled despite marking
it `[~]`, and its completion turn left the issue there. The second unprompted
session moved the issue to In Progress but still lost its reference and used
no revision check. This is a remaining agent-selection limitation, not a
failure of CLI discovery or installation.

With the current pacer wording naming the package, CLI, revision flags and
skill, Pi loaded the skill and passed start, completion and stale-revision
recovery. Keep that explicit guidance. Automatic skill selection in Pi still
needs investigation before claiming that all agents reliably avoid hand edits.

Evidence is retained at
`/home/agent/.local/state/hai-agent-tests/2026-10-14-d2ff0c37/results.json`,
with transcripts, tool-call summaries, prompts, tracker snapshots and conflict
injection records in the same directory. T3 test thread:
`91c22648-b70d-4c54-9df0-a03ee44b5ccb`.

These smoke tests do not guarantee future behavior. They did not exercise
agents on atom, an existing repository with stale hand-editing memory, or the
actual pacer scheduling daemon. Only disposable trackers were mutated; no
real tracker acceptance was changed. Issue [23] remains completed and
unchecked pending explicit user acceptance.
