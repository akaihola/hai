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

- [33] Remove the sourceSection alias
    - Depends on: [31], [32]
  <!-- hai:{"id":"simple-428c74bf-7398-433b-b232-f4d477a2d4ba","createdAt":"2026-10-15T08:15:10.172Z","updatedAt":"2026-10-15T08:15:10.172Z"} -->

## Scheduled

## In Progress

- [~] [32] Switch kandev-pacer to workflow stages
    - Depends on: [30]
  <!-- hai:{"id":"simple-f35db4fa-9229-46e2-8842-0bbd314dbc38","createdAt":"2026-10-15T08:15:09.724Z","updatedAt":"2026-10-15T08:46:31.115Z"} -->

## Completed / Accepted

- [ ] [31] Move Hai's CLI, UI, skill and docs to the state catalog
    - Depends on: [30]
  <!-- hai:{"id":"simple-e51575e7-59fb-4fc8-8c23-78e0ab478200","createdAt":"2026-10-15T08:15:09.316Z","updatedAt":"2026-10-15T08:45:35.074Z"} -->

- [ ] [30] Declare workflow state catalogs with stages and derive status
  <!-- hai:{"id":"simple-dd2ef7be-a12b-411c-91ad-2d147ac158ff","createdAt":"2026-10-15T08:15:08.980Z","updatedAt":"2026-10-15T08:35:37.221Z"} -->

- [x] [29] Write `Depends on:` dependencies through the API and CLI
  <!-- hai:{"id":"simple-478f2d40-e219-4f8e-8ff9-b29f0698e32f","createdAt":"2026-10-14T12:32:36.205Z","updatedAt":"2026-10-14T20:21:12.782Z"} -->

- [x] [28] Open a repository's `.scratch/` features as one workspace
  <!-- hai:{"id":"simple-f026711e-c707-42cf-a19e-f309584f14eb","createdAt":"2026-10-11T18:49:30.186Z","updatedAt":"2026-10-14T20:20:38.601Z"} -->

- [ ] [27] Support `docs/backlog/`
  <!-- hai:{"id":"simple-302a01b2-71b6-4e82-9887-1ffc7b92629e","priority":"none","labels":[],"createdAt":"2026-10-11T14:24:07.802Z","updatedAt":"2026-10-14T13:41:27.894Z"} -->

- [x] [26] Deleting an issue leaves its description file and link behind
  <!-- hai:{"id":"simple-723c1791-f392-475b-9518-2fd8673c4887","createdAt":"2026-10-11T10:29:45.032Z","updatedAt":"2026-10-14T12:34:37.659Z"} -->

- [x] [23] Add a `hai-tasks` agent skill so agents stop editing trackers by hand.
  <!-- hai:{"id":"simple-a61b1e2a-60b4-4bfe-b453-3d1ea87234c8","createdAt":"2026-10-10T11:06:37.830Z","updatedAt":"2026-10-14T13:24:29.922Z"} -->

- [x] [19] Keyboard friendly project switching
  <!-- hai:{"id":"simple-0507ac21-7daa-4768-b786-19289aebd18e","priority":"none","labels":[],"createdAt":"2026-10-07T18:58:40.973Z","updatedAt":"2026-10-10T19:41:19.698Z"} -->

- [x] [20] New issue goes to top of ordered backlog
  <!-- hai:{"id":"simple-0dd03d92-f5d8-485b-b5f4-781e657a6c90","priority":"none","labels":[],"createdAt":"2026-10-08T16:25:37.328Z","updatedAt":"2026-10-10T19:40:48.145Z"} -->

- [x] [21] Ctrl+Enter doesn't create issue
  <!-- hai:{"id":"simple-956562e0-25d1-46d1-9357-a5de89a89491","priority":"none","labels":[],"createdAt":"2026-10-08T16:27:07.343Z","updatedAt":"2026-10-10T19:38:30.265Z"} -->

