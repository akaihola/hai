import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createTasksServer } from './python-bridge.ts'
import { createTasksBackend } from '../src/adapters/tasks.ts'
import { backlogFixture, longWrappedTitle } from './fixtures/tasks-markdown.ts'
import { parseBackup } from '../src/data/validation.ts'
import { ISSUE_TITLE_MAX_LENGTH } from '../src/domain.ts'

async function setup(roots: 'default' | 'restricted' | 'missing' = 'default') {
  const root = await mkdtemp(join(tmpdir(), 'hai-projects-'))
  const projects = join(root, 'projects')
  const first = join(projects, 'hai')
  const second = join(projects, 'drum-transcribe')
  const outside = join(root, 'outside')
  for (const project of [first, second, outside]) {
    await mkdir(join(project, 'docs/tasks'), { recursive: true })
    await writeFile(join(project, 'TASKS.md'), backlogFixture)
    await writeFile(join(project, 'docs/tasks/7-example.md'), '# Example\n')
    await writeFile(join(project, 'docs/tasks/4-example.md'), '# Backend\n')
  }
  const server = createTasksServer({ tasksFile: join(first, 'TASKS.md'), distDir: join(first, 'dist'), ...(roots === 'default' ? {} : { projectRoots: roots === 'missing' ? [first, join(projects, 'missing')] : [first] }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  return { first, second, outside, projects, url: `http://127.0.0.1:${address.port}/api`, close: async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  } }
}

test('opening a project isolates all adapter operations and preserves the previous backend', async () => {
  const app = await setup()
  try {
    const original = createTasksBackend(app.url)
    await original.load()
    assert.deepEqual(original.source, { name: 'hai', path: join(app.first, 'TASKS.md') })
    const selected = await original.openWorkspace!(app.second)
    assert.notEqual(selected, original)
    assert.deepEqual(selected.source, { name: 'drum-transcribe', path: join(app.second, 'TASKS.md') })
    const loaded = await selected.load()
    const ids = loaded.issues.filter(issue => issue.sourceSection === 'Ordered backlog').map(issue => issue.id)
    const reordered = await selected.reorderBacklog!([...ids].reverse())
    assert.deepEqual(reordered.issues.filter(issue => issue.sourceSection === 'Ordered backlog').map(issue => issue.id), [...ids].reverse())
    await selected.updateIssue('task-7', { title: 'Second project title', description: '# Second project description\n' })
    const created = await selected.createIssue({ title: 'Only in second project', description: 'New project description.' })
    assert.equal(await readFile(join(app.second, created.sourcePath!), 'utf8'), 'New project description.')
    const exported = await selected.exportData('tasks')
    assert.equal(exported, await readFile(join(app.second, 'TASKS.md'), 'utf8'))
    assert.match(exported, /Second project title/)
    assert.ok(JSON.parse(await selected.exportData('json')).workspace.issues.some((issue: { id: string }) => issue.id === created.id))
    await selected.deleteIssue(created.id)
    assert.ok(!(await selected.load()).issues.some(issue => issue.id === created.id))
    assert.equal(await readFile(join(app.first, 'TASKS.md'), 'utf8'), backlogFixture)
    assert.equal(await readFile(join(app.first, 'docs/tasks/7-example.md'), 'utf8'), '# Example\n')
    assert.equal(await original.exportData('tasks'), backlogFixture)
    await original.updateIssue('task-7', { title: 'First project still selected' })
    assert.match(await readFile(join(app.first, 'TASKS.md'), 'utf8'), /First project still selected/)
    assert.doesNotMatch(await selected.exportData('tasks'), /First project still selected/)
    const reopened = await selected.openWorkspace!(join(app.first, 'TASKS.md'))
    assert.equal(reopened.source?.path, original.source?.path)
    const homePath = `~/${relative(homedir(), app.second)}`
    assert.equal((await original.openWorkspace!(homePath)).source?.path, selected.source?.path)
  } finally { await app.close() }
})

test('opening a tracker with a long summary preserves its text across reads, edits and backups', async () => {
  const app = await setup()
  try {
    const source = backlogFixture.replace('Keep a wrapped\n  summary intact.', longWrappedTitle)
    const path = join(app.second, 'TASKS.md')
    await writeFile(path, source)
    const backend = await createTasksBackend(app.url).openWorkspace!(app.second)
    const title = longWrappedTitle.replaceAll('\n  ', ' ')
    assert.equal((await backend.load()).issues.find(issue => issue.id === 'task-7')!.title, title)
    assert.equal(await readFile(path, 'utf8'), source)
    await backend.updateIssue('task-7', { priority: 'high' })
    assert.ok((await readFile(path, 'utf8')).includes(longWrappedTitle))
    const backup = parseBackup(await backend.exportData('json'))
    assert.equal(backup.workspace.issues.find(issue => issue.id === 'task-7')!.title, title)
    assert.equal(await backend.exportData('tasks'), await readFile(path, 'utf8'))
    assert.equal((await backend.updateIssue('task-7', { title: `${title} Extra detail.` })).title, `${title} Extra detail.`)
    assert.equal(await readFile(join(app.first, 'TASKS.md'), 'utf8'), backlogFixture)
  } finally { await app.close() }
})

test('long multibyte titles and descriptions fit a bounded mutation request', async () => {
  const app = await setup()
  try {
    const backend = createTasksBackend(app.url)
    await backend.load()
    const title = '界'.repeat(ISSUE_TITLE_MAX_LENGTH), description = '界'.repeat(50000)
    const updated = await backend.updateIssue('task-7', { title, description })
    assert.equal(updated.title, title)
    assert.equal(updated.description, description)
    assert.equal((await backend.load()).issues.find(issue => issue.id === 'task-7')!.title, title)
    const before = await backend.exportData('tasks')
    const snapshot = await (await fetch(`${app.url}/workspace`)).json()
    const response = await fetch(`${app.url}/issues/task-7`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': snapshot.revision },
      body: JSON.stringify({ title: 'x'.repeat(1024 * 1024) }),
    })
    assert.equal(response.status, 413)
    assert.equal(await backend.exportData('tasks'), before)
  } finally { await app.close() }
})

test('project revisions and write queues remain isolated, including directory aliases', async () => {
  const app = await setup()
  try {
    const query = (source: string) => `?source=${encodeURIComponent(source)}`
    const first = await (await fetch(`${app.url}/workspace`)).json()
    const second = await (await fetch(`${app.url}/workspace${query(app.second)}`)).json()
    assert.notEqual(first.revision, second.revision, 'Identical content in different files must not share write tokens')
    const update = (source: string, revision: string, title: string, extra = {}) => fetch(`${app.url}/issues/task-7${query(source)}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': revision, ...extra }, body: JSON.stringify({ title }) })
    assert.equal((await update(app.second, first.revision, 'Wrong source')).status, 412)
    assert.equal((await update(app.second, second.revision, 'Cross-origin', { origin: 'https://evil.example' })).status, 403)
    await symlink(app.second, join(app.projects, 'alias'))
    const competing = await Promise.all([
      update(app.second, second.revision, 'One concurrent title'),
      update(join(app.projects, 'alias'), second.revision, 'Other concurrent title'),
    ])
    assert.deepEqual(competing.map(response => response.status).sort(), [200, 412])
    const current = await (await fetch(`${app.url}/workspace${query(app.second)}`)).json()
    await writeFile(join(app.second, 'docs/tasks/7-example.md'), 'Human edit\n')
    assert.equal((await update(app.second, current.revision, 'Stale title')).status, 412)
    assert.equal(await readFile(join(app.second, 'docs/tasks/7-example.md'), 'utf8'), 'Human edit\n')
    assert.equal(await readFile(join(app.first, 'TASKS.md'), 'utf8'), backlogFixture)
  } finally { await app.close() }
})

test('project paths reject malformed input, missing trackers, and escaping links without changing the source', async () => {
  const app = await setup()
  try {
    const backend = createTasksBackend(app.url)
    await backend.load()
    for (const [path, status] of [['', 400], ['relative/path', 400], ['~someone/project', 400], ['\0', 400], [join(app.projects, 'missing'), 404], [app.outside, 403]] as const) {
      const response = await fetch(`${app.url}/workspace?source=${encodeURIComponent(path)}`)
      assert.equal(response.status, status, path)
      assert.equal(typeof (await response.json()).error, 'string')
    }
    assert.equal((await fetch(`${app.url}/workspace?source=${encodeURIComponent(app.first)}&source=${encodeURIComponent(app.second)}`)).status, 400)
    await symlink(app.outside, join(app.projects, 'escape'))
    assert.equal((await fetch(`${app.url}/workspace?source=${encodeURIComponent(join(app.projects, 'escape'))}`)).status, 403)
    await rename(join(app.second, 'TASKS.md'), join(app.second, 'original.md'))
    await symlink(join(app.second, 'original.md'), join(app.second, 'TASKS.md'))
    await assert.rejects(backend.openWorkspace!(app.second), /regular file.*symbolic link/)
    assert.equal(backend.source?.path, join(app.first, 'TASKS.md'))
    await backend.updateIssue('task-7', { title: 'Valid original source after failed open' })
    assert.equal(await readFile(join(app.second, 'original.md'), 'utf8'), backlogFixture)
    await rm(join(app.second, 'TASKS.md'))
    await rename(join(app.second, 'original.md'), join(app.second, 'TASKS.md'))
    await backend.openWorkspace!(app.second)
    await rename(app.second, `${app.second}-old`)
    await symlink(app.outside, app.second)
    await assert.rejects(backend.openWorkspace!(app.second), /links must stay inside/)
    assert.equal(await readFile(join(app.outside, 'TASKS.md'), 'utf8'), backlogFixture)
    await rename(app.first, `${app.first}-old`)
    await symlink(app.outside, app.first)
    await assert.rejects(backend.load(), /links must stay inside/)
    assert.equal((await fetch(`${app.url}/workspace`)).status, 403)
  } finally { await app.close() }
})

test('explicit project roots limit sibling access', async () => {
  const app = await setup('restricted')
  try {
    assert.equal((await fetch(`${app.url}/workspace`)).status, 200)
    const denied = await fetch(`${app.url}/workspace?source=${encodeURIComponent(app.second)}`)
    assert.equal(denied.status, 403)
    assert.match((await denied.json()).error, /HAI_PROJECT_ROOTS/)
  } finally { await app.close() }
})

test('unavailable project roots recover without losing successfully pinned roots', async () => {
  const app = await setup('missing')
  try {
    assert.equal((await fetch(`${app.url}/workspace`)).status, 503)
    assert.equal((await fetch(`${app.url}/../healthz`)).status, 503)
    await rename(app.first, `${app.first}-old`)
    await symlink(app.outside, app.first)
    await mkdir(join(app.projects, 'missing'))
    assert.equal((await fetch(`${app.url}/workspace`)).status, 403, 'A successful root resolution must stay pinned after another root failed')
    await rm(app.first)
    await rename(`${app.first}-old`, app.first)
    assert.equal((await fetch(`${app.url}/workspace`)).status, 200)
    assert.equal((await fetch(`${app.url}/../healthz`)).status, 200)
    assert.equal(await readFile(join(app.outside, 'TASKS.md'), 'utf8'), backlogFixture)
  } finally { await app.close() }
})
