# Automatically refresh and retry new issue saves

## Report

Transferred from kandev-pacer issue [25], Hai ID
`simple-30818c9d-e3bb-4e76-ae6c-347f585730f1`, on 2026-10-04.
The user encounters this while creating an issue after source files changed:

    TASKS.md or a description changed. Reload before saving. Close this editor and refresh the source before retrying.

Hai should refresh the source automatically and save the newly created issue
without requiring the user to close the editor or recreate the draft.

## Implementation scope

The error comes from `src/adapters/tasks.ts`; the revision check is in
`hai_tasks/store.py`. Keep server revision checks. When new issue creation
receives a stale-revision response, load and validate a fresh snapshot of the
same source, then retry creation once with the fresh revision and unchanged
input. Preserve the title, description, and other draft fields.

Do not automatically retry edits, deletes, or backlog reordering, which could
replace newer user changes. Do not retry ambiguous network failures or partial
saves, which could create duplicate issues. If refresh or retry fails, keep the
draft and display the error. Bound the retry so a repeatedly changing tracker
does not cause an endless save loop.

## Acceptance criteria

- A tracker or linked description changed since load: creating a new issue
  refreshes automatically and saves exactly one issue with the original draft.
- Existing issues, external file changes, references, and acceptance flags survive.
- The refreshed snapshot identifies the same source; another source is rejected.
- Failed refresh, repeated conflicts, and ambiguous failures preserve the draft
  and do not cause additional creation attempts.
- Tests cover request order, fresh revision use, draft preservation, bounded
  retry, and unchanged conflict handling for edits, deletes, and reordering.

## Related work

The existing backlog task "Evaluate automatic refresh when a tracker is edited
outside Hai" concerns broader background synchronization. This task specifically
handles a stale revision during creation and does not require background refresh.

## Handoff status

2026-10-04: Request moved to Hai for future implementation. No application code
was changed, and the automatic retry behavior has not been implemented or deployed.
