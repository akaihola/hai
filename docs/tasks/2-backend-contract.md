# Define replaceable backends

Historical implementation completed on 2026-10-03, awaiting user acceptance.

Define a provider-independent issue/workspace model and an asynchronous
`WorkspaceBackend`. Keep all issue mutations behind that contract. Use capability
flags for unsupported actions and explicit current-member identity.

The browser adapter persists a validated workspace, rejects corrupted data without
overwriting it, and supports lossless JSON backups and readable Markdown export.
The initial 9 unit tests and browser contract checks passed. See `docs/backends.md`.
