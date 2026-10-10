import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTasks, mutateTasks } from './python-bridge.ts'
import { ISSUE_TITLE_MAX_LENGTH } from '../src/domain.ts'

import { backlogFixture, fixture, longWrappedTitle } from './fixtures/tasks-markdown.ts'

test('sections, active markers, acceptance and dependencies remain distinct', () => {
  const parsed = parseTasks(fixture)
  assert.equal(parsed.tasks.length, 5)
  assert.equal(parsed.tasks[1].issue.sourceSection, 'Ordered backlog')
  assert.deepEqual(parsed.tasks[1].issue.dependencies, ['4'])
  assert.equal(parsed.tasks[2].issue.status, 'in_progress')
  assert.equal(parsed.tasks[3].issue.accepted, false)
  assert.equal(parsed.tasks[4].issue.accepted, true)
})

test('moving preserves wrapping, dependency bullets, references and rules', () => {
  const output = mutateTasks(fixture, 'update', 'task-7', { sourceSection: 'In Progress' }).source
  assert.ok(output.includes('- [~] [7] Keep a wrapped\n  summary intact.\n  - Depends on: [4]'))
  assert.equal(output.slice(output.indexOf('[7]:')), fixture.slice(fixture.indexOf('[7]:')))
  const completed = mutateTasks(output, 'update', 'task-7', { sourceSection: 'Completed / Accepted' }).source
  assert.ok(completed.includes('- [ ] [7] Keep a wrapped'))
  assert.equal(parseTasks(completed).tasks.find(task => task.issue.id === 'task-7')?.issue.accepted, false)
})

test('only explicit acceptance checks a completed item', () => {
  const output = mutateTasks(fixture, 'update', 'task-4', { sourceSection: 'Completed / Accepted' }).source
  assert.match(output, /- \[ \] \[4\] Build backend/)
  const accepted = mutateTasks(output, 'update', 'task-4', { accepted: true }).source
  assert.match(accepted, /- \[x\] \[4\] Build backend/)
  assert.throws(() => mutateTasks(accepted, 'update', 'task-4', { sourceSection: 'Scheduled' }), /accepted/i)
})

test('refuses malformed sections, injected titles and unsupported statuses', () => {
  assert.throws(() => parseTasks(fixture.replace('## Scheduled', '## Ordered backlog')), /sections/i)
  assert.throws(() => mutateTasks(fixture, 'update', 'task-7', { title: 'Injected\n## Rules' }), /title/i)
  assert.throws(() => mutateTasks(fixture, 'update', 'task-7', { status: 'canceled' }), /status/i)
})


test('wrapped summaries display in full and title edits replace the whole summary', () => {
  assert.equal(parseTasks(fixture).tasks[1].issue.title, 'Keep a wrapped summary intact.')
  const output = mutateTasks(fixture, 'update', 'task-7', { title: 'Replacement summary' }).source
  assert.ok(output.includes('- [7] Replacement summary\n  - Depends on: [4]'))
  assert.ok(!output.includes('summary intact.'))
  assert.throws(() => mutateTasks(fixture, 'delete', 'task-4'), /depend/i)
})

test('long summaries load in full and keep wrapping through metadata and section changes', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = fixture.replace('Keep a wrapped\n  summary intact.', longWrappedTitle).replaceAll('\n', newline)
    const title = longWrappedTitle.replaceAll('\n  ', ' ')
    assert.ok(title.length > 300)
    assert.equal(parseTasks(source).tasks[1].issue.title, title)
    const output = mutateTasks(source, 'update', 'task-7', { sourceSection: 'In Progress', priority: 'high' }).source
    assert.ok(output.includes(longWrappedTitle.replaceAll('\n', newline)))
    assert.equal(parseTasks(output).tasks.find(task => task.issue.id === 'task-7')!.issue.title, title)
    assert.ok(output.includes(`  - Depends on: [4]`))
    assert.equal(output.slice(output.indexOf('[7]:')), source.slice(source.indexOf('[7]:')))
  }
})