- [x] [22] Support Matt Pocock skills' local issues
  <!-- hai:{"id":"simple-90b5bb1c-bdda-47ac-bee5-6fd61c7015cf","priority":"none","labels":[],"createdAt":"2026-10-09T19:11:20.954Z","updatedAt":"2026-10-11T08:05:44.434Z"} -->

- [x] [*] Can't switch to an arbitrary project among the configured projects, because the
  `Switch project` drop-down only shows 8 recent projects and there's no other easy
  project switch method.
  <!-- hai:{"id":"simple-78465aec7e7a2b2b","updatedAt":"2026-10-07T19:48:08.433Z"} -->

- [ ] [18] All projects view
    <!-- hai:{"id":"simple-204d2565-1a34-4ece-a417-21f4ae94d387","priority":"none","labels":[],"createdAt":"2026-10-05T19:53:39.313Z","updatedAt":"2026-10-06T04:55:25.836Z"} -->

- [x] [*] Evaluate automatic refresh when a tracker is edited outside Hai.
    <!-- hai:{"id":"simple-23492cea2aaa55f4","updatedAt":"2026-10-05T19:55:46.838Z"} -->

- [x] [15] Insufficient detail in error for tracker source
    <!-- hai:{"id":"simple-ddbc18e9-2ca9-4a1e-99c8-3260f171ad67","priority":"none","labels":[],"createdAt":"2026-10-03T21:05:31.331Z","updatedAt":"2026-10-05T19:55:58.925Z"} -->

- [x] [17] Automatically refresh and retry new issue saves
    <!-- hai:{"id":"simple-3e99c016-4b24-458f-b27c-5c0536f10309","createdAt":"2026-10-04T20:17:04.615Z","updatedAt":"2026-10-05T19:55:34.449Z"} -->

- [x] [16] Python backend and TASKS.md API & CLI
    <!-- hai:{"id":"simple-f04ebe20-a07c-42b6-b19a-13a9d5a39227","priority":"none","labels":[],"createdAt":"2026-10-04T07:46:09.160Z","updatedAt":"2026-10-04T18:03:18.693Z"} -->

- [x] [*] I get a `Task title must contain 1–300 characters.` error when I try to open
      the `~/prg/drum-transcribe` project on akaihola@atom.
    <!-- hai:{"id":"simple-1d9599496e6f6177","updatedAt":"2026-10-03T17:44:49.596Z"} -->

- [ ] [10] Add project and cycle administration for backends that support it.
    - Depends on: [2]

- [x] [14] User can't view different projects
    <!-- hai:{"id":"simple-81bf59c0-8436-49f6-bc43-e7c03bf5b966","priority":"none","labels":[],"createdAt":"2026-10-03T16:59:29.495Z","updatedAt":"2026-10-03T17:45:06.589Z"} -->

- [x] [13] Separate groups: Completed and Accepted
    <!-- hai:{"id":"simple-9a484642-438a-442a-9ff4-adaea52b4796","priority":"none","labels":[],"createdAt":"2026-10-03T16:27:07.487Z","updatedAt":"2026-10-05T19:55:05.328Z"} -->

- [x] [12] Eliminate runs of blank lines in TASKS.md
    <!-- hai:{"id":"simple-07d5ee60-0b24-473c-becc-96c8c92af599","priority":"urgent","labels":[],"createdAt":"2026-10-03T15:47:37.833Z","updatedAt":"2026-10-05T19:55:02.047Z"} -->

- [x] [11] Allow dragging issues from a group to another
    <!-- hai:{"id":"simple-3aa8f0ea-6ccc-4e8b-ac14-04d2b9478536","priority":"urgent","labels":[],"createdAt":"2026-10-03T15:43:52.664Z","updatedAt":"2026-10-03T17:45:24.303Z"} -->

- [x] [*] Allow drag-and-drop ordering of the Ordered backlog issue group.
    <!-- hai:{"id":"simple-f81b95eaa561efe0","updatedAt":"2026-10-05T19:54:55.034Z"} -->

