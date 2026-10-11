import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTasksServer } from './python-bridge.ts'
import type { Workspace } from '../src/domain.ts'
import { backlogFixture, fixture } from './fixtures/tasks-markdown.ts'

async function setup(source = fixture) {
  const root = await mkdtemp(join(tmpdir(), 'hai-tasks-'))
  await mkdir(join(root, 'docs/tasks'), { recursive: true })
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'TASKS.md'), source)
  await writeFile(join(root, 'docs/tasks/7-example.md'), '# Example\n\nOriginal body.\n')
  await writeFile(join(root, 'docs/tasks/4-example.md'), '# Backend\n')
  await writeFile(join(root, 'dist/index.html'), '<html>Hai</html>')
  const server = createTasksServer({ tasksFile: join(root, 'TASKS.md'), distDir: join(root, 'dist') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  return { root, url: `http://127.0.0.1:${address.port}`, close: async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  } }
}

test('HTTP edits real files, exports original source, and rejects stale writes', async () => {
  const app = await setup()
  try {
    const loaded = await fetch(`${app.url}/api/workspace`)
    assert.equal(loaded.status, 200)
    const initial = await loaded.json()
    assert.equal(initial.workspace.issues.find((issue: { id: string }) => issue.id === 'task-7').description, '# Example\n\nOriginal body.\n')
    const headers = { 'content-type': 'application/json', 'if-match': loaded.headers.get('etag')! }
    const requests = await Promise.all([
      fetch(`${app.url}/api/issues/task-7`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'Saved title' }) }),
      fetch(`${app.url}/api/issues/task-7`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'Other title' }) }),
    ])
    assert.deepEqual(requests.map(response => response.status).sort(), [200, 412])
    const source = await readFile(join(app.root, 'TASKS.md'), 'utf8')
    assert.ok(source.includes('  - Depends on: [4]'))
    assert.ok(!source.includes('summary intact.'))
    assert.equal(await (await fetch(`${app.url}/api/export?format=tasks`)).text(), source)
    const fresh = await fetch(`${app.url}/api/workspace`)
    await writeFile(join(app.root, 'docs/tasks/7-example.md'), 'Externally changed\n')
    assert.equal((await fetch(`${app.url}/api/issues/task-7`, { method: 'PATCH', headers: { ...headers, 'if-match': fresh.headers.get('etag')! }, body: '{"description":"Overwrite"}' })).status, 412)
    assert.equal(await readFile(join(app.root, 'docs/tasks/7-example.md'), 'utf8'), 'Externally changed\n')
  } finally { await app.close() }
})

