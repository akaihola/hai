# Issue tracking for Hai

Rules for TASKS.md usage are at the bottom of the file.

## Unverified proposals

- [9] Connect Markdown Ticket through its configured bridge.
    - Depends on: [2]

    <!-- hai:{"updatedAt":"2026-10-03T15:44:13.072Z"} -->

- [8] Connect taskmd without losing unsupported task metadata.
    - Depends on: [2]

    <!-- hai:{"updatedAt":"2026-10-03T15:44:09.588Z"} -->

- [7] Connect Beans through its CLI or a local filesystem bridge.
    - Depends on: [2]

    <!-- hai:{"updatedAt":"2026-10-03T15:44:06.413Z"} -->

- [6] Connect GitHub Issues and Projects with explicit workflow mappings.
    - Depends on: [2]

    <!-- hai:{"updatedAt":"2026-10-03T15:44:02.099Z"} -->

## Ordered backlog

- [*] Evaluate automatic refresh when a tracker is edited outside Hai.
  <!-- hai:{"id":"simple-23492cea2aaa55f4","updatedAt":"2026-10-03T17:46:21.006Z"} -->

## Scheduled

## In Progress

## Completed / Accepted

- [ ] [15] Insufficient detail in error for tracker source
  <!-- hai:{"id":"simple-ddbc18e9-2ca9-4a1e-99c8-3260f171ad67","priority":"none","labels":[],"createdAt":"2026-10-03T21:05:31.331Z","updatedAt":"2026-10-04T20:39:36.066Z"} -->

- [ ] [17] Automatically refresh and retry new issue saves
  <!-- hai:{"id":"simple-3e99c016-4b24-458f-b27c-5c0536f10309","createdAt":"2026-10-04T20:17:04.615Z","updatedAt":"2026-10-04T20:27:23.619Z"} -->

- [x] [16] Python backend and TASKS.md API & CLI
  <!-- hai:{"id":"simple-f04ebe20-a07c-42b6-b19a-13a9d5a39227","priority":"none","labels":[],"createdAt":"2026-10-04T07:46:09.160Z","updatedAt":"2026-10-04T18:03:18.693Z"} -->

- [x] [*] I get a `Task title must contain 1–300 characters.` error when I try to open the
  `~/prg/drum-transcribe` project on akaihola@atom.
  <!-- hai:{"id":"simple-1d9599496e6f6177","updatedAt":"2026-10-03T17:44:49.596Z"} -->

- [ ] [10] Add project and cycle administration for backends that support it.
    - Depends on: [2]

- [x] [14] User can't view different projects
  <!-- hai:{"id":"simple-81bf59c0-8436-49f6-bc43-e7c03bf5b966","priority":"none","labels":[],"createdAt":"2026-10-03T16:59:29.495Z","updatedAt":"2026-10-03T17:45:06.589Z"} -->

- [ ] [13] Separate groups: Completed and Accepted
    <!-- hai:{"id":"simple-9a484642-438a-442a-9ff4-adaea52b4796","priority":"none","labels":[],"createdAt":"2026-10-03T16:27:07.487Z","updatedAt":"2026-10-03T16:27:07.487Z"} -->

- [ ] [12] Eliminate runs of blank lines in TASKS.md
    <!-- hai:{"id":"simple-07d5ee60-0b24-473c-becc-96c8c92af599","priority":"urgent","labels":[],"createdAt":"2026-10-03T15:47:37.833Z","updatedAt":"2026-10-03T16:25:01.441Z"} -->

- [x] [11] Allow dragging issues from a group to another
  <!-- hai:{"id":"simple-3aa8f0ea-6ccc-4e8b-ac14-04d2b9478536","priority":"urgent","labels":[],"createdAt":"2026-10-03T15:43:52.664Z","updatedAt":"2026-10-03T17:45:24.303Z"} -->

- [ ] [*] Allow drag-and-drop ordering of the Ordered backlog issue group.

- [x] [*] Restore persistent access at http://gogo.tailnet.example:5173/.
    <!-- hai:{"id":"simple-b063810f-7c6b-4170-9c30-7f58afa3b59e","createdAt":"2026-10-03T15:22:16.015Z","updatedAt":"2026-10-03T15:30:31.696Z"} -->

- [x] [5] Deploy Hai persistently on gogo with private Tailscale access.
    - Depends on: [4]

    <!-- hai:{"updatedAt":"2026-10-03T15:30:43.123Z"} -->

- [x] [4] Make Hai read and edit its repository TASKS.md through a local service.
    - Depends on: [2], [3]

  <!-- hai:{"updatedAt":"2026-10-03T17:45:52.762Z"} -->

- [ ] [3] Adopt Filemill's task tracker conventions for Hai.
    <!-- hai:{"updatedAt":"2026-10-03T13:13:15.461Z"} -->

- [ ] [1] Build the working Linear-inspired issue workspace and responsive interface.

- [ ] [2] Define the replaceable backend contract and browser persistence adapter.

- [ ] [*] Research GitHub, Beans, taskmd, and Markdown Ticket provider mappings.

- [ ] [*] Verify issue workflows, accessible dialogs, keyboard controls, and mobile
      layout.

- [ ] [*] Add workspace JSON backups and readable Markdown export.

- [ ] [*] Allow gogo as a development server hostname.

