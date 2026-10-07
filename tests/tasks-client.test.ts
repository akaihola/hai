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

const retryWorkspace = workspaceOf(parseTasks(backlogFixture))
const retrySource = { name: 'Project', path: '/projects/project/TASKS.md' }
const draft = { title: 'Original draft', description: 'Original description\nwith details.', priority: 'high' as const, status: 'backlog' as const, sourceSection: 'Ordered backlog' as const, labels: ['keep'], assigneeId: null, projectId: null, cycleId: null }
const loadedResponse = (revision: string, extra = {}) => new Response(JSON.stringify({ workspace: retryWorkspace, revision, source: retrySource, ...extra }))
const staleResponse = () => new Response(JSON.stringify({ error: 'TASKS.md or a description changed. Reload before saving.' }), { status: 412 })

test('creation refreshes the same source and retries once with fresh revision and unchanged input', async context => {
  const issue = { ...retryWorkspace.issues[0], ...draft, id: 'created', identifier: 'TASK-99' }
  const input = structuredClone(draft)
  const responses = [loadedResponse('original'), staleResponse(), loadedResponse('fresh'), loadedResponse('saved', { workspace: { ...retryWorkspace, issues: [...retryWorkspace.issues, issue] }, issue })]
  const fetch = context.mock.method(globalThis, 'fetch', async () => {
    if (responses.length === 2) { input.title = 'Changed while saving'; input.labels.push('changed') }
    return responses.shift()!
  })
  const backend = createTasksBackend('/test-api')
  await backend.load()
  assert.deepEqual(await backend.createIssue(input), issue)
  const calls = fetch.mock.calls.map(call => call.arguments as unknown as [string, RequestInit])
  const query = `?source=${encodeURIComponent(retrySource.path)}`
  assert.deepEqual(calls.map(([url, options]) => [url, options.method ?? 'GET']), [
    ['/test-api/workspace', 'GET'], [`/test-api/issues${query}`, 'POST'], [`/test-api/workspace${query}`, 'GET'], [`/test-api/issues${query}`, 'POST'],
  ])
  assert.equal(new Headers(calls[1][1].headers).get('if-match'), '"original"')
  assert.equal(new Headers(calls[3][1].headers).get('if-match'), '"fresh"')
  for (const index of [1, 3]) assert.deepEqual(JSON.parse(calls[index][1].body as string), draft)
})

for (const [name, refresh, error] of [
  ['another source', () => loadedResponse('fresh', { source: { name: 'Other', path: '/other/TASKS.md' } }), /invalid source information/],
  ['unidentified source', () => new Response(JSON.stringify({ revision: 'fresh', workspace: retryWorkspace })), /did not identify/],
  ['invalid workspace', () => loadedResponse('fresh', { workspace: {} }), /Invalid workspace/],
  ['invalid revision', () => loadedResponse(''), /invalid workspace response/],
  ['server failure', () => new Response(JSON.stringify({ error: 'Refresh unavailable' }), { status: 503 }), /Refresh unavailable/],
  ['network failure', () => { throw new TypeError('Connection lost') }, /Cannot reach/],
] as const) {
  test(`creation stops after ${name} refresh and preserves the draft`, async context => {
    const input = structuredClone(draft)
    const responses = [() => loadedResponse('original'), staleResponse, refresh]
    const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!())
    const backend = createTasksBackend()
    await backend.load()
    await assert.rejects(backend.createIssue(input), error)
    assert.equal(fetch.mock.callCount(), 3)
    assert.deepEqual(input, draft)
    assert.deepEqual(backend.source, retrySource)
    await assert.rejects(backend.createIssue(input), /Refresh the source/)
    assert.equal(fetch.mock.callCount(), 3)
  })
}

for (const afterRefresh of [false, true]) {
  for (const [name, failure, error] of [
    ['repeated conflict', staleResponse, /description changed/],
    ['partial save', () => new Response(JSON.stringify({ error: 'Save was partially applied. Reload and review.' }), { status: 409 }), /partially applied/],
    ['network failure', () => { throw new TypeError('Connection lost') }, /Cannot reach/],
    ['invalid saved response', () => new Response('{'), /invalid response/],
    ['unidentified saved issue', () => loadedResponse('saved'), /Issue saved, but the response could not identify/],
    ['server failure', () => new Response(JSON.stringify({ error: 'Save failed' }), { status: 500 }), /Save failed/],
  ] as const) {
    if (name === 'repeated conflict' && !afterRefresh) continue
    test(`creation does not retry ${name}${afterRefresh ? ' after refresh' : ''}`, async context => {
      const input = structuredClone(draft)
      const responses = [() => loadedResponse('original'), ...(afterRefresh ? [staleResponse, () => loadedResponse('fresh')] : []), failure]
      const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!())
      const backend = createTasksBackend()
      await backend.load()
      await assert.rejects(backend.createIssue(input), error)
      assert.equal(fetch.mock.callCount(), afterRefresh ? 4 : 2)
      assert.deepEqual(input, draft)
    })
  }
}

