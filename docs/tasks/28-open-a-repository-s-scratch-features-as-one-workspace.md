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
