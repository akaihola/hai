import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalBackend, STORAGE_KEY, type StorageLike } from '../src/adapters/local'
import { createTasksBackend } from '../src/adapters/tasks'
import { isCurrentCycle, parseDate } from '../src/data/dates'
import type { Cycle, CycleInput, CyclePatch, ProjectInput, ProjectPatch } from '../src/domain'

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

const cycleInput = { name: 'Release cycle', startsAt: '2026-10-03', endsAt: '2026-10-16' }

test('administration capabilities match the operations each backend supports', () => {
  const local = setup().backend
  const tasks = createTasksBackend()
  for (const operation of ['CreateProject', 'UpdateProject', 'DeleteProject', 'CreateCycle', 'UpdateCycle', 'DeleteCycle'] as const) {
    assert.equal(local.capabilities[`can${operation}`], true)
    assert.equal(tasks.capabilities[`can${operation}`], false)
  }
  for (const method of ['createProject', 'updateProject', 'deleteProject', 'createCycle', 'updateCycle', 'deleteCycle'] as const) {
    assert.equal(typeof local[method], 'function')
    assert.equal(tasks[method], undefined)
  }
})

test('project and cycle creation and edits persist without changing IDs or linked issues', async () => {
  const { backend, storage } = setup()
  const project = await backend.createProject!({ name: '  New project  ' })
  assert.deepEqual(project, { id: project.id, name: 'New project', description: '', color: '#8b82e9', status: 'planned' })
  const cycle = await backend.createCycle!({ ...cycleInput, name: '  Release cycle  ' })
  assert.equal(cycle.name, 'Release cycle')
  const issue = await backend.createIssue({ title: 'Linked issue', projectId: project.id, cycleId: cycle.id })
  const updatedProject = await backend.updateProject!(project.id, {
    name: '  Renamed project  ', description: 'Ready to ship', color: '#123abc', status: 'in_progress', targetDate: '2026-10-31',
  })
  const updatedCycle = await backend.updateCycle!(cycle.id, { name: '  Renamed cycle  ', startsAt: '2026-10-04', endsAt: '2026-10-18' })
  assert.deepEqual(updatedProject, { id: project.id, name: 'Renamed project', description: 'Ready to ship', color: '#123abc', status: 'in_progress', targetDate: '2026-10-31' })
  assert.deepEqual(updatedCycle, { id: cycle.id, name: 'Renamed cycle', startsAt: '2026-10-04', endsAt: '2026-10-18' })
  const saved = await createLocalBackend(storage).load()
  assert.deepEqual(saved.projects.find(item => item.id === project.id), updatedProject)
  assert.deepEqual(saved.cycles.find(item => item.id === cycle.id), updatedCycle)
  assert.deepEqual(saved.issues.find(item => item.id === issue.id), issue)
  updatedProject.name = 'Outside mutation'
  updatedCycle.name = 'Outside mutation'
  assert.deepEqual(await backend.load(), saved)
  await backend.updateProject!(project.id, { targetDate: undefined })
  assert.equal((await createLocalBackend(storage).load()).projects.find(item => item.id === project.id)?.targetDate, undefined)
})

for (const entity of ['project', 'cycle'] as const) {
  test(`deleting a ${entity} clears only its links, preserves issues, and rejects missing IDs`, async () => {
    const { backend, storage } = setup()
    const before = await backend.load()
    const relation = entity === 'project' ? 'projectId' : 'cycleId'
    const collection = entity === 'project' ? 'projects' : 'cycles'
    const linkedIssue = before.issues.find(issue => issue[relation] !== null)!
    const id = linkedIssue[relation]!
    const remove = entity === 'project' ? backend.deleteProject! : backend.deleteCycle!
    const update = entity === 'project' ? backend.updateProject! : backend.updateCycle!
    const startedAt = Date.now()
    await remove(id)
    const finishedAt = Date.now()
    const after = await createLocalBackend(storage).load()
    assert.deepEqual(after[collection], before[collection].filter(item => item.id !== id))
    assert.deepEqual(after[entity === 'project' ? 'cycles' : 'projects'], before[entity === 'project' ? 'cycles' : 'projects'])
    assert.equal(after.issues.length, before.issues.length)
    for (const original of before.issues) {
      const current = after.issues.find(issue => issue.id === original.id)!
      if (original[relation] === id) {
        assert.deepEqual(current, { ...original, [relation]: null, updatedAt: current.updatedAt })
        assert.ok(Date.parse(current.updatedAt) >= startedAt && Date.parse(current.updatedAt) <= finishedAt)
      } else assert.deepEqual(current, original)
    }
    const persisted = storage.getItem(STORAGE_KEY)
    await assert.rejects(remove(id), /no longer exists/)
    await assert.rejects(update(id, { name: 'Missing' }), /no longer exists/)
    assert.equal(storage.getItem(STORAGE_KEY), persisted)
  })
}

test('invalid project mutations leave persisted data unchanged', async () => {
  const { backend, storage } = setup()
  const project = (await backend.load()).projects[0]
  const before = storage.getItem(STORAGE_KEY)
  for (const patch of [
    { name: ' \t ' }, { name: 7 }, { name: 'x'.repeat(501) }, { description: null },
    { color: 'red' }, { status: 'unknown' }, { targetDate: '2026-02-30' },
    { targetDate: 'not a date' }, { id: 'replacement' }, { unknown: 'field' },
  ]) {
    await assert.rejects(backend.createProject!({ name: 'Valid project', ...patch } as unknown as ProjectInput))
    await assert.rejects(backend.updateProject!(project.id, patch as unknown as ProjectPatch))
    assert.equal(storage.getItem(STORAGE_KEY), before)
  }
  for (const input of [null, [], 'project']) {
    await assert.rejects(backend.createProject!(input as unknown as ProjectInput))
    await assert.rejects(backend.updateProject!(project.id, input as unknown as ProjectPatch))
    assert.equal(storage.getItem(STORAGE_KEY), before)
  }
})

