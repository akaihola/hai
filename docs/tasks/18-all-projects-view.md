# All projects view

Make it possible to view all issues of all projects in the same view. Consider usability and see how Linear and T3 Code handle this.

## Design and scope, 2026-10-06

- Add All projects navigation beside the single tracker view. Preserve status groups, acceptance tabs, list/board layouts, sorting, search and priority filters.
- Display the owning project on every issue, including mobile rows, board cards and search results. Add a project selector with server paths to distinguish duplicate names.
- Discover the configured tracker, trackers directly in allowed roots or their immediate project directories, explicitly opened nested trackers, and configured remote aliases. Do not recursively scan repositories or follow project-directory symlinks.
- Keep aggregation behind WorkspaceBackend. Namespace repeated issue IDs by canonical source path; do not create synthetic project entities or enable unsupported project fields.
- Open an issue in its owning tracker for editing, with a fresh source revision. Aggregate creation, edits, dragging, reordering and export stay unavailable; those actions belong to a single tracker.
- Show unreadable projects and diagnostics as an incomplete-view warning. Manual refresh reloads the catalog and all sources, avoiding automatic repeated remote fetches. Remember the selected scope in the browser.

## Usability references

[Linear custom views](https://linear.app/docs/custom-views) supports workspace scopes with filters and list/board layouts. [T3 Code Sidebar](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/Sidebar.tsx), inspected in the local checkout, has an All projects scope selector and displays project names with threads. Hai adopts the scope selector, source context and filtering while keeping the existing tracker workflow.

## Validation required

- Catalog discovery and allowed-root isolation, canonical deduplication, nested selections and configured aliases.
- Duplicate task IDs, unreadable projects, refresh recovery, read-only capabilities and opening/editing the correct owner without changing siblings.
- Desktop/mobile list and board, project filter, search, reload persistence and project switching.
- Run npm run check before merging and deploying. Completion remains unchecked pending user acceptance.


## Implemented and validated, 2026-10-06

- Added a read-only aggregate adapter, source discovery endpoint, persistent All projects navigation, project filter and source labels. The picker lists available projects when opened from the aggregate, including empty projects.
- Repeated source references and metadata IDs are namespaced by canonical source. Opening an issue resolves its owner and original ID before editing. Failed sources remain explicit; an unavailable remembered source does not hide readable projects.
- npm run check passed 22 Python tests, 86 client/API tests, TypeScript, the production build and all 52 Chromium workflows.
- Final review changes passed all 22 Python tests, 87 client/API tests, another production build and all six project-navigation Chromium workflows. Desktop board and mobile list screenshots were inspected.
- No acceptance was recorded. Aggregate refresh is manual; edits, creation, reordering and exports require opening a single project. Nested trackers need explicit opening or a configured parent root.
