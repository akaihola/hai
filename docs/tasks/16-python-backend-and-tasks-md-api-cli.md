Convert the backend from TypeScript into Python. Split the TASKS.md backend plugin so there's a Python API and CLI for parsing, querying, modifying, and reporting on TASKS.md files from multiple projects. Projects can be local, over SSH, or on GitHub. Always follow https://raw.githubusercontent.com/Green-PT/honey-for-devs/refs/heads/main/skills/honey/SKILL.md

## Implementation plan

- Replace the Node server, parser and file store with Python, retaining the browser HTTP contract and security checks.
- Package tracker parsing and mutations separately from the web server. Provide query, report, export, create, update, delete and backlog ordering commands.
- Share the same tracker logic across local files, SSH with an installed remote Python package, and GitHub repositories through authenticated Git. Remote writes must detect stale revisions and preserve unrelated repository content.
- Support multiple sources per query/report and explicitly configured remote sources in the web server.
- Preserve sections, wrapping, references, dependencies, metadata, reserved numbers and explicit user acceptance.
- Exercise the existing regression and browser suites against Python, add transport and CLI tests, document installation and deployment, then deploy using the project workflow.
