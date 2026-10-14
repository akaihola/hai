# Backends and portable data

Hai uses the repository TASKS.md through its Python service by default. The same service opens Matt Pocock `.scratch/` feature tickets and `docs/backlog/`-style workflow directories. The browser-storage demo is available explicitly with `?backend=local`. GitHub, Beans, taskmd, and Markdown Ticket remain planned integrations.

## Adapter contract

`src/domain.ts` defines the provider-independent `Workspace`, `Issue`, and `WorkspaceBackend` types. The UI receives a `WorkspaceBackend`. `src/adapters/tasks.ts` implements the default HTTP adapter; `src/adapters/local.ts` exports the separate `localBackend` and injectable `createLocalBackend(storage)` factory. Data operations are asynchronous even though browser storage is synchronous.

| Operation | Result |
| --- | --- |
| `listWorkspaces()` | Optional; configured workspace sources, enabled by `canListWorkspaces` |
| `load()` | Workspace with issues, projects, cycles, members, and explicit `currentMemberId` |
| `createIssue(input)` | Persisted issue with provider-assigned identity and timestamps |
| `updateIssue(id, patch)` | Persisted issue; identity and creation time cannot change |
| `deleteIssue(id)` | Deletes the issue or rejects if it does not exist |
| `createProject(input)` / `createCycle(input)` | Optional; persisted entity with provider-assigned identity |
| `updateProject(id, patch)` / `updateCycle(id, patch)` | Optional; persisted entity with unchanged identity and issue relations |
| `deleteProject(id)` / `deleteCycle(id)` | Optional; removes the entity and clears its issue assignments atomically |
| `reorderBacklog(issueIds)` | Optional; persists the complete Ordered backlog order and returns the workspace |
| `exportData('json')` | Versioned workspace snapshot; a complete backup for the browser adapter |
| `exportData('tasks')` | Original tracker for the file adapter; readable snapshot for the browser adapter |
| `importData(content, 'json')` | Validates and replaces the workspace when the backend supports import |

`capabilities` describes persistence and supported create, update, delete, import, and export operations. A future backend must report unsupported operations as unavailable. GitHub, file formats, and local storage have different deletion and workflow semantics; the frontend must not simulate an unsupported write.

Project and cycle administration use independent `canCreateProject`,
`canUpdateProject`, `canDeleteProject`, `canCreateCycle`, `canUpdateCycle`, and
`canDeleteCycle` flags. The UI requires both the capability and its method;
missing or false flags disable the operation. The browser adapter supports all
six. TASKS.md declares them false, provides no entity methods, and has no implicit
project or cycle records. Opening another TASKS.md folder is a separate operation.

Entity IDs cannot be supplied or changed. Invalid names, project status/colors,
calendar dates, and inverted cycle ranges reject the entire write. Deleting an
entity retains every issue, clears only the matching relation, and updates the
affected issues' timestamps in the same save. An optional project target date can
be cleared with `targetDate: undefined`.

Cycles are current when the present time lies within their date range. Date-only
boundaries use local midnight through 23:59:59.999 on the ending day; ISO timestamps
keep their exact instants. Persisted range validation keeps UTC day boundaries,
including the ending day, and the existing `Date.parse` behavior for timestamps.
Zone-less timestamps use the runtime's local timezone; explicit offsets preserve
instants across timezones. Current badges update every minute and after edits.
Overlapping ranges may produce multiple current badges; the first matching cycle
in provider order is the navigation default. When no cycle is current, the shortcut
is disabled; the cycle view can still browse past or upcoming cycles.

`canOpenWorkspace` enables the project picker when `openWorkspace(path)` is available. It returns a fresh backend bound to the selected project, with `source.name` and `source.path` describing the canonical tracker. Unsupported providers omit the capability and method. Browser preferences remember the selection; they do not hold project data.

`canReorderBacklog` enables ordering only when the backend implements `reorderBacklog`. The TASKS.md backend supports it; the browser demo does not.

