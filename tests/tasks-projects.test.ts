import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createTasksServer } from './python-bridge.ts'
import { createTasksBackend, createAllTasksBackend } from '../src/adapters/tasks.ts'
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
    const ids = loaded.issues.filter(issue => issue.sourceState === 'Ordered backlog').map(issue => issue.id)
    const reordered = await selected.reorderBacklog!([...ids].reverse())
    assert.deepEqual(reordered.issues.filter(issue => issue.sourceState === 'Ordered backlog').map(issue => issue.id), [...ids].reverse())
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

for (const changed of ['tracker', 'description'] as const) {
  test(`stale creation after external ${changed} change saves exactly once and preserves source data`, async () => {
    const app = await setup()
    try {
      const backend = createTasksBackend(app.url)
      const original = await backend.load()
      const tracker = join(app.first, 'TASKS.md')
      const description = join(app.first, 'docs/tasks/7-example.md')
      const externalTracker = changed === 'tracker' ? backlogFixture.replace('Independent task', 'Externally updated task') : backlogFixture
      const externalDescription = changed === 'description' ? '# Human changes\nKeep these.\n' : '# Example\n'
      await writeFile(tracker, externalTracker)
      await writeFile(description, externalDescription)
      const input = { title: 'Retry original draft', description: '# New description\n', priority: 'high' as const, labels: ['original'], sourceState: 'Ordered backlog' as const, status: 'todo' as const }
      const created = await backend.createIssue(input)
      const after = await backend.load()
      assert.equal(after.issues.length, original.issues.length + 1)
      assert.equal(after.issues.filter(issue => issue.title === input.title).length, 1)
      for (const [key, value] of Object.entries(input)) assert.deepEqual(created[key as keyof typeof created], value)
      assert.deepEqual(after.issues.filter(issue => issue.id !== created.id), original.issues.map(issue => issue.id === 'task-7' ? { ...issue, description: externalDescription } : changed === 'tracker' && issue.id === 'independent' ? { ...issue, title: 'Externally updated task' } : issue))
      assert.equal(await readFile(description, 'utf8'), externalDescription)
      assert.equal(await readFile(join(app.first, created.sourcePath!), 'utf8'), input.description)
      const savedTracker = await readFile(tracker, 'utf8')
      assert.ok(savedTracker.includes('[7]: docs/tasks/7-example.md'))
      assert.ok(savedTracker.includes('Keep this unrelated paragraph between the last two slots.'))
      assert.ok(savedTracker.includes('- [x] [*] Accepted by user'))
      assert.ok(savedTracker.includes('- [ ] [*] Waiting for acceptance'))
      assert.equal(await readFile(join(app.second, 'TASKS.md'), 'utf8'), backlogFixture)
    } finally { await app.close() }
  })
}


test('all projects discovers trackers, namespaces repeated IDs and opens the correct owner', async () => {
  const app = await setup()
  try {
    const all = createAllTasksBackend(app.url)
    const workspace = await all.load()
    assert.deepEqual(all.sources?.map(source => source.path).sort(), [app.first, app.second].map(path => join(path, 'TASKS.md')).sort())
    assert.deepEqual(workspace.projects, [])
    assert.equal(new Set(workspace.issues.map(issue => issue.id)).size, workspace.issues.length)
    const twins = workspace.issues.filter(issue => issue.sourceReference === '[7]')
    assert.equal(twins.length, 2)
    assert.equal(all.capabilities.canUpdate, false)
    assert.equal(all.capabilities.canCreate, false)
    assert.equal(all.capabilities.canExport, false)
    assert.equal(all.capabilities.fields?.project, false)
    await assert.rejects(all.updateIssue(twins[0]!.id, { title: 'Forbidden' }), /Open a project/)
    const selected = twins.find(issue => issue.workspaceSource?.path === join(app.second, 'TASKS.md'))!
    const opened = await all.openIssue!(selected.id)
    assert.equal(opened.issue.id, 'task-7')
    assert.equal(opened.backend.source?.path, join(app.second, 'TASKS.md'))
    await opened.backend.updateIssue(opened.issue.id, { title: 'Edited from all projects' })
    assert.equal(await readFile(join(app.first, 'TASKS.md'), 'utf8'), backlogFixture)
    assert.ok((await all.load()).issues.some(issue => issue.title === 'Edited from all projects'))
    assert.equal(all.sourceErrors?.length, 0)
  } finally { await app.close() }
})

