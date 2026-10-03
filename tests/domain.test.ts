import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalBackend, STORAGE_KEY, type StorageLike } from '../src/adapters/local'
import { createSeedWorkspace } from '../src/data/seed'
import { assertWorkspace } from '../src/data/validation'
import { ISSUE_TITLE_MAX_LENGTH, type IssueInput, type IssuePatch } from '../src/domain'

class MemoryStorage implements StorageLike {
  data = new Map<string, string>()
  failWrites = false
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('Quota exceeded')
    this.data.set(key, value)
  }
}

function setup() {
  const storage = new MemoryStorage()
  return { storage, backend: createLocalBackend(storage) }
}

test('seed is coherent, isolated, and retained across backend instances', async () => {
  const { backend, storage } = setup()
  const first = await backend.load()
  assertWorkspace(first)
  assert.equal(first.issues.length, 27)
  first.issues[0].title = 'Mutated outside adapter'
  assert.notEqual((await createLocalBackend(storage).load()).issues[0].title, first.issues[0].title)
  const seed = createSeedWorkspace()
  seed.issues[0].labels.push('Mutated')
  assert.ok(!createSeedWorkspace().issues[0].labels.includes('Mutated'))
})

test('CRUD persists fields and never reuses deleted issue identifiers', async () => {
  const { backend, storage } = setup()
  const issue = await backend.createIssue({ title: '  Ship the adapter  ', projectId: 'core', assigneeId: 'alex', labels: ['Feature'] })
  assert.equal(issue.title, 'Ship the adapter')
  assert.equal(issue.identifier, 'HAI-128')
  assert.equal(issue.status, 'todo')
  const updated = await backend.updateIssue(issue.id, { status: 'in_review', priority: 'urgent', description: 'Ready for review' })
  assert.equal(updated.identifier, issue.identifier)
  assert.equal(updated.createdAt, issue.createdAt)
  assert.equal((await createLocalBackend(storage).load()).issues[0].description, 'Ready for review')
  await backend.deleteIssue(issue.id)
  assert.ok(!(await backend.load()).issues.some(item => item.id === issue.id))
  const next = await backend.createIssue({ title: 'Follow up' })
  assert.equal(next.identifier, 'HAI-129')
  await assert.rejects(backend.updateIssue(issue.id, { title: 'Missing' }), /no longer exists/)
  await assert.rejects(backend.deleteIssue(issue.id), /no longer exists/)
})

test('validation rejects invalid mutation without altering persisted workspace', async () => {
  const { backend, storage } = setup()
  const workspace = await backend.load()
  const before = storage.getItem(STORAGE_KEY)
  for (const input of [
    { title: ' ' }, { title: 'x'.repeat(ISSUE_TITLE_MAX_LENGTH + 1) }, { title: 'Valid title', assigneeId: 'missing' },
    { title: 'Valid title', status: 'unknown' }, { title: 'Valid title', labels: [3] },
  ]) await assert.rejects(backend.createIssue(input as IssueInput), /Invalid workspace/)
  await assert.rejects(backend.updateIssue(workspace.issues[0].id, { id: 'changed' } as unknown as IssuePatch), /cannot be edited/)
  assert.equal(storage.getItem(STORAGE_KEY), before)
})

test('JSON backup round-trips all entities and restores edits', async () => {
  const { backend } = setup()
  const before = await backend.load()
  const backup = await backend.exportData('json')
  await backend.deleteIssue(before.issues[0].id)
  const imported = await backend.importData(backup, 'json')
  assert.deepEqual(imported, before)
  assert.deepEqual(await backend.load(), before)
})

test('malformed, incompatible, duplicate, and dangling-reference imports are atomic', async () => {
  const { backend, storage } = setup()
  await backend.load()
  const before = storage.getItem(STORAGE_KEY)
  const backup = JSON.parse(await backend.exportData('json'))
  const duplicate = structuredClone(backup)
  duplicate.workspace.issues[1].id = duplicate.workspace.issues[0].id
  const dangling = structuredClone(backup)
  dangling.workspace.issues[0].projectId = 'missing'
  const unsafe = structuredClone(backup)
  unsafe.nextIssueNumber = Number.MAX_SAFE_INTEGER
  const unknownMember = structuredClone(backup)
  unknownMember.workspace.currentMemberId = 'missing'
  const impossibleDate = structuredClone(backup)
  impossibleDate.workspace.projects[0].targetDate = '2026-02-31'
  for (const content of ['{bad json', '{}', JSON.stringify({ ...backup, version: 2 }), JSON.stringify(duplicate), JSON.stringify(dangling), JSON.stringify(unsafe), JSON.stringify(unknownMember), JSON.stringify(impossibleDate)]) {
    await assert.rejects(backend.importData(content, 'json'))
    assert.equal(storage.getItem(STORAGE_KEY), before)
  }
})

test('corrupt browser data is preserved on load, mutation, and import', async () => {
  const { backend, storage } = setup()
  const validBackup = await backend.exportData('json')
  storage.setItem(STORAGE_KEY, '{broken data')
  await assert.rejects(backend.load(), /stored data has been preserved/)
  await assert.rejects(backend.createIssue({ title: 'Will not be saved' }), /stored data has been preserved/)
  await assert.rejects(backend.importData(validBackup, 'json'), /stored data has been preserved/)
  assert.equal(storage.getItem(STORAGE_KEY), '{broken data')
})

test('failed writes and unavailable storage report errors without claiming success', async () => {
  const { backend, storage } = setup()
  const workspace = await backend.load()
  const before = storage.getItem(STORAGE_KEY)
  storage.failWrites = true
  await assert.rejects(backend.updateIssue(workspace.issues[0].id, { title: 'Not saved' }), /Could not save/)
  await assert.rejects(backend.deleteIssue(workspace.issues[0].id), /Could not save/)
  assert.equal(storage.getItem(STORAGE_KEY), before)
  const blocked = createLocalBackend({ getItem() { throw new Error('Disabled') }, setItem() { assert.fail('must not write') } })
  await assert.rejects(blocked.load(), /Could not read/)
})

test('workspace size limit protects future reloads, including multibyte text', async () => {
  const { backend, storage } = setup()
  await backend.load()
  for (let i = 0; i < 21; i++) await backend.createIssue({ title: `Large issue ${i}`, description: '界'.repeat(32000) })
  const before = storage.getItem(STORAGE_KEY)
  await assert.rejects(backend.createIssue({ title: 'Too large', description: '界'.repeat(50000) }), /too large/)
  assert.equal(storage.getItem(STORAGE_KEY), before)
  assertWorkspace(await backend.load())
})

test('TASKS.md export is readable and explicitly cannot be imported as a backup', async () => {
  const { backend, storage } = setup()
  const markdown = await backend.exportData('tasks')
  assert.match(markdown, /^# Tasks/)
  assert.match(markdown, /## In Progress/)
  assert.match(markdown, /- \[x\]/)
  assert.match(markdown, /use a JSON backup/)
  const before = storage.getItem(STORAGE_KEY)
  await assert.rejects(backend.importData(markdown, 'tasks'), /readable export only/)
  assert.equal(storage.getItem(STORAGE_KEY), before)
})
