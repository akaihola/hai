# Python API and CLI

`hai_tasks` owns parsing, validation, storage, queries and reports. `hai_server`
adapts it to Hai's existing HTTP API. The browser continues to use
`WorkspaceBackend`; it never accesses files, SSH credentials or Git credentials.

Python 3.11+ is required on Linux or another POSIX system with `flock` and
`O_NOFOLLOW`. The package has no Python runtime dependencies. Git is required
when allocating description numbers, including for local projects, because the
allocator checks available Git history. SSH sources also need OpenSSH.

From the repository, run `python3 -m hai_tasks --help` or
`python3 -m hai_server`. For commands available outside the checkout:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/hai-tasks --help
```

## Sources

| Source | Example | Requirements |
| --- | --- | --- |
| Local | `/home/agent/prg/hai` or `/home/agent/prg/hai/TASKS.md` | Existing tracker and readable description files |
| SSH | `ssh://user@host:22/home/user/project/TASKS.md` | Key authentication, a trusted host key, and `hai_tasks` installed for remote `python3` |
| GitHub | `github://owner/repository?ref=main&path=TASKS.md` | Git HTTPS authentication and repository access; write access for mutations |

SSH uses batch mode and does not prompt, alter host keys or install remote code.
It sends JSON on standard input to `python3 -m hai_tasks rpc`. Paths and task
content never become shell commands. Install the package on the remote machine
before using it. Only local paths are accepted by the remote RPC endpoint.

GitHub sources use authenticated Git over HTTPS. Configure Git's credential
helper for the account running the CLI or service. Do not put tokens in source
URIs. The optional `ref` selects a branch; omitting it uses the default branch.
`path` is a repository-relative Markdown path. URL-encode query values and quote
URIs containing `&` in the shell. Descriptions are relative to the tracker's
parent directory.

Each GitHub operation clones the repository into a temporary directory with
history, then removes the checkout. This supports historical number allocation
without a persistent cache, at the cost of clone latency and disk use. A mutation
commits the tracker and descriptions together and pushes without force. A
competing branch update rejects the push. Branch protection may require using a
writable branch. Hai does not open pull requests or bypass protection.

GitHub support here edits TASKS.md files. GitHub Issues and Projects remain a
separate planned provider.

## Read, query and report

```bash
python3 -m hai_tasks parse TASKS.md
python3 -m hai_tasks read .
python3 -m hai_tasks query . /path/to/another/project --status in_progress
python3 -m hai_tasks query . --text backend --label urgent --no-accepted
python3 -m hai_tasks report . 'ssh://user@host/home/user/project/TASKS.md'
python3 -m hai_tasks export . --format tasks
python3 -m hai_tasks export . --format json
```

`parse` reads the tracker text without opening descriptions and accepts `-` for
standard input. `read` returns the workspace, revision and capabilities. Queries
return rows containing `source`, `revision` and `issue`. Filters include text,
section, status, priority, label and acceptance. Reports count matching tasks by
source, section and acceptance. If any project fails, a multi-project command
fails instead of presenting an incomplete report as complete.

Commands emit JSON except `export`, which emits the requested file contents.
Errors are JSON on standard error with a message and HTTP-style status; the
command exits with status 1. Argument errors exit with status 2.

## Modify a tracker

Every mutation requires the revision returned by `read` or `query`. Issue IDs
are the stable `id` values in that response, such as `task-7` or a metadata UUID.

```bash
python3 -m hai_tasks read .
python3 -m hai_tasks create . --revision REVISION --json '{"title":"New task"}'
python3 -m hai_tasks update . task-7 --revision REVISION --json '{"sourceSection":"In Progress"}'
python3 -m hai_tasks update . task-7 --revision REVISION --json '{"sourceSection":"Completed / Accepted"}'
python3 -m hai_tasks reorder . --revision REVISION --json '{"issueIds":["task-7","task-8"]}'
python3 -m hai_tasks delete . task-7 --revision REVISION
```