test('title size stays bounded consistently for source reads and writes', () => {
  const title = 'x'.repeat(ISSUE_TITLE_MAX_LENGTH)
  const source = fixture.replace('Keep a wrapped\n  summary intact.', title)
  assert.equal(parseTasks(source).tasks[1].issue.title, title)
  assert.equal(parseTasks(mutateTasks(fixture, 'update', 'task-7', { title }).source).tasks[1].issue.title, title)
  assert.throws(() => parseTasks(source.replace(title, `${title}x`)), /Task title/)
  assert.throws(() => mutateTasks(fixture, 'update', 'task-7', { title: `${title}x` }), /Title/)
})

test('moving a dependent task into backlog keeps its prerequisite first', () => {
  const parentInBacklog = mutateTasks(fixture, 'update', 'task-4', { sourceSection: 'Ordered backlog' }).source
  const childScheduled = mutateTasks(parentInBacklog, 'update', 'task-7', { sourceSection: 'Scheduled' }).source
  const childBacklog = mutateTasks(childScheduled, 'update', 'task-7', { sourceSection: 'Ordered backlog' }).source
  assert.deepEqual(parseTasks(childBacklog).tasks.filter(task => task.issue.sourceSection === 'Ordered backlog').map(task => task.marker), ['4', '7'])
})

test('a new issue joins the end of the ordered backlog while moves keep the top', () => {
  const backlogIds = (source: string) => parseTasks(source).tasks.filter(task => task.issue.sourceSection === 'Ordered backlog').map(task => task.issue.id)
  const created = mutateTasks(backlogFixture, 'create', undefined, { title: 'Newest idea', sourceSection: 'Ordered backlog' })
  assert.deepEqual(backlogIds(created.source), [...backlogIds(backlogFixture), created.id])
  assert.ok(created.source.includes('  - Keep these inline notes.\n\n- [*] Newest idea\n  <!-- hai:'))
  assert.ok(created.source.includes('Keep this unrelated paragraph between the last two slots.'))
  const proposal = mutateTasks(backlogFixture, 'create', undefined, { title: 'Newest proposal' })
  assert.equal(parseTasks(proposal.source).tasks.filter(task => task.issue.sourceSection === 'Unverified proposals')[0].issue.id, proposal.id)
  const moved = mutateTasks(backlogFixture, 'update', 'task-4', { sourceSection: 'Ordered backlog' }).source
  assert.deepEqual(backlogIds(moved), ['task-4', ...backlogIds(backlogFixture)])
})

test('backlog ordering moves raw blocks up and down while preserving source slots and identities', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = backlogFixture.replaceAll('\n', newline)
    const before = parseTasks(source)
    const backlog = before.tasks.filter(task => task.issue.sourceSection === 'Ordered backlog')
    const ids = backlog.map(task => task.issue.id)
    const reorder = (text: string, order: string[]) => mutateTasks(text, 'reorder', undefined, { issueIds: order }).source
    const movedDown = reorder(source, [ids[1], ids[2], ids[0]])
    const movedUp = reorder(movedDown, [ids[0], ids[1], ids[2]])
    assert.equal(movedUp, source)
    assert.equal(reorder(source, ids), source)
    const after = parseTasks(movedDown)
    assert.deepEqual(after.tasks.filter(task => task.issue.sourceSection === 'Ordered backlog').map(task => task.issue.id), [ids[1], ids[2], ids[0]])
    for (const task of before.tasks) {
      const next = after.tasks.find(candidate => candidate.issue.id === task.issue.id)!
      assert.equal(next.raw, task.raw)
      assert.deepEqual(next.issue, task.issue)
    }
    const gaps = (parsed: ReturnType<typeof parseTasks>) => parsed.tasks.reduceRight((text, task) => text.slice(0, task.start) + '[task slot]' + text.slice(task.end), parsed.source)
    assert.equal(gaps(after), gaps(before))
  }
})