test('all projects reports unreadable sources and recovers on refresh without modifying trackers', async () => {
  const app = await setup()
  try {
    const description = join(app.second, 'docs/tasks/7-example.md')
    await rm(description)
    const all = createAllTasksBackend(app.url)
    assert.ok((await all.load()).issues.every(issue => issue.workspaceSource?.path === join(app.first, 'TASKS.md')))
    assert.equal(all.sourceErrors?.length, 1)
    assert.equal(all.sourceErrors?.[0]?.source.path, join(app.second, 'TASKS.md'))
    assert.match(all.sourceErrors![0]!.error, /7-example.md/)
    await writeFile(description, '# Repaired')
    await all.load()
    assert.equal(all.sources?.length, 2)
    assert.equal(all.sourceErrors?.length, 0)
    for (const project of [app.first, app.second]) assert.equal(await readFile(join(project, 'TASKS.md'), 'utf8'), backlogFixture)
  } finally { await app.close() }
})

test('project catalog includes selected nested trackers, deduplicates aliases and respects roots', async () => {
  const app = await setup()
  try {
    const nested = join(app.second, 'nested')
    await mkdir(join(nested, 'docs/tasks'), { recursive: true })
    await writeFile(join(nested, 'TASKS.md'), backlogFixture)
    await writeFile(join(nested, 'docs/tasks/7-example.md'), '# Nested')
    await writeFile(join(nested, 'docs/tasks/4-example.md'), '# Backend')
    await symlink(app.second, join(app.projects, 'alias'))
    await symlink(app.outside, join(app.projects, 'outside-link'))
    const all = createAllTasksBackend(app.url, nested)
    await all.load()
    assert.equal(all.sources?.length, 3)
    assert.equal(all.sourceErrors?.length, 0)
    assert.ok(all.sources?.some(source => source.path === join(nested, 'TASKS.md')))
    assert.equal((await fetch(`${app.url}/projects?source=${encodeURIComponent(app.outside)}`)).status, 403)
    const reopened = createAllTasksBackend(app.url)
    await reopened.load()
    assert.equal(reopened.sources?.length, 3)
  } finally { await app.close() }
  const restricted = await setup('restricted')
  try {
    const all = createAllTasksBackend(restricted.url)
    await all.load()
    assert.equal(all.sources?.length, 1)
    assert.equal(all.sources?.[0]?.path, join(restricted.first, 'TASKS.md'))
  } finally { await restricted.close() }
})


test('an unavailable remembered tracker does not hide other projects in the aggregate', async () => {
  const app = await setup()
  try {
    const all = createAllTasksBackend(app.url, join(app.projects, 'removed-project', 'TASKS.md'))
    await all.load()
    assert.equal(all.sources?.length, 2)
    assert.equal(all.sourceErrors?.length, 1)
    assert.equal(all.sourceErrors?.[0]?.source.name, 'removed-project')
    assert.match(all.sourceErrors![0]!.error, /Cannot open TASKS.md/)
  } finally { await app.close() }
})

test('aggregate catalogs share stage columns across all file workflows', async () => {
  const app = await setup()
  try {
    const feature = join(app.first, '.scratch/example/issues')
    await mkdir(feature, { recursive: true })
    await writeFile(join(feature, '01-example.md'), '# Scratch ready\nStatus: ready-for-agent\n')
    await mkdir(join(app.first, 'docs/agents'), { recursive: true })
    await writeFile(join(app.first, 'docs/agents/triage-labels.md'), '| `needs-triage` | `backlog` | Triage |\n')
    await writeFile(join(feature, '02-triage.md'), '# Scratch triage\nStatus: backlog\n')
    await mkdir(join(app.second, 'docs/backlog'), { recursive: true })
    await writeFile(join(app.second, 'docs/backlog/example.md'), '# Directory ready\n')
    const backend = createAllTasksBackend(app.url)
    const workspace = await backend.load()
    const { issueGroups, issueGroupId } = await import('../src/data/issue-groups.ts')
    const groups = issueGroups(backend.capabilities)
    assert.equal(backend.sourceErrors!.length, 0)
    assert.deepEqual(groups.map(group => group.id), ['triage', 'waiting', 'ready', 'scheduled', 'active', 'done', 'dropped'])
    for (const state of ['Ordered backlog', 'ready-for-agent', 'backlog']) {
      const issue = workspace.issues.find(issue => issue.sourceState === state && issue.workspaceStage === 'ready')!
      assert.ok(issue, state)
      assert.equal(issue.workspaceStage, 'ready')
      assert.equal(issueGroupId(issue, groups), 'ready')
      const opened = await backend.openIssue!(issue.id)
      assert.equal(opened.issue.sourceState, state)
      assert.equal(opened.backend.capabilities.sourceStates.find(entry => entry.id === state)?.stage, 'ready')
    }
    const collision = workspace.issues.filter(issue => issue.sourceState === 'backlog')
    assert.deepEqual(collision.map(issue => issue.workspaceStage).sort(), ['ready', 'triage'])
    assert.deepEqual(collision.map(issue => issueGroupId(issue, groups)).sort(), ['ready', 'triage'])
  } finally { await app.close() }
})
