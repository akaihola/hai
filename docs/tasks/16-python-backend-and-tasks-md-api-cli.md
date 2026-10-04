Convert the backend from TypeScript into Python. Split the TASKS.md backend plugin so there's a Python API and CLI for parsing, querying, modifying, and reporting on TASKS.md files from multiple projects. Projects can be local, over SSH, or on GitHub. Always follow https://raw.githubusercontent.com/Green-PT/honey-for-devs/refs/heads/main/skills/honey/SKILL.md

## Implementation plan

- Replace the Node server, parser and file store with Python, retaining the browser HTTP contract and security checks.
- Package tracker parsing and mutations separately from the web server. Provide query, report, export, create, update, delete and backlog ordering commands.
- Share the same tracker logic across local files, SSH with an installed remote Python package, and GitHub repositories through authenticated Git. Remote writes must detect stale revisions and preserve unrelated repository content.
- Support multiple sources per query/report and explicitly configured remote sources in the web server.
- Preserve sections, wrapping, references, dependencies, metadata, reserved numbers and explicit user acceptance.
- Exercise the existing regression and browser suites against Python, add transport and CLI tests, document installation and deployment, then deploy using the project workflow.

## Implementation and validation, 2026-10-04

- Replaced all four TypeScript server modules with `hai_server` and the standalone `hai_tasks` package. No Python runtime dependencies; Python 3.11+ and POSIX file locking are required.
- Added an installable `hai-tasks` command and Python API for parsing, reading, querying multiple projects, reports, exports, issue CRUD and backlog ordering. Every file mutation requires a current revision.
- Added SSH transport using the installed remote Python CLI and GitHub transport using authenticated Git. GitHub writes commit the tracker and descriptions together and use non-force pushes. Configured remote aliases can be opened through the existing browser adapter.
- Preserved source sections, raw wrapping, reference links, metadata, dependencies, reserved identifiers and explicit acceptance. Added cross-process directory locks for local server/CLI coordination.
- `npm run check` passed 17 Python tests, 56 TypeScript/client/API regressions, 44 Chromium workflows, TypeScript validation and the production build. Two former Node filesystem-injection tests now run natively in Python. Final rollback and GitHub staging changes passed the Python suite again.
- Built and installed the package in an isolated environment and ran its CLI and server entry points from outside the checkout.
- SSH tests execute the remote RPC through a local subprocess. GitHub transport tests use real temporary Git repositories, including concurrent pushes and ignored description paths. No live remote credentials or repositories were supplied or changed.
- Usage and transport limitations are documented in `docs/python-api-cli.md`. GitHub currently clones with history per operation; local tracker/description pairs are not crash-atomic across files.
