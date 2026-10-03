---
depends-on: [2]
---

# Administer projects and cycles

Add project and cycle creation/editing only for providers with those capabilities.
Keep issue relation integrity when editing or removing entities and derive current
cycles from their date ranges. The repository TASKS.md provider has no implicit
project/cycle records; do not create fictional ones for it.

Extend the domain/adapter contract, frontend capability checks, validation, and
workflow tests together. Preserve existing issue navigation and summaries.

## Implementation plan, 2026-10-03

Expose independent project and cycle create, update, and delete capabilities and
optional adapter methods. Implement them in browser storage with immutable IDs,
validated writes, and atomic removal of issue relations when an entity is deleted.
The TASKS.md provider continues to expose neither records nor administration.

Add accessible creation and editing dialogs, preserve card navigation and progress
summaries, and clear deleted selections. Derive current cycles from date ranges,
including the entire last calendar day, without treating a fallback cycle as current.
Cover persistence, relation cleanup, rejected writes, provider capabilities, and UI
workflows. Run unit, build, and browser checks before completing the task.

## Implemented and validated, 2026-10-03

The browser adapter now supports independent project/cycle create, update, and
delete operations. Entity IDs remain stable; deletion clears matching issue
assignments atomically and retains the issues. The UI checks each capability and
method, keeps card navigation and progress summaries, and provides editing dialogs
with explicit deletion confirmation. TASKS.md still exposes no administration.

Current-cycle badges and navigation use date ranges with inclusive local ending
days. Persisted validation retains existing timestamp interpretation and UTC
calendar-date comparisons, extending date-only ends through the entire day.
Explicit timestamp offsets remain unchanged through unrelated edits. Async
completion checks use provider activation tokens so older saves cannot close a
new draft after switching away from a provider and back.

Validation: all 54 unit tests and the production build passed. All 18 focused
browser scenarios passed after correcting test selectors, covering CRUD, relation
cleanup, read-only and selective permissions, invalid dates, provider changes, and
mobile editing. Desktop project and mobile cycle screenshots were inspected with
no clipping. Full application checks run again after integration.
