---
depends-on: [2]
---

# Connect GitHub Issues and Projects

Implement the researched mapping in `docs/backends.md`. Keep credentials on a
companion service, map actual Project status/iteration fields, and distinguish
repository issues from pull requests and Project items.

Handle scopes, pagination, rate limits, provider failures, and revision conflicts.
Preserve provider IDs and unsupported metadata. Enable only supported operations.
Verify a configured repository/project with round-trip issue updates before
marking the integration connected.
