See `~/prg/filemill-screencast/` for how Matt Pocock's skills organize issues:
>Issues and specs live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.
>
>### Triage labels
>
>The five default role names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

Add support for this similarly how `TASKS.md` is supported. Grill me if necessary.

## Implementation plan, 2026-10-10

- Expose each `.scratch/<feature>/` as a filesystem workspace through
  `WorkspaceBackend` and the Python source API, alongside TASKS.md sources.
- Read and edit individual numbered issue files. Preserve specs, maps, comments,
  unknown body fields and filenames on title/status changes.
- Keep the five triage roles distinct in editor selections, groups and board
  moves. Read renamed roles from the repository's triage-label mapping.
- Also support wayfinder's open/claimed/resolved states and retain its body fields.
- Use revision checks across all tickets and the label mapping, advisory locks,
  regular-file checks and atomic replacement. Disable unsupported fields/actions.
- Cover storage, HTTP, concurrency and browser workflows. Run `npm run check`.

Each feature is a separate source so creation has a definite destination.
Spec-only features open as empty workspaces. New tickets start at 01 and use the
next number after existing tickets. Hai does not implement wayfinder orchestration
or alter maps automatically.

## Completion and validation, 2026-10-10

Implemented feature workspaces, numbered ticket CRUD, native triage states and
renamed labels, wayfinder states, board moves, source discovery and All projects.
Specs, maps, comments, body fields and filenames survive title/status edits.
Unsupported fields and actions are declared through backend capabilities.

Validation on the final merged main branch:

- `npm run check` passed: 32 Python tests, 89 TypeScript tests, production build
  and 55 Chromium browser tests.
- Scratch coverage includes revision conflicts, concurrent writers, atomic saves,
  safe rollback, symlinks, mapping changes, HTTP and complete browser CRUD.
- Ruff and ty passed for the new storage module.
- Read-only discovery opened filemill-screencast's real readme-screencast feature
  as a spec-only workspace without writing any files there.

Work is completed; the tracker checkbox remains unchecked pending user acceptance.
