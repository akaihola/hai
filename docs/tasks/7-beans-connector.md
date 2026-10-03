---
depends-on: [2]
---

# Connect Beans

Use the Beans CLI or a local bridge to read configured workflows and `.beans/`
Markdown records. Preserve filenames, unknown fields, ordering, parent links, and
dependencies. Do not invent a member/cycle mapping.

Test the actual supported Beans schema with read/write round trips and conflict
handling. Describe supported fields and operations before enabling writes.
Research links and mapping notes are in `docs/backends.md`.