test('backlog ordering requires an exact permutation and a valid request', () => {
  const backlog = parseTasks(backlogFixture).tasks.filter(task => task.issue.sourceSection === 'Ordered backlog')
  const ids = backlog.map(task => task.issue.id)
  for (const input of [null, [], {}, { issueIds: null }, { issueIds: 'task-7' }, { issueIds: [7] }, { issueIds: ids, title: 'Unrelated edit' }, { issueIds: ids.slice(1) }, { issueIds: [...ids, ids[0]] }, { issueIds: [ids[0], ids[0], ids[2]] }, { issueIds: ['task-4', ...ids.slice(1)] }, { issueIds: ['missing', ...ids.slice(1)] }]) {
    assert.throws(() => mutateTasks(backlogFixture, 'reorder', undefined, input), /issueIds|every Ordered backlog/)
  }
  const empty = fixture.replace('- [7] Keep a wrapped\n  summary intact.\n  - Depends on: [4]', '')
  assert.equal(mutateTasks(empty, 'reorder', undefined, { issueIds: [] }).source, empty.replace(/\n{3,}/g, '\n\n'))
  assert.equal(mutateTasks(fixture, 'reorder', undefined, { issueIds: ['task-7'] }).source, fixture)
})

test('backlog ordering keeps prerequisites first and allows dependencies in other sections', () => {
  const source = backlogFixture.replace('  <!-- hai:{"id":"independent"', '  - Depends on: [7], [4]\n  <!-- hai:{"id":"independent"')
  const ids = parseTasks(source).tasks.filter(task => task.issue.sourceSection === 'Ordered backlog').map(task => task.issue.id)
  assert.throws(() => mutateTasks(source, 'reorder', undefined, { issueIds: [ids[1], ids[0], ids[2]] }), /depends on \[7\]/)
  const valid = mutateTasks(source, 'reorder', undefined, { issueIds: [ids[2], ids[0], ids[1]] }).source
  assert.deepEqual(parseTasks(valid).tasks.filter(task => task.issue.sourceSection === 'Ordered backlog').map(task => task.issue.id), [ids[2], ids[0], ids[1]])
})

test('every write repairs excessive task and section separators with LF or CRLF', () => {
  const dirty = fixture
    .replace('## Unverified proposals\n\n', '## Unverified proposals\n \n\t\n\n')
    .replace('## Ordered backlog', '\n\n## Ordered backlog')
    .replace('## Scheduled\n\n', '## Scheduled\n\n\n\n')
    .replace('- [x] [*] Accepted by user', '\n\n- [x] [*] Accepted by user')
    .replace('\n\n## Rules\n\n', '\n\n\n## Rules\n\n\n')
  for (const newline of ['\n', '\r\n']) {
    const source = dirty.replaceAll('\n', newline)
    const results = [
      mutateTasks(source, 'create', undefined, { title: 'New task' }),
      mutateTasks(source, 'update', 'task-7', { priority: 'high' }),
      mutateTasks(source, 'update', 'task-7', { sourceSection: 'Scheduled' }),
      mutateTasks(source, 'delete', 'task-7'),
      mutateTasks(source, 'reorder', undefined, { issueIds: ['task-7'] }),
    ]
    for (const { source: output } of results) {
      assert.doesNotMatch(output, /\r?\n(?:[ \t]*\r?\n){2,}/)
      assert.equal(output.replaceAll(newline, '\n').includes('\r'), false)
      assert.ok(output.includes('- [x] [*] Accepted by user'))
      assert.equal(output.slice(output.indexOf('[7]:')), fixture.slice(fixture.indexOf('[7]:')).replaceAll('\n', newline))
    }
    assert.equal(results.at(-1)!.source, fixture.replace('- [x] [*] Accepted by user', '\n- [x] [*] Accepted by user').replaceAll('\n', newline))
  }
})

test('repeated create, move, edit and delete do not accumulate blank lines', () => {
  for (const newline of ['\n', '\r\n']) {
    const original = fixture.replaceAll('\n', newline)
    let source = original
    for (let iteration = 0; iteration < 3; iteration++) {
      const created = mutateTasks(source, 'create', undefined, { title: 'Temporary issue', sourceSection: 'Ordered backlog' })
      source = created.source
      for (const sourceSection of ['Scheduled', 'In Progress', 'Completed / Accepted', 'Ordered backlog']) {
        source = mutateTasks(source, 'update', created.id, { sourceSection }).source
        for (let edit = 0; edit < 3; edit++) source = mutateTasks(source, 'update', created.id, { priority: 'urgent', labels: ['Spacing'] }).source
        assert.doesNotMatch(source, /\r?\n(?:[ \t]*\r?\n){2,}/)
        assert.equal(source.replaceAll(newline, '\n').includes('\r'), false)
        assert.equal(parseTasks(source).tasks.find(task => task.issue.id === created.id)!.raw.split('<!-- hai:').length, 2)
      }
      source = mutateTasks(source, 'delete', created.id).source
      assert.equal(source, original)
    }
  }
})

