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