`currentMemberId` is a member ID or `null`. Authentication belongs to the provider; member list order never establishes the current user's identity. Issue relation IDs can be `null` and otherwise must refer to an existing project, cycle, or member. Labels are strings. Dates use ISO-compatible strings. Each issue has a stable internal ID and a separate visible identifier.

## TASKS.md service

`hai_tasks` is the standalone Python parser, storage and multi-project API/CLI.
`hai_server` supplies the HTTP adapter. Local, SSH and GitHub TASKS.md sources
share the same parser and mutation rules. See [Python API and CLI](python-api-cli.md)
for installation, transport behavior and configured remote source aliases.

The service reads `TASKS.md` and numbered description references under `docs/tasks/`. It uses Filemill's five work sections and preserves the separate acceptance checkbox in `Completed / Accepted`. `Issue.sourceSection` retains the original section, including the distinction between unverified proposals and ordered backlog. `Issue.accepted` reflects explicit user acceptance. Completing work never checks that box.

Existing wrapped summaries load in full. Titles have a shared 50,000-character
limit in the parser, adapters, editor, and JSON backups. Edits to other fields
preserve the original summary wrapping. JSON mutation requests are limited to
1 MB, allowing long multibyte titles and descriptions in the same request.

`GET /api/workspace` returns `{ workspace, revision }`. Mutations use `POST /api/issues`, `PATCH /api/issues/:id`, and `DELETE /api/issues/:id`, with the last loaded revision in `If-Match`. The revision covers the tracker and linked descriptions. Stale revisions are rejected and require reloading before retrying.

`POST /api/backlog/order` accepts `{ issueIds: string[] }` with the same `If-Match` requirement and returns `{ workspace, revision }`. Supply every Ordered backlog issue exactly once. Dependencies within that section must precede their dependents. Reordering moves existing task blocks without changing their contents or timestamps, description files, or the surrounding tracker text. A newly created issue joins the end of the Ordered backlog; an issue moved into that section lands at its top, after any prerequisites it depends on.

The service serializes writes, waits for pending writes before reading, and checks revisions before replacing files. Each replacement is atomic, but a tracker and description update is not a crash-atomic transaction across both files. On failure, rollback proceeds only if every committed file still matches this operation's bytes. If any file changed again, current files are preserved and the service reports a partial save; refresh and review before retrying. These checks are optimistic: external writers can still race between the final revision check and replacement.

Simple tasks receive persistent IDs in Hai metadata comments on their first write. New description numbers are allocated from unused IDs after checking references, description filenames, available Git history, and the `hai:reserved-numbers` comment. Numbered creation and deletion preserve this ledger so retired numbers are not reused after cleanup without Git. Keep the ledger during tracker maintenance.

API requests may include `?source=` with an absolute server folder or TASKS.md path, including `~/` paths. With no source, the configured tracker is used. Responses identify the canonical source; the HTTP adapter pins every subsequent operation to it. Directory locks and revision tokens are scoped to that source, including when identical trackers have the same issue identifiers. `HAI_PROJECT_ROOTS` sets allowed roots using the OS path delimiter. The default is the parent of the configured project directory; the configured project itself remains allowed. Symbolic tracker files and project links escaping allowed roots are rejected.

File mutations preserve unrelated source, reference links, and rules. Deleting an issue removes its own reference link and description file unless another issue still uses them. Shared description files and references remain, and the deleted number stays in `hai:reserved-numbers`. The UI splits the combined completion section into Completed and Accepted groups without changing the source format. It exposes the native source sections and hides unsupported member/project/cycle controls. The **Refresh source** action reads external edits. Source import is disabled; edit the Markdown files directly instead.

`GET /api/export?format=tasks` exports the real tracker. JSON export is a workspace snapshot; it does not replace a filesystem backup of the tracker and its linked descriptions. The service only serves the configured `dist/` and fixed API routes. Deployment host/origin checks and private access are described in [deployment.md](deployment.md).

## Browser persistence