test('spacing repair preserves inline descriptions, fences, metadata, references and rule bodies', () => {
  const notes = '  - Keep these inline notes.\n\n\n  Another paragraph.\n\n  ```text\n  first\n\n\n  last\n  ```'
  const prose = 'Keep this unrelated paragraph between the last two slots.\n\n\n~~~text\nfirst\n\n\n- example\n~~~'
  const rules = 'Only user acceptance checks boxes.\n\n\n### More rules\n\n\nDo not remove this spacing.'
  for (const newline of ['\n', '\r\n']) {
    const source = backlogFixture
      .replace('  - Keep these inline notes.', notes)
      .replace('Keep this unrelated paragraph between the last two slots.', prose)
      .replace('Only user acceptance checks boxes.', rules)
      .replace('## Scheduled\n\n', '## Scheduled\n\n\n\n')
      .replaceAll('\n', newline)
    const before = parseTasks(source)
    const ids = before.tasks.filter(task => task.issue.sourceSection === 'Ordered backlog').map(task => task.issue.id).reverse()
    const output = mutateTasks(source, 'reorder', undefined, { issueIds: ids }).source
    const after = parseTasks(output)
    for (const task of before.tasks) {
      const next = after.tasks.find(other => other.issue.id === task.issue.id)!
      assert.equal(next.raw, task.raw)
      assert.deepEqual(next.issue, task.issue)
    }
    assert.ok(output.includes(prose.replaceAll('\n', newline)))
    assert.equal(output.slice(output.indexOf('[7]:')), source.slice(source.indexOf('[7]:')))
    assert.equal(mutateTasks(output, 'reorder', undefined, { issueIds: ids }).source, output)
  }
})

test('removing tasks next to unrelated prose preserves the original separation', () => {
  for (const newline of ['\n', '\r\n']) {
    for (const [leading, trailing] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
      const source = fixture.replace('## Scheduled', `Keep this paragraph.${'\n'.repeat(leading)}- [*] Remove this task${'\n'.repeat(trailing)}Keep this next paragraph.\n\n## Scheduled`).replaceAll('\n', newline)
      const task = parseTasks(source).tasks.find(task => task.issue.title === 'Remove this task')!
      for (const operation of ['delete', 'update'] as const) {
        const output = mutateTasks(source, operation, task.issue.id, operation === 'update' ? { sourceSection: 'Scheduled' } : {}).source
        assert.ok(output.includes(`Keep this paragraph.${newline.repeat(Math.max(leading, trailing))}Keep this next paragraph.`))
        assert.doesNotMatch(output, /\r?\n(?:[ \t]*\r?\n){2,}/)
      }
    }
  }
})

test('new description references preserve document spacing and compact the preceding heading gap', () => {
  const description = '# Requirements\n\n\nPreserve the document.\n\n```text\nfirst\n\n\nlast\n```\n'
  const reference = { number: 8, path: 'docs/tasks/8-description.md' }
  for (const newline of ['\n', '\r\n']) {
    const source = fixture.replace('## Rules', '\n\n## Rules').replaceAll('\n', newline)
    const simple = parseTasks(source).tasks[0]
    for (const operation of ['create', 'update'] as const) {
      const result = mutateTasks(source, operation, operation === 'update' ? simple.issue.id : undefined, { title: 'With description', description }, reference)
      assert.deepEqual(result.descriptionWrite, { path: reference.path, content: description })
      assert.equal(parseTasks(result.source).tasks.find(task => task.issue.id === result.id)!.issue.sourcePath, reference.path)
      assert.doesNotMatch(result.source, /\r?\n(?:[ \t]*\r?\n){2,}/)
      assert.equal(result.source.replaceAll(newline, '\n').includes('\r'), false)
    }
  }
})
