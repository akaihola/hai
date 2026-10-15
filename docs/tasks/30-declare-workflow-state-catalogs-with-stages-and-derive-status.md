# Declare workflow state catalogs with stages and derive status

Three backends expose the provider's native workflow under two field names:
TASKS.md uses `sourceSection`, while `.scratch/` tickets and `docs/backlog/`
directories use `sourceState`. Consumers such as kandev-pacer compare section
strings, so every new backend needs new consumer code. Hai's abstract `status`
is too coarse for automation: Unverified proposals and Ordered backlog are both
`backlog`, Scheduled and a `docs/backlog/` document are both `todo`, and
`ready-for-agent` and `ready-for-human` are both `todo`. A pacer cannot decide
"may I pick this" from `status`.

Design, 2026-10-14: the provider's workflow is data the backend declares, in
three layers with one job each.

| Layer | Field | Set by | Purpose |
| --- | --- | --- | --- |
| Native state | `sourceState` | the file: section, triage role, directory | what people and agents see and patch |
| Stage | `sourceStates[].stage` | the backend's catalog | what automation reasons over |
| Status | `status` | derived from stage by one function | display only |

## Requirements

- Every backend, including TASKS.md and the browser demo, reports
  `capabilities.sourceStates` as an ordered list of `{ id, stage }`. For
  TASKS.md the ids are the section names.
- Every issue carries `sourceState`. TASKS.md issues keep `sourceSection` as a
  read alias with the same value, and patches accept either name, until [33]
  removes the alias.
- `stage` uses one fixed vocabulary ordered along the lifecycle, plus one
  off-line terminal: `triage`, `waiting`, `ready`, `scheduled`, `active`,
  `review`, `done`, and `dropped`. `waiting` means actionable only by a person.
- `status` is derived from the stage in one shared function and is read-only
  in the model: `triage` and `waiting` are `backlog`, `ready` and `scheduled`
  are `todo`, `active` is `in_progress`, `review` is `in_review`, `done` is
  `done`, `dropped` is `canceled`. Backends stop declaring statuses.
- A patch moves an issue with `sourceState` alone. A `status` in the patch
  must agree with the state; `status` alone selects the first catalog state
  with that status, which keeps the browser demo and existing clients working.
- Hai validates that a state exists in the catalog and performs the move. It
  does not encode allowed transitions; move-doc checklists and the TASKS.md
  rules remain repository policy, and picking order remains pacer policy.
- Acceptance and dependencies stay separate facets declared through `fields`.

## Stage mapping

| Backend | Native state | Stage |
| --- | --- | --- |
| TASKS.md | Unverified proposals | triage |
| TASKS.md | Ordered backlog | ready |
| TASKS.md | Scheduled | scheduled |
| TASKS.md | In Progress | active |
| TASKS.md | Completed / Accepted | done |
| scratch | needs-triage, needs-info | triage |
| scratch | ready-for-human | waiting |
| scratch | ready-for-agent, open | ready |
| scratch | claimed | active |
| scratch | resolved | done |
| scratch | wontfix | dropped |
| docs | issues, ideas | triage |
| docs | backlog | ready |
| docs | in-progress | active |
| docs | completed | done |
| docs | rejected | dropped |

The only visible display change is that Ordered backlog shows as Todo instead
of Backlog.

## Scope

`hai_tasks` (markdown, store, scratch, backlog), the HTTP responses, the
browser adapters and `src/domain.ts` types, with tests for the catalog,
derived statuses, alias reads and both patch forms. Update
`docs/backends.md` with the matrix. Consumers move in [31] and [32]; the
alias is removed in [33].
