Builds on [22], which opens each `.scratch/<feature-slug>/` directory as a separate
workspace. Matt Pocock's skills keep one issue tracker per repository, so Hai should
open a repository's `.scratch/` as one workspace and show each feature as a Hai
project.

## Rationale, 2026-10-11

- The skills' `CONTEXT.md` defines the issue tracker as "the tool that hosts a repo's
  issues". `/setup-matt-pocock-skills` writes one `docs/agents/issue-tracker.md` and
  one `docs/agents/triage-labels.md` per repository.
- Local Markdown stands in for GitHub Issues, where a spec or wayfinder map is a
  parent issue with child tickets in the same tracker. A feature directory plays the
  parent role; a Hai project is the closest equivalent.
- `/triage` reviews one repository-wide queue: unlabeled, `needs-triage`, and
  `needs-info` issues with reporter activity, oldest first. Per-feature workspaces
  cannot show it.
- The feature remains the unit of work. Ticket numbers restart at `01` in each
  feature, `Blocked by: NN` refers to tickets in the same feature, wayfinder's
  frontier scans one effort's `issues/` directory, and publishing always targets
  `.scratch/<feature-slug>/`.

## Requirements

- Open `<repo>/.scratch/` as one workspace. The project picker and All projects list
  one entry per repository instead of one per feature.
- Show every feature directory, including spec-only features, as a read-only Hai
  project.
- Display ticket identifiers qualified by feature, such as `readme-screencast/01`.
  Make issue IDs unique across features; current IDs hash only the filename.
- Require a feature when creating a ticket and number it within that feature. Do not
  allow moving a ticket to another feature, because that would renumber it and break
  other tickets' `Blocked by:` lines.
- Filter the list and board by feature. Opening `.scratch/<feature>` or its `issues/`
  directory opens the repository workspace filtered to that feature, so existing
  paths and saved selections keep working.
- Resolve `Blocked by:` and deletion protection within each feature.
- Revisions cover every feature's tickets and the triage-label mapping.
- Python API and CLI `read` and `query` on `.scratch/` return tickets from all
  features, with the feature in each row.
- Update `docs/backends.md` and `docs/python-api-cli.md`. Cover storage, HTTP and
  browser workflows.

Out of scope: wayfinder frontier selection, map edits, and triage category roles.

Sources: `~/.claude/plugins/marketplaces/mattpocock/CONTEXT.md`,
`skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md`,
`skills/engineering/triage/SKILL.md`, `skills/engineering/to-tickets/SKILL.md` and
`skills/engineering/wayfinder/SKILL.md` in the same marketplace checkout (84fdeff,
2026-08-06).

## Completion and validation, 2026-10-14

Implemented and merged repository-wide scratch workspaces. Each feature directory
is a read-only Hai project, including spec-only features. Tickets have qualified
identifiers and IDs derived from their feature and filename. Creation requires a
feature, numbering and deletion protection stay within it, and moving tickets
between features is rejected. Revisions and advisory locks cover the repository's
features, tickets and triage-label mapping. Python and CLI reads return all
features, with feature names in their issue rows.

HTTP discovery lists one scratch source per repository. Legacy feature and issues
paths select that feature in the browser, including an issues directory that does
not exist yet. The selection survives reload. List and board project filters,
feature creation defaults, read-only projects and All projects are covered by the
expanded browser workflow. Backend and Python API/CLI documentation were updated.

Validation:

- `npm run check`: 52 Python tests, 91 TypeScript unit/API tests, TypeScript checks
  and the production build passed. The full browser run passed 61 of 63 tests.
- The board sorting workflow's reload was interrupted during the rebase and passed
  on an isolated rerun. All new scratch workflows passed, including feature
  filters, spec-only creation, saved legacy paths and aggregate discovery.
- The remaining browser failure is the pre-existing date-dependent assertion in
  `tests/e2e/workspace.spec.ts:225`: it expects Cycle 12, which ended 2026-10-11;
  Cycle 13 is current on 2026-10-14. Its expectation and the seed dates are
  unchanged from main. No unrelated tests or seed data were edited.
- The rebased main build passed and the enabled user service restarted. Loopback,
  private HTTP and private HTTPS passed health and exact HTML/asset checks.
  Production HTTP tests against a temporary repository verified discovery,
  canonical feature aliases, unique IDs, required-feature creation, first-ticket
  creation in a spec-only feature and feature-scoped deletion protection. The
  temporary repository was removed; existing repositories were not modified.

The main tracker conflict was resolved by retaining main's current tracker and
reapplying only this issue's In Progress transition through revision-checked
`hai-tasks`. Issue 29's scheduling and all unrelated acceptance flags survived.
This issue is completed and unchecked, pending user acceptance. Tailscale routes
were unchanged.

Backup: `/tmp/hai28-before/live.tgz`. Logs: `/tmp/hai28-check-final.log`,
`/tmp/hai28-board-rerun.log`, `/tmp/hai28-main-build.log`,
`/tmp/hai28-deploy.log`, and `/tmp/hai28-production-smoke.log`.