[1]: docs/tasks/1-issue-workspace.md
[2]: docs/tasks/2-backend-contract.md
[3]: docs/tasks/3-tracker-conventions.md
[4]: docs/tasks/4-live-tasks-backend.md
[5]: docs/tasks/5-private-deployment.md
[6]: docs/tasks/6-github-connector.md
[7]: docs/tasks/7-beans-connector.md
[8]: docs/tasks/8-taskmd-connector.md
[9]: docs/tasks/9-markdown-ticket-connector.md
[10]: docs/tasks/10-project-cycle-administration.md
[*]: TASKS.md

---

[11]: docs/tasks/11-allow-dragging-issues-from-a-group-to-another.md

<!-- hai:reserved-numbers:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17 -->

[12]: docs/tasks/12-eliminate-runs-of-blank-lines-in-tasks-md.md
[13]: docs/tasks/13-separate-groups-completed-and-accepted.md
[14]: docs/tasks/14-user-can-t-view-different-projects.md

[15]: docs/tasks/15-insufficient-detail-in-error-for-tracker-source.md

[16]: docs/tasks/16-python-backend-and-tasks-md-api-cli.md

[17]: docs/tasks/17-automatically-refresh-and-retry-new-issue-saves.md

## Rules

Here are the rules for TASKS.md usage:

### TASKS.md maintenance sessions

- In `## Completed / Accepted`, `- [ ] [N] summary` or `- [ ] [*] summary` means
  completed work awaiting user acceptance. `- [x] [N] summary` or `- [x] [*] summary`
  means the user has accepted it. Only user acceptance changes `[ ]` to `[x]`;
  completion, tests and deployment do not.
- Move newly completed issues into `## Completed / Accepted` with `[ ]`.
- During the next maintenance run, remove only `[x]` issues from this section, plus
  their unused description files and reference-style links. Keep `[ ]` issues and any
  files or links still referenced by another issue.
- Each issue must retain either
    - a numbered reference-style link (e.g. `[1]`) to a description file, or
    - `[*]` to indicate no description file is needed for a simple task.
- `[~]` marks an issue that is actively in progress. When the issue is complete, move it
  to `## Completed / Accepted` with `[ ]`, pending user acceptance.
- Link references are listed between `## Completed / Accepted` and `## Rules`.
- Keep summaries concise. Move detailed requirements, rationale, examples and acceptance
  criteria into `docs/tasks/N-issue-description.md`; preserve simple tasks inline. Reuse
  an existing description for the same issue.
- For a new description, use the first unused number, checking both this file and
  description filenames in available Git history. Do not reuse numbers of accepted
  issues.
- Preserve Hai metadata comments during manual edits, including the reserved-number
  ledger that prevents identifier reuse after cleanup without Git history.
- The section records work status; the checkbox in `## Completed / Accepted` records
  user acceptance. Completed descriptions retain historical requirements, paths and
  validation results; they are not current implementation instructions. Date later
  corrections and distinguish regressions from earlier work.
- Any completed tasks which haven't yet been moved from `## In Progress` to
  `## Completed / Accepted` should be moved there.
- Any in progress tasks which haven't yet been moved from `## Ordered backlog` or
  `## Scheduled` to `## In Progress` should be moved there.
- Ensure there are no duplicate sections, and that they are in the correct order:
  `## Unverified proposals` -> `## Ordered backlog` -> `## Scheduled` ->
  `## In Progress` -> `## Completed / Accepted` -> `## Rules`.

### Modifying issues

- Ensure dependencies between issues are correctly updated.
- State dependencies using
    - indented `- Depends on: [N]` bullets in TASKS.md, and
    - YAML frontmatter in description files.
- Ensure backlog order respects dependencies.
- When you move an issue, preserve its identifier, text and line wrapping. Change only
  the status checkbox when completion or user acceptance requires it. This keeps moves
  identifiable in Git and reduces avoidable conflicts.

### Workflow for new issue completion

Git operations below apply only when this directory is a Git repository. Without Git,
use the working files, skip branch/commit/rebase/merge steps, and preserve the same
scheduling, implementation, validation, and acceptance transitions. Do not initialize a
repository just to satisfy these rules.

Below, `<filename>@<branch>` means operate on the file in the specified branch.

1. Choose issue and schedule work

- Pick the first issue in `TASKS.md@main` with no dependency on uncompleted work.
- Move it from `## Ordered backlog` to `## Scheduled` in `TASKS.md@main`, and commit
  when the Git workflow applies.

2. Work on the issue

- Move the issue to `## In Progress` in `TASKS.md@<worktree-branch>`, mark it `[~]`, and
  ensure no copy is left in the backlog or scheduled section.
- Create or update, review and refine `docs/tasks/N-issue-description.md` if the plan
  needs more than a concise bullet. Link a new description with a new `[N]`.
- Reword the summary if needed. Commit the description and tracker when applicable.
- Implement, test, review, and refine the work in the feature worktree when available.

3. Merge and deploy

- When Git applies, rebase the feature branch on `main`, resolve conflicts, merge it,
  and remove the worktree and branch.
- Move the issue to `## Completed / Accepted` with `[ ]`, pending user acceptance, and
  commit when applicable.
- Follow any deployment steps in `docs/deployment.md`.
