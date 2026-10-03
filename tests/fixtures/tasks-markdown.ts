export const fixture = `# Tasks\n\n## Unverified proposals\n\n- [*] Check proposals\n\n## Ordered backlog\n\n- [7] Keep a wrapped\n  summary intact.\n  - Depends on: [4]\n\n## Scheduled\n\n## In Progress\n\n- [~] [4] Build backend\n\n## Completed / Accepted\n\n- [ ] [*] Waiting for acceptance\n- [x] [*] Accepted by user\n\n[7]: docs/tasks/7-example.md\n[4]: docs/tasks/4-example.md\n\n## Rules\n\nOnly user acceptance checks boxes.\n\n- Do not rewrite these rules.\n`

export const backlogFixture = fixture.replace('## Scheduled', `<!-- Keep this comment between the first two slots. -->

- [*] Independent task
  <!-- hai:{"id":"independent","priority":"high","updatedAt":"2026-01-01T00:00:00.000Z"} -->


Keep this unrelated paragraph between the last two slots.

- [ ] [*] Task with inline notes

  - Keep these inline notes.

## Scheduled`)

export const longWrappedTitle = Array.from({ length: 8 }, (_, index) => `Keep requirement ${index + 1} and its complete explanation in this existing task summary.`).join('\n  ')
