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