- [x] [*] Restore persistent access at http://gogo.tailnet.example:5173/.
      <!-- hai:{"id":"simple-b063810f-7c6b-4170-9c30-7f58afa3b59e","createdAt":"2026-10-03T15:22:16.015Z","updatedAt":"2026-10-03T15:30:31.696Z"} -->

- [x] [5] Deploy Hai persistently on gogo with private Tailscale access.
    - Depends on: [4]

      <!-- hai:{"updatedAt":"2026-10-03T15:30:43.123Z"} -->

- [x] [4] Make Hai read and edit its repository TASKS.md through a local service.
    - Depends on: [2], [3]

    <!-- hai:{"updatedAt":"2026-10-03T17:45:52.762Z"} -->

- [x] [3] Adopt Filemill's task tracker conventions for Hai.
    <!-- hai:{"updatedAt":"2026-10-05T19:54:45.199Z"} -->

- [x] [1] Build the working Linear-inspired issue workspace and responsive interface.
    <!-- hai:{"updatedAt":"2026-10-05T19:54:32.820Z"} -->

- [x] [2] Define the replaceable backend contract and browser persistence adapter.
    <!-- hai:{"updatedAt":"2026-10-05T19:54:22.529Z"} -->

- [x] [*] Research GitHub, Beans, taskmd, and Markdown Ticket provider mappings.
    <!-- hai:{"id":"simple-5bdaf3b310caa03c","updatedAt":"2026-10-05T19:54:14.201Z"} -->

- [x] [*] Verify issue workflows, accessible dialogs, keyboard controls, and mobile
      layout.
    <!-- hai:{"id":"simple-5c22b703fc850a34","updatedAt":"2026-10-05T19:54:10.795Z"} -->

- [x] [*] Add workspace JSON backups and readable Markdown export.
    <!-- hai:{"id":"simple-788e7e4b24de8e9d","updatedAt":"2026-10-05T19:54:04.817Z"} -->

- [x] [*] Allow gogo as a development server hostname.
    <!-- hai:{"id":"simple-8a9e06bba8a9059e","updatedAt":"2026-10-05T19:53:56.131Z"} -->

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

<!-- hai:reserved-numbers:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33 -->

[12]: docs/tasks/12-eliminate-runs-of-blank-lines-in-tasks-md.md
[13]: docs/tasks/13-separate-groups-completed-and-accepted.md
[14]: docs/tasks/14-user-can-t-view-different-projects.md
[15]: docs/tasks/15-insufficient-detail-in-error-for-tracker-source.md
[16]: docs/tasks/16-python-backend-and-tasks-md-api-cli.md
[17]: docs/tasks/17-automatically-refresh-and-retry-new-issue-saves.md
[18]: docs/tasks/18-all-projects-view.md

[19]: docs/tasks/19-keyboard-friendly-project-switching.md

[20]: docs/tasks/20-new-issue-goes-to-top-of-ordered-backlog.md

[21]: docs/tasks/21-ctrl-enter-doesn-t-create-issue.md

[22]: docs/tasks/22-support-matt-pocock-skills-local-issues.md

[23]: docs/tasks/23-add-a-hai-tasks-agent-skill-so-agents-stop-editing-trackers-by-hand.md

[24]: docs/tasks/24-this-is-a-test-issue.md

[25]: docs/tasks/25-test-issue.md

[26]: docs/tasks/26-deleting-an-issue-leaves-its-description-file-and-link-behind.md

[27]: docs/tasks/27-support-docs-backlog.md

[28]: docs/tasks/28-open-a-repository-s-scratch-features-as-one-workspace.md

[29]: docs/tasks/29-write-depends-on-dependencies-through-the-api-and-cli.md

[30]: docs/tasks/30-declare-workflow-state-catalogs-with-stages-and-derive-status.md

[31]: docs/tasks/31-move-hai-s-cli-ui-skill-and-docs-to-the-state-catalog.md

[32]: docs/tasks/32-switch-kandev-pacer-to-workflow-stages.md

[33]: docs/tasks/33-remove-the-sourcesection-alias.md

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
