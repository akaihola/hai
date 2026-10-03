# Backends and portable data

Hai uses the repository TASKS.md through its Node service by default. The browser-storage demo is available explicitly with `?backend=local`. GitHub, Beans, taskmd, and Markdown Ticket remain planned integrations.

## Adapter contract

`src/domain.ts` defines the provider-independent `Workspace`, `Issue`, and `WorkspaceBackend` types. The UI receives a `WorkspaceBackend`. `src/adapters/tasks.ts` implements the default HTTP adapter; `src/adapters/local.ts` exports the separate `localBackend` and injectable `createLocalBackend(storage)` factory. Data operations are asynchronous even though browser storage is synchronous.

| Operation | Result |
| --- | --- |
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

The service reads `TASKS.md` and numbered description references under `docs/tasks/`. It uses Filemill's five work sections and preserves the separate acceptance checkbox in `Completed / Accepted`. `Issue.sourceSection` retains the original section, including the distinction between unverified proposals and ordered backlog. `Issue.accepted` reflects explicit user acceptance. Completing work never checks that box.

Existing wrapped summaries load in full. Titles have a shared 50,000-character
limit in the parser, adapters, editor, and JSON backups. Edits to other fields
preserve the original summary wrapping. JSON mutation requests are limited to
1 MB, allowing long multibyte titles and descriptions in the same request.

`GET /api/workspace` returns `{ workspace, revision }`. Mutations use `POST /api/issues`, `PATCH /api/issues/:id`, and `DELETE /api/issues/:id`, with the last loaded revision in `If-Match`. The revision covers the tracker and linked descriptions. Stale revisions are rejected and require reloading before retrying.

`POST /api/backlog/order` accepts `{ issueIds: string[] }` with the same `If-Match` requirement and returns `{ workspace, revision }`. Supply every Ordered backlog issue exactly once. Dependencies within that section must precede their dependents. Reordering moves existing task blocks without changing their contents or timestamps, description files, or the surrounding tracker text.

The service serializes writes, waits for pending writes before reading, and checks revisions before replacing files. Each replacement is atomic, but a tracker and description update is not a crash-atomic transaction across both files. On failure, rollback proceeds only if every committed file still matches this operation's bytes. If any file changed again, current files are preserved and the service reports a partial save; refresh and review before retrying. These checks are optimistic: external writers can still race between the final revision check and replacement.

Simple tasks receive persistent IDs in Hai metadata comments on their first write. New description numbers are allocated from unused IDs after checking references, description filenames, available Git history, and the `hai:reserved-numbers` comment. Numbered creation and deletion preserve this ledger so retired numbers are not reused after cleanup without Git. Keep the ledger during tracker maintenance.

API requests may include `?source=` with an absolute server folder or TASKS.md path, including `~/` paths. With no source, the configured tracker is used. Responses identify the canonical source; the HTTP adapter pins every subsequent operation to it. Store queues and revision tokens are scoped to that source, including when identical trackers have the same issue identifiers. `HAI_PROJECT_ROOTS` sets allowed roots using the OS path delimiter. The default is the parent of the configured project directory; the configured project itself remains allowed. Symbolic tracker files and project links escaping allowed roots are rejected.

File mutations preserve unrelated source, reference links, and rules. The UI splits the combined completion section into Completed and Accepted groups without changing the source format. It exposes the native source sections and hides unsupported member/project/cycle controls. The **Refresh source** action reads external edits. Source import is disabled; edit the Markdown files directly instead.

`GET /api/export?format=tasks` exports the real tracker. JSON export is a workspace snapshot; it does not replace a filesystem backup of the tracker and its linked descriptions. The service only serves the configured `dist/` and fixed API routes. Deployment host/origin checks and private access are described in [deployment.md](deployment.md).

## Browser persistence

Storage key: `hai.workspace.v1`. The envelope contains `version: 1`, `nextIssueNumber`, and `workspace`. A new browser profile gets a sample workspace with 27 issues. Edits are persisted before an operation resolves. The adapter reads current storage before every operation, and returns independent data objects.

The backup validator checks the schema version, entity IDs and uniqueness, issue identifiers, status and priority values, relation integrity, current member identity, dates, text lengths, colors, and issue counter. Both writes and imports enforce a 2 MiB UTF-8 size limit. Storage failures reject with a visible error. Invalid saved data is never replaced with the sample workspace, including during an import. Preserve the raw storage value before manual recovery.

Browser storage is tied to the origin and browser profile. Clearing site data removes it. Export JSON to back it up. There is no server, account authentication, collaboration, cross-tab notification, or conflict coordination. Simultaneous writes in different tabs may overwrite one another; use one editing tab. A production shared backend needs revision checks or equivalent conflict handling.

## Browser-demo import and export

JSON is the lossless exchange format for the browser workspace. Import replaces the workspace only after validation and requires a version 1 Hai backup. Arbitrary JSON and backups with dangling relations are rejected without changing saved data. The UI asks for confirmation before replacing a workspace.

`TASKS.md` is an export-only snapshot. Hai writes a document headed `# Tasks`, groups tasks under status headings, and writes `- [x]` for done issues and `- [ ]` for other statuses. The status heading distinguishes backlog, review, and canceled tasks. Each task includes its identifier, title, priority, project, assignee, cycle, labels, and indented description when present.

The browser demo's readable Markdown export is independent of the live Filemill-style tracker. It is not a Beans, taskmd, or Markdown Ticket file. Markdown cannot be imported through this adapter; use the JSON backup to preserve IDs, timestamps, and entity relationships. The default file backend uses the Filemill-style schema and Node transport described above.

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
