# JSON export fails above 2 MB for large backlog repositories

`export_snapshot` in `hai_tasks/store.py` rejects a JSON snapshot larger than
2 MB, and the browser backup validator in `src/data/validation.ts` enforces
the same limit on import. The limit was sized for TASKS.md trackers. A
`docs/backlog/` workspace embeds every document body as the issue
description: nixos-config's 279 documents already produce a 1.97 MB snapshot
(measured 2026-10-14), so the export button there will start failing as the
repository grows, and `.scratch/` workspaces with long tickets can hit it too.

Unverified. Options to weigh before scheduling:

- Raise the export limit for filesystem backends, keeping the 2 MB cap only
  for the browser-storage import that it was meant to protect.
- Export filesystem workspaces without description bodies, or with a size
  option, since the Markdown files remain the real backup.
- Keep the cap and state clearly in the UI that large repositories export
  as Markdown only.