Storage key: `hai.workspace.v1`. The envelope contains `version: 1`, `nextIssueNumber`, and `workspace`. A new browser profile gets a sample workspace with 27 issues. Edits are persisted before an operation resolves. The adapter reads current storage before every operation, and returns independent data objects.

The backup validator checks the schema version, entity IDs and uniqueness, issue identifiers, status and priority values, relation integrity, current member identity, dates, text lengths, colors, and issue counter. Both writes and imports enforce a 2 MiB UTF-8 size limit. Storage failures reject with a visible error. Invalid saved data is never replaced with the sample workspace, including during an import. Preserve the raw storage value before manual recovery.

Browser storage is tied to the origin and browser profile. Clearing site data removes it. Export JSON to back it up. There is no server, account authentication, collaboration, cross-tab notification, or conflict coordination. Simultaneous writes in different tabs may overwrite one another; use one editing tab. A production shared backend needs revision checks or equivalent conflict handling.

## Browser-demo import and export

JSON is the lossless exchange format for the browser workspace. Import replaces the workspace only after validation and requires a version 1 Hai backup. Arbitrary JSON and backups with dangling relations are rejected without changing saved data. The UI asks for confirmation before replacing a workspace.

`TASKS.md` is an export-only snapshot. Hai writes a document headed `# Tasks`, groups tasks under status headings, and writes `- [x]` for done issues and `- [ ]` for other statuses. The status heading distinguishes backlog, review, and canceled tasks. Each task includes its identifier, title, priority, project, assignee, cycle, labels, and indented description when present.

The browser demo's readable Markdown export is independent of the live Filemill-style tracker. It is not a Beans, taskmd, or Markdown Ticket file. Markdown cannot be imported through this adapter; use the JSON backup to preserve IDs, timestamps, and entity relationships. The default file backend uses the Filemill-style schema and Python transport described above.

## Future connector mappings

These are researched implementation directions, not shipped connections. Sources checked on 2026-10-03; provider schemas should be pinned and tested before implementation.

### GitHub Issues and Projects

Map repository issue IDs to stable Hai IDs, issue numbers to visible identifiers, `title` and `body` to content, labels to labels, and assignees to members. Issue-list responses can include pull requests, so a connector must exclude entries with `pull_request`. GitHub Issues provides open/closed states and closing reasons; Hai's intermediate workflow states need an explicit mapping. [GitHub Issues REST API](https://docs.github.com/en/rest/issues/issues).

Projects exposes items and custom fields through GraphQL. A connector could map a project's status field to Hai status and an iteration field to cycles, but only after reading the project's actual field configuration. Projects items and repository issues have distinct identities. Credentials, scopes, pagination, rate limits, remote errors, and conflict detection belong in a server-side connector, not browser localStorage. [GitHub Projects API guide](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).

### Beans