test('description/create/delete persist, unsafe requests leave files intact', async () => {
  const app = await setup()
  try {
    let revision = (await (await fetch(`${app.url}/api/workspace`)).json()).revision
    const request = (path: string, method: string, body?: object, extra = {}) => fetch(`${app.url}${path}`, { method, headers: { 'content-type': 'application/json', 'if-match': revision, ...extra }, body: body ? JSON.stringify(body) : undefined })
    assert.equal((await request('/api/issues/task-7', 'PATCH', { title: 'Attack\n## Rules' })).status, 400)
    assert.equal((await request('/api/issues/task-7', 'PATCH', { title: 'Attack' }, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await fetch(`${app.url}/api/issues/task-7`, { method: 'DELETE' })).status, 428)
    const edited = await request('/api/issues/task-7', 'PATCH', { description: '# Edited\n\nPreserved body.\n' })
    assert.equal(edited.status, 200)
    revision = (await edited.json()).revision
    assert.equal(await readFile(join(app.root, 'docs/tasks/7-example.md'), 'utf8'), '# Edited\n\nPreserved body.\n')
    const created = await request('/api/issues', 'POST', { title: 'New task', description: 'New description' })
    assert.equal(created.status, 201)
    const next = await created.json()
    revision = next.revision
    assert.equal(next.issue.sourceSection, 'Unverified proposals')
    assert.ok(next.issue.sourcePath.startsWith('docs/tasks/'))
    assert.equal((await request(`/api/issues/${next.issue.id}`, 'DELETE')).status, 200)
    assert.ok(!(await readFile(join(app.root, 'TASKS.md'), 'utf8')).includes('New task'))
  } finally { await app.close() }
})

test('rejects symlink descriptions and never serves files outside dist', async () => {
  const app = await setup()
  try {
    assert.notEqual((await fetch(`${app.url}/docs/tasks/7-example.md`)).status, 200)
    await rm(join(app.root, 'docs/tasks/7-example.md'))
    await symlink(join(app.root, 'TASKS.md'), join(app.root, 'docs/tasks/7-example.md'))
    assert.equal((await fetch(`${app.url}/api/workspace`)).status, 422)
  } finally { await app.close() }
})

test('simple task identity survives description promotion and retired numbers are not reused', async () => {
  const app = await setup()
  try {
    const load = async () => (await fetch(`${app.url}/api/workspace`)).json()
    const first = await load()
    const simple = first.workspace.issues.find((issue: { sourceReference: string; title: string }) => issue.sourceReference === '[*]' && issue.title === 'Check proposals')
    const promotedResponse = await fetch(`${app.url}/api/issues/${simple.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': first.revision }, body: JSON.stringify({ description: 'Detailed requirements.' }) })
    assert.equal(promotedResponse.status, 200)
    const promoted = await promotedResponse.json()
    assert.equal(promoted.issue.id, simple.id)
    assert.equal(promoted.issue.sourceReference, '[1]')
    assert.equal(await readFile(join(app.root, promoted.issue.sourcePath), 'utf8'), 'Detailed requirements.')
    const deleted = await fetch(`${app.url}/api/issues/${simple.id}`, { method: 'DELETE', headers: { 'if-match': promoted.revision } })
    assert.equal(deleted.status, 200)
    await assert.rejects(readFile(join(app.root, promoted.issue.sourcePath)), { code: 'ENOENT' })
    const tracker = await readFile(join(app.root, 'TASKS.md'), 'utf8')
    assert.doesNotMatch(tracker, /^\[1\]:/m)
    assert.match(tracker, /hai:reserved-numbers:[^>]*1/)
    const beforeCreate = await load()
    const created = await fetch(`${app.url}/api/issues`, { method: 'POST', headers: { 'content-type': 'application/json', 'if-match': beforeCreate.revision }, body: JSON.stringify({ title: 'Next numbered task', description: 'Keep the retired number reserved.' }) })
    assert.equal(created.status, 201)
    assert.equal((await created.json()).issue.sourceReference, '[2]')
  } finally { await app.close() }
})

test('HTTP backlog ordering persists, shares revision protection, and preserves descriptions', async () => {
  const app = await setup(backlogFixture)
  try {
    const initial = await (await fetch(`${app.url}/api/workspace`)).json()
    const ids = (initial.workspace as Workspace).issues.filter(issue => issue.sourceSection === 'Ordered backlog').map(issue => issue.id)
    const order = [ids[2], ids[0], ids[1]]
    const reorder = (revision: string, issueIds: string[]) => fetch(`${app.url}/api/backlog/order`, { method: 'POST', headers: { 'content-type': 'application/json', 'if-match': revision }, body: JSON.stringify({ issueIds }) })
    const competing = await Promise.all([reorder(initial.revision, order), reorder(initial.revision, [ids[1], ids[2], ids[0]])])
    assert.deepEqual(competing.map(response => response.status).sort(), [200, 412])
    const savedResponse = competing.find(response => response.status === 200)!
    const saved = await savedResponse.json()
    assert.equal(savedResponse.headers.get('etag'), `"${saved.revision}"`)
    assert.equal(saved.issue, undefined)
    const savedIds = (saved.workspace as Workspace).issues.filter(issue => issue.sourceSection === 'Ordered backlog').map(issue => issue.id)
    assert.deepEqual(savedIds, savedResponse === competing[0] ? order : [ids[1], ids[2], ids[0]])
    assert.deepEqual((await (await fetch(`${app.url}/api/workspace`)).json()).workspace, saved.workspace)
    const noOp = await reorder(saved.revision, savedIds)
    assert.equal(noOp.status, 200)
    assert.equal((await noOp.json()).revision, saved.revision)
    const restored = await reorder(saved.revision, ids)
    assert.equal(restored.status, 200)
    assert.equal((await restored.json()).revision, initial.revision)
    assert.equal(await readFile(join(app.root, 'TASKS.md'), 'utf8'), backlogFixture)
    assert.equal(await readFile(join(app.root, 'docs/tasks/7-example.md'), 'utf8'), '# Example\n\nOriginal body.\n')
    assert.equal(await readFile(join(app.root, 'docs/tasks/4-example.md'), 'utf8'), '# Backend\n')
    await writeFile(join(app.root, 'docs/tasks/7-example.md'), 'External description edit\n')
    assert.equal((await reorder(initial.revision, order)).status, 412)
    assert.equal(await readFile(join(app.root, 'TASKS.md'), 'utf8'), backlogFixture)
    assert.equal(await readFile(join(app.root, 'docs/tasks/7-example.md'), 'utf8'), 'External description edit\n')
  } finally { await app.close() }
})

test('HTTP backlog ordering rejects malformed, incomplete, dependent, and cross-origin requests', async () => {
  const source = backlogFixture.replace('  <!-- hai:{"id":"independent"', '  - Depends on: [7]\n  <!-- hai:{"id":"independent"')
  const app = await setup(source)
  try {
    const loaded = await fetch(`${app.url}/api/workspace`)
    const initial = await loaded.json()
    const ids = (initial.workspace as Workspace).issues.filter(issue => issue.sourceSection === 'Ordered backlog').map(issue => issue.id)
    const endpoint = `${app.url}/api/backlog/order`
    const headers = { 'content-type': 'application/json', 'if-match': loaded.headers.get('etag')! }
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ issueIds: ids }) })).status, 428)
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: JSON.stringify({ issueIds: ids }) })).status, 403)
    for (const input of [null, {}, [], { issueIds: 'task-7' }, { issueIds: [7] }, { issueIds: ids.slice(1) }, { issueIds: [ids[0], ids[0], ids[2]] }, { issueIds: ['task-4', ...ids.slice(1)] }, { issueIds: ids, accepted: true }, { issueIds: [ids[1], ids[0], ids[2]] }]) {
      assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(input) })).status, 400)
    }
    assert.equal(await readFile(join(app.root, 'TASKS.md'), 'utf8'), source)
    const valid = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ issueIds: [ids[2], ids[0], ids[1]] }) })
    assert.equal(valid.status, 200)
  } finally { await app.close() }
})
