import assert from 'node:assert/strict'
import test from 'node:test'
import { createTasksBackend } from '../src/adapters/tasks.ts'
import { parseTasks, workspaceOf } from './python-bridge.ts'
import { backlogFixture } from './fixtures/tasks-markdown.ts'

for (const message of [
  'Save was partially applied and a source changed again. Current files were preserved. Reload and review the tracker before retrying.',
  'Other issues depend on this task. Update their dependencies before deleting it.',
]) {
  test(`client preserves conflict details: ${message}`, async context => {
    const responses = [
      new Response(JSON.stringify({ revision: 'original', workspace: { issues: [], projects: [], cycles: [], members: [], currentMemberId: null } })),
      new Response(JSON.stringify({ error: message }), { status: 409 }),
    ]
    const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
    const backend = createTasksBackend()
    await backend.load()
    await assert.rejects(backend.deleteIssue('task-1'), { message: `${message} Close this editor and refresh the source before retrying.` })
    await assert.rejects(backend.deleteIssue('task-1'), /Refresh the source before saving changes/)
    assert.equal(fetch.mock.callCount(), 2)
  })
}

test('client sends the complete backlog order with the current revision and returns the workspace', async context => {
  const original = workspaceOf(parseTasks(backlogFixture))
  const reordered = { ...original, issues: [...original.issues].reverse() }
  const responses = [
    new Response(JSON.stringify({ revision: 'original', workspace: original })),
    new Response(JSON.stringify({ revision: 'reordered', workspace: reordered })),
    new Response(JSON.stringify({ revision: 'restored', workspace: original })),
  ]
  const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const backend = createTasksBackend('/test-api')
  assert.equal(backend.capabilities.canReorderBacklog, true)
  await assert.rejects(backend.reorderBacklog!([]), /Refresh the source/)
  assert.equal(fetch.mock.callCount(), 0)
  await backend.load()
  const ids = original.issues.filter(issue => issue.sourceSection === 'Ordered backlog').map(issue => issue.id)
  assert.deepEqual(await backend.reorderBacklog!([...ids].reverse()), reordered)
  const first = fetch.mock.calls[1].arguments as unknown as [string, RequestInit]
  assert.equal(first[0], '/test-api/backlog/order')
  assert.equal(first[1].method, 'POST')
  assert.equal(new Headers(first[1].headers).get('if-match'), '"original"')
  assert.deepEqual(JSON.parse(first[1].body as string), { issueIds: [...ids].reverse() })
  assert.deepEqual(await backend.reorderBacklog!(ids), original)
  const second = fetch.mock.calls[2].arguments as unknown as [string, RequestInit]
  assert.equal(new Headers(second[1].headers).get('if-match'), '"reordered"')
})

test('client rejects stale backlog writes until the source is refreshed', async context => {
  const responses = [
    new Response(JSON.stringify({ revision: 'original', workspace: workspaceOf(parseTasks(backlogFixture)) })),
    new Response(JSON.stringify({ error: 'TASKS.md or a description changed. Reload before saving.' }), { status: 412 }),
  ]
  const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const backend = createTasksBackend()
  await backend.load()
  await assert.rejects(backend.reorderBacklog!(['task-7']), /description changed.*refresh the source/)
  await assert.rejects(backend.reorderBacklog!(['task-7']), /Refresh the source before saving changes/)
  assert.equal(fetch.mock.callCount(), 2)
})

test('client binds the default source and never switches it after an invalid source response', async context => {
  const workspace = workspaceOf(parseTasks(backlogFixture))
  const source = { name: 'Project name', path: '/projects/Project name/TASKS.md' }
  const responses = [
    new Response(JSON.stringify({ revision: 'original', workspace, source })),
    new Response(JSON.stringify({ revision: 'other', workspace, source: { name: 'Other project', path: '/projects/other/TASKS.md' } })),
    new Response('original tracker'),
  ]
  const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const backend = createTasksBackend('/test-api')
  assert.equal(backend.capabilities.canOpenWorkspace, true)
  assert.equal(backend.source, undefined)
  await backend.load()
  assert.deepEqual(backend.source, source)
  await assert.rejects(backend.load(), /invalid source information/)
  assert.deepEqual(backend.source, source)
  assert.equal(await backend.exportData('tasks'), 'original tracker')
  const urls = fetch.mock.calls.map(call => call.arguments[0])
  assert.deepEqual(urls, ['/test-api/workspace', `/test-api/workspace?source=${encodeURIComponent(source.path)}`, `/test-api/export?format=tasks&source=${encodeURIComponent(source.path)}`])
})

test('opening a source requires a valid identified snapshot', async context => {
  const workspace = workspaceOf(parseTasks(backlogFixture))
  const responses = [
    new Response(JSON.stringify({ revision: 'missing-source', workspace })),
    new Response(JSON.stringify({ revision: 'invalid-source', workspace, source: { name: 'Project', path: 'relative/TASKS.md' } })),
  ]
  context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const backend = createTasksBackend()
  await assert.rejects(backend.openWorkspace!('/projects/other'), /did not identify the requested source/)
  await assert.rejects(backend.openWorkspace!('/projects/other'), /invalid source information/)
  assert.equal(backend.source, undefined)
  await assert.rejects(backend.updateIssue('task-7', { title: 'Not loaded' }), /Refresh the source/)
})