Beans stores Markdown in `.beans/` and offers a CLI and GraphQL query engine. Its project setup also includes `.beans.yml`. [Beans repository](https://github.com/hmans/beans).

The `Bean` model defines title, status, type, priority, tags, timestamps, body, parent and dependency relationships; IDs come from filenames. Title/body/tags/timestamps can map to Hai fields. Read configured workflows before mapping statuses and priorities. Preserve filenames, ordering, unknown fields, parent relationships, and dependencies when writing; these are not all represented by Hai. The inspected model does not provide Hai's member or cycle model, so those fields need an explicit policy before enabling writes. Use the CLI or a local filesystem bridge with concurrency checks. [Beans model and serialization](https://github.com/hmans/beans/blob/main/pkg/bean/bean.go).

### taskmd

Each task is a Markdown file with YAML frontmatter. A proposed mapping is `id` to identifier, `title` to title, Markdown body to description, `tags` to labels, and `owner` to an explicitly resolved member. Map `pending` to todo, `in-progress` to in_progress, `in-review` to in_review, `completed` to done, and `cancelled` to canceled; `critical` priority maps to urgent. `blocked` has no matching Hai status, and Hai backlog has no separate taskmd status. Do not silently flatten these states on write. Groups, phases, dependencies, parent links, verification checks, and other metadata also need preservation. Use taskmd's API/CLI or a local bridge; a browser cannot directly edit an arbitrary repository directory. [taskmd specification](https://driangle.github.io/taskmd/reference/specification), [taskmd repository](https://github.com/driangle/taskmd).

### Markdown Ticket

Markdown Ticket stores tickets in Markdown/Git and supports multiple projects, a CLI, and MCP operations. Map ticket keys and projects to Hai identities; inspect the configured schema for title, description, status, priority, and assignee mappings. Preserve structured sections, ticket types, and all unsupported metadata. [Markdown Ticket repository](https://github.com/andkirby/markdown-ticket).

The documented MCP tools include `list_projects`, `list_crs`, `get_cr`, `create_cr`, attribute and status updates, and `delete_cr`. A connector could translate these into the Hai adapter contract through a configured bridge. Respect deployment authentication and provider errors. Do not hard-code a localhost endpoint or claim a connection before verifying one. [MCP server guide](https://github.com/andkirby/markdown-ticket/blob/main/docs/MCP_SERVER_GUIDE.md).

## Checks

Run `npm test` to check browser persistence and backups, tracker parsing, acceptance semantics, identifier allocation, file mutations, guarded rollback, stale revisions, path boundaries, and host/origin checks. Tests use injected browser storage, temporary trackers, and loopback HTTP servers; they do not require external services. Browser workflows run separately with `npm run test:e2e`.


## All projects

The TASKS.md backend exposes an All projects scope through `WorkspaceBackend`.
`GET /api/projects` lists the configured tracker, TASKS.md files directly in
allowed project roots and their immediate project directories, previously opened
nested trackers, and configured remote aliases. Discovery does not recurse or
follow project-directory symlinks. Open a nested project once, or configure its
parent in `HAI_PROJECT_ROOTS`, to include it. Every load still applies the existing
source path and description security checks. Canonical paths deduplicate aliases.

The aggregate adapter combines real source snapshots without synthetic project
entities. Each issue carries its `workspaceSource`; its in-memory ID combines the
canonical path and original task ID so repeated `[1]` references remain distinct.
Project names appear in lists, board cards and search. The project selector shows
paths as well as names. Unreadable sources produce a collapsible incomplete-view
warning; successfully loaded projects remain browsable. Refresh retries all sources
and discovers new trackers. The aggregate scope uses manual refresh, including for
local sources, to avoid automatic remote operations when aliases are configured.

The aggregate declares creation, mutation, backlog ordering and export unsupported.
Opening an issue resolves its original ID and loads the owning single-project
backend with a fresh revision, then opens the editor. Edits and exports use the
normal single-tracker workflow. The browser remembers the selected scope and last
single project. The browser-only workspace already combines its own project issues
in All issues and retains its existing project filter.

The TASKS.md picker fetches the configured project catalog in both single-project
and all-project views through `listWorkspaces()`, gated by `canListWorkspaces`.
Recent projects remain first; the full list can be filtered by name or path,
without loading each tracker. Catalog errors retain recent entries and manual
path opening.

## Matt Pocock local Markdown issues

Each `.scratch/<feature-slug>/` directory is a workspace. Open it from the
project picker, enter its absolute server path, or enter its `issues/` directory.
Hai discovers features beneath projects in the configured project roots, including
features that only have a spec. Saving their first issue creates `issues/`.
A project directory still opens its `TASKS.md`; features appear as separate sources
in All projects.

Hai reads `issues/NN-slug.md` tickets with a `# Title` and a `Status:` line before
the first `##` heading. Missing status means `needs-triage`. New files use the next
number after the highest existing ticket, starting at `01`. Editing a title keeps
the filename and issue ID. Specs, maps and unrelated files are not issues.

The editor, list groups, board columns and drag actions retain the source state:

| Source state | Hai status |
| --- | --- |
| `needs-triage`, `needs-info`, `open` | Backlog |
| `ready-for-agent`, `ready-for-human` | Todo |
| `wontfix` | Canceled |
| `claimed` | In Progress |
| `resolved` | Done |

Renamed triage labels come from the backtick-delimited mapping table in
`docs/agents/triage-labels.md`. Unknown or conflicting labels produce an error
with the source path. Wayfinder's `Type:`, `Blocked by:`, answers and comments
remain in the Markdown body. Hai prevents deleting tickets referenced by another
ticket's `Blocked by:` line; it does not run wayfinder frontier selection or update
map decisions.

Title and status edits preserve the rest of the file, including comments and line
endings. The description editor contains the remaining Markdown body. Explicitly
editing that body replaces it. Revisions include every ticket and the triage-label
mapping; stale saves fail rather than overwrite changes made outside Hai. Writes
use advisory locks and atomic replacement of individual files, with the same
regular-file and symlink restrictions as the TASKS.md backend.

This backend supports create, update, delete, automatic refresh, combined Markdown
export and JSON snapshots. It has no user-acceptance checkbox, priority, arbitrary
labels, assignments, projects, cycles, backlog reordering or import. `resolved`
records resolution, without inventing TASKS.md acceptance. Local paths and SSH
sources work; the GitHub TASKS.md source does not support scratch directories.

## Markdown backlog directories

Some repositories keep one Markdown document per work item under `docs/` and use
the directory as the status, following the nixos-config conventions: `issues/` is
the inbox, `ideas/` holds rough proposals, `backlog/` holds well-defined tasks,
`in-progress/` holds active work, `completed/` holds finished work and `rejected/`
holds declined proposals. Hai opens that layout as one workspace from `<repo>/docs`,
any of those six directories, or a project directory that has `docs/backlog/` and
no `TASKS.md`. Project discovery lists it as `<repo> / docs` next to any TASKS.md
tracker in the same repository.

Every `*.md` file directly inside the six directories is an issue, except
`README.md`. Other files, `.gitkeep` and sibling directories such as
`contributing/` or `research/` are ignored. The file name is the identity: the
visible identifier is the file name without `.md`, and the stable ID is derived
from it, so moving a document between directories keeps its ID. When the same file
name exists in several directories, later copies in the workflow order are
identified as `<state>/<name>` instead.

The title is the first `# ` heading anywhere in the file, or the file name when a
document has none, which the issues inbox allows. The description is the rest of
the file. Hai does not read the `**Status:**`, `**Completed:**` or acceptance
criteria lines; they stay in the description.

| Directory | Hai status |
| --- | --- |
| `issues`, `ideas` | Backlog |
| `backlog` | Todo |
| `in-progress` | In Progress |
| `completed` | Done |
| `rejected` | Canceled |

Changing the source state moves the file to that directory without renaming it,
creating the directory when needed, and fails if the target already has a file
with the same name. Hai does not run the repository's `/move-doc` checks, so the
agent or user remains responsible for the template sections each directory
expects. Title edits rewrite the heading, or insert one at the top of a document
without a heading. Explicitly editing the description replaces the body below the
heading. Other edits preserve the file byte for byte, including line endings.

Creating an issue writes `# Title` and the description to `<state>/<slug>.md`;
the default state is `issues`. Deleting removes the file. Revisions cover every
document in the six directories; stale saves fail rather than overwrite external
changes. Writes use the shared advisory directory lock on `docs/`, atomic staging,
publication without overwriting an unexpected file, and the same regular-file and
symlink restrictions as the other local backends. This backend supports create,
update, delete, automatic refresh, combined Markdown export and JSON snapshots.
It has no acceptance checkbox, priority, labels, assignments, projects, cycles,
dependencies, backlog reordering or import. JSON export fails above the 2 MB
snapshot limit, which large repositories can reach; the Markdown files remain the
backup. Local paths and SSH sources work; the GitHub TASKS.md source does not
support backlog directories.