for (const operation of ['update', 'delete', 'reorder'] as const) {
  test(`${operation} never automatically refreshes or retries a stale revision`, async context => {
    const responses = [loadedResponse('original'), staleResponse()]
    const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
    const backend = createTasksBackend()
    await backend.load()
    const save = () => operation === 'update' ? backend.updateIssue('task-7', { title: 'Edit' }) : operation === 'delete' ? backend.deleteIssue('task-7') : backend.reorderBacklog!(['task-7'])
    await assert.rejects(save(), /description changed.*refresh the source/)
    await assert.rejects(save(), /Refresh the source before saving/)
    assert.equal(fetch.mock.callCount(), 2)
  })
}

test('creation cannot automatically refresh a source that was never identified', async context => {
  const responses = [new Response(JSON.stringify({ workspace: retryWorkspace, revision: 'original' })), staleResponse()]
  const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const backend = createTasksBackend()
  await backend.load()
  await assert.rejects(backend.createIssue(draft), /description changed/)
  assert.equal(fetch.mock.callCount(), 2)
})

test('polling detects changed snapshots and declares local-only automatic refresh', async context => {
  const changed = { ...retryWorkspace, issues: retryWorkspace.issues.slice(1) }
  const responses = [loadedResponse('original'), loadedResponse('original'), loadedResponse('changed', { workspace: changed }), loadedResponse('saved'), loadedResponse('remote', { source: { name: 'Remote', path: '/@team' } })]
  const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const backend = createTasksBackend()
  assert.equal(backend.capabilities.canAutoRefresh, false)
  await backend.load()
  assert.equal(backend.capabilities.canAutoRefresh, true)
  assert.equal(await backend.pollChanges!(() => true), null)
  assert.deepEqual(await backend.pollChanges!(() => true), changed)
  await backend.deleteIssue('task-7')
  assert.equal(new Headers((fetch.mock.calls[3].arguments[1] as RequestInit).headers).get('if-match'), '"changed"')
  const remote = await backend.openWorkspace!('/@team')
  assert.equal(remote.capabilities.canAutoRefresh, false)
})

for (const newerRead of [false, true]) test(`polling discards a response when ${newerRead ? 'a foreground read supersedes it' : 'an editor opens'}`, async context => {
  let resolvePoll!: (response: Response) => void
  let reads = 0
  const fetch = context.mock.method(globalThis, 'fetch', async () => {
    reads++
    if (reads === 2) return new Promise<Response>(resolve => { resolvePoll = resolve })
    return loadedResponse(reads === 1 ? 'original' : 'foreground')
  })
  const backend = createTasksBackend()
  await backend.load()
  let canApply = true
  const polling = backend.pollChanges!(() => canApply)
  if (newerRead) await backend.load()
  else canApply = false
  resolvePoll(loadedResponse('external'))
  assert.equal(await polling, null)
  await backend.deleteIssue('task-7')
  const save = fetch.mock.calls.at(-1)!.arguments[1] as RequestInit
  assert.equal(new Headers(save.headers).get('if-match'), newerRead ? '"foreground"' : '"original"')
})

test('project discovery lists all sources without loading their trackers', async context => {
  const sources = Array.from({ length: 12 }, (_, index) => ({ name: `Project ${index}`, path: index === 11 ? '/@remote' : `/projects/${index}/TASKS.md` }))
  const fetch = context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ sources: [...sources, sources[0]] })))
  const backend = createTasksBackend('/test-api', '/projects/selected/TASKS.md')
  assert.equal(backend.capabilities.canListWorkspaces, true)
  assert.deepEqual(await backend.listWorkspaces!(), sources)
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(fetch.mock.calls[0].arguments[0], '/test-api/projects?source=%2Fprojects%2Fselected%2FTASKS.md')
})

test('project discovery rejects malformed catalogs', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ sources: [{ name: 'Bad path', path: 'relative' }] })))
  await assert.rejects(createTasksBackend().listWorkspaces!(), /invalid project list/)
})