test('invalid cycle mutations and reversed ranges leave persisted data unchanged', async () => {
  const { backend, storage } = setup()
  const cycle = await backend.createCycle!(cycleInput)
  const before = storage.getItem(STORAGE_KEY)
  for (const patch of [
    { name: ' \n ' }, { name: 7 }, { startsAt: '2026-02-30' }, { endsAt: '2026-02-30' },
    { startsAt: 'not a date' }, { endsAt: '' }, { startsAt: '2026-10-17' }, { endsAt: '2026-10-02' },
    { id: 'replacement' }, { unknown: 'field' },
  ]) {
    await assert.rejects(backend.createCycle!({ ...cycleInput, ...patch } as unknown as CycleInput))
    await assert.rejects(backend.updateCycle!(cycle.id, patch as unknown as CyclePatch))
    assert.equal(storage.getItem(STORAGE_KEY), before)
  }
  for (const input of [null, [], 'cycle']) {
    await assert.rejects(backend.createCycle!(input as unknown as CycleInput))
    await assert.rejects(backend.updateCycle!(cycle.id, input as unknown as CyclePatch))
    assert.equal(storage.getItem(STORAGE_KEY), before)
  }
})

test('failed administration writes preserve entities and all issue links', async () => {
  const { backend, storage } = setup()
  const before = await backend.load()
  const persisted = storage.getItem(STORAGE_KEY)
  storage.failWrites = true
  for (const mutate of [
    () => backend.createProject!({ name: 'Unsaved project' }),
    () => backend.updateProject!(before.projects[0].id, { name: 'Unsaved project' }),
    () => backend.deleteProject!(before.projects[0].id),
    () => backend.createCycle!(cycleInput),
    () => backend.updateCycle!(before.cycles[0].id, { name: 'Unsaved cycle' }),
    () => backend.deleteCycle!(before.cycles[0].id),
  ]) {
    await assert.rejects(mutate(), /Could not save/)
    assert.equal(storage.getItem(STORAGE_KEY), persisted)
    assert.deepEqual(await backend.load(), before)
  }
})

test('date-only cycles include both local boundary days across time zones and daylight saving', async () => {
  const previous = process.env.TZ
  try {
    for (const timezone of ['UTC', 'Europe/Helsinki', 'America/New_York']) {
      process.env.TZ = timezone
      const cycle: Cycle = { id: 'local', name: 'Local dates', startsAt: '2026-10-25', endsAt: '2026-10-25' }
      const start = new Date(2026, 9, 25).getTime()
      const end = new Date(2026, 9, 25, 23, 59, 59, 999).getTime()
      assert.equal(parseDate(cycle.startsAt).getTime(), start, timezone)
      assert.equal(parseDate(cycle.endsAt, true).getTime(), end, timezone)
      assert.equal(isCurrentCycle(cycle, start - 1), false, timezone)
      assert.equal(isCurrentCycle(cycle, start), true, timezone)
      assert.equal(isCurrentCycle(cycle, end), true, timezone)
      assert.equal(isCurrentCycle(cycle, end + 1), false, timezone)
      assert.equal([cycle].find(item => isCurrentCycle(item, end + 1)), undefined)
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('timestamp cycle boundaries retain their exact instants', () => {
  const cycle: Cycle = { id: 'timestamp', name: 'Exact instants', startsAt: '2026-10-03T10:00:00+03:00', endsAt: '2026-10-03T11:00:00+03:00' }
  const start = Date.parse(cycle.startsAt)
  const end = Date.parse(cycle.endsAt)
  assert.equal(parseDate(cycle.startsAt).getTime(), start)
  assert.equal(parseDate(cycle.endsAt, true).getTime(), end)
  assert.equal(isCurrentCycle(cycle, start - 1), false)
  assert.equal(isCurrentCycle(cycle, start), true)
  assert.equal(isCurrentCycle(cycle, end), true)
  assert.equal(isCurrentCycle(cycle, end + 1), false)
})


test('mixed cycle boundaries remain readable across time zones', async () => {
  const previous = process.env.TZ
  try {
    process.env.TZ = 'UTC'
    const { backend, storage } = setup()
    const endDate = await backend.createCycle!({ name: 'Date end', startsAt: '2026-10-03T22:00:00Z', endsAt: '2026-10-03' })
    const startDate = await backend.createCycle!({ name: 'Date start', startsAt: '2026-10-03', endsAt: '2026-10-03T01:00:00Z' })
    const saved = await backend.load()
    for (const timezone of ['Europe/Helsinki', 'America/New_York']) {
      process.env.TZ = timezone
      assert.deepEqual(await createLocalBackend(storage).load(), saved)
      assert.equal((await backend.updateCycle!(endDate.id, { name: 'Renamed' })).startsAt, endDate.startsAt)
      assert.equal((await backend.updateCycle!(startDate.id, { name: 'Renamed' })).endsAt, startDate.endsAt)
      await backend.updateCycle!(endDate.id, { name: endDate.name })
      await backend.updateCycle!(startDate.id, { name: startDate.name })
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})