Replace `REVISION` with the current revision and reload after every mutation.
`--json -` reads a patch from standard input. Description changes use the same
`description` field as the browser; adding a description to a simple task
allocates a numbered file and reference. Deleting a task retains its description
and reference and reserves its number. Deletion fails if other tasks depend on it.

`reorder` requires every Ordered backlog ID exactly once, with prerequisites
before dependents. Completion leaves the task unchecked. `accepted: true` is an
explicit acceptance action, to be used only at the user's direction. Reopening
an accepted issue requires explicitly clearing acceptance.

Revisions cover the tracker and linked descriptions. Local revisions also bind
to the source path. GitHub revisions bind to the source URI and commit. Local
and SSH operations take an advisory directory lock shared by the server and
CLI. External editors do not have to honor that lock, so the store rechecks the
revision before replacing files. It preserves unrelated text, original line
endings, metadata, references, dependencies and acceptance.

Individual local file replacements are atomic. A tracker plus description pair
is not a crash-atomic transaction. Rollback checks that committed files still
contain this operation's bytes before restoring anything. If another writer has
changed a committed file, Hai preserves the files and reports a partial save.
External editors can still race between the last revision check and replacement.
After a connection loss during any remote write, read the source and inspect the
result before retrying; the remote write may have succeeded.

## Python API

```python
from hai_tasks import open_source, parse_tasks, query, report

parsed = parse_tasks(open("TASKS.md", encoding="utf-8", newline="").read())
source = open_source("/path/to/project")
snapshot = source.read()
issue = snapshot["workspace"]["issues"][0]
result = source.mutate(
    "update", snapshot["revision"], issue["id"], {"priority": "high"}
)
print(result["revision"])
print(report(["/path/to/project", "/path/to/another/project"]))
```

`open_source` returns an object with `read()`, `mutate(operation, revision, id,
input)`, `export(format)` and `capabilities`. A snapshot includes `workspace`,
`revision`, parsed source and loaded documents. `TasksError` carries a `status`
and readable message. `parse_tasks`, `mutate_tasks` and `workspace_of` are also
available for in-memory use; `mutate_tasks` returns description writes for the
caller to persist. Use a source store when editing actual files.

The package supports issue CRUD, descriptions, priorities, labels, workflow
sections and backlog ordering. It declares assignees, project/cycle entities and
imports unsupported. Opening several project trackers does not create synthetic
project entities in a workspace.

## Configure remote sources in the web server

The HTTP server accepts local paths under `HAI_PROJECT_ROOTS`. Remote sources
must be explicitly configured by the operator:

```bash
export HAI_REMOTE_SOURCES='{"team":"ssh://user@host/home/user/project/TASKS.md","repo":"github://owner/repository?ref=main"}'
python3 -m hai_server
```

Enter `/@team` or `/@repo` in the browser's Open project dialog. The alias is the
stable source path returned by the API and pinned by `WorkspaceBackend`.
Unconfigured remote URIs are rejected; browser requests cannot choose arbitrary
SSH hosts or GitHub repositories. The credentials belong to the server account.
The private host/origin restrictions and Tailscale deployment still apply.

## Local Markdown feature tickets

The same API and revision-checked CLI can open `.scratch/<feature-slug>` or its
`issues/` directory. `read` returns `workflow: scratch`, the available
`sourceStates`, and unsupported fields in its capabilities. Use `sourceState` to
retain the triage role when changing status:

```bash
python3 -m hai_tasks read /path/to/project/.scratch/search
python3 -m hai_tasks create /path/to/project/.scratch/search --revision REVISION --json '{"title":"Add search","sourceState":"ready-for-agent"}'
python3 -m hai_tasks update /path/to/project/.scratch/search ISSUE_ID --revision REVISION --json '{"sourceState":"ready-for-human"}'
python3 -m hai_tasks query /path/to/project/.scratch/search --status canceled
```

JSON export is a workspace snapshot. Markdown export combines the original tickets
for reading, rather than creating a TASKS.md tracker. See [backend conventions](backends.md#matt-pocock-local-markdown-issues).
