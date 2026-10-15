import assert from 'node:assert/strict'
import test from 'node:test'
import { issueGroups, issueGroupId } from '../src/data/issue-groups.ts'
import { createTasksBackend } from '../src/adapters/tasks.ts'
import { TASK_SECTIONS, DEMO_STATES, type SourceState, type Issue } from '../src/domain.ts'

for (const [workflow, states, acceptance] of [
  ['tasks', TASK_SECTIONS, true],
  ['scratch', [{ id: 'open', stage: 'ready' }, { id: 'claimed', stage: 'active' }, { id: 'resolved', stage: 'done' }], false],
  ['backlog', [{ id: 'ideas', stage: 'triage' }, { id: 'backlog', stage: 'ready' }, { id: 'completed', stage: 'done' }], false],
  ['demo', DEMO_STATES, false],
] as const) {
  test(`${workflow} groups use every catalog entry and its acceptance capability`, () => {
    const capabilities = { ...createTasksBackend().capabilities, sourceStates: states as readonly SourceState[], fields: { assignee: false, project: false, cycle: false, description: true, acceptance } }
    const groups = issueGroups(capabilities)
    assert.deepEqual([...new Set(groups.map(group => group.sourceState))], states.map(state => state.id))
    for (const state of states) {
      for (const accepted of [false, true]) {
        const issue = { sourceState: state.id, accepted } as Issue
        const group = groups.find(group => group.id === issueGroupId(issue, groups))!
        assert.equal(group.sourceState, state.id)
        assert.equal(group.accepted, state.stage === 'done' && acceptance ? accepted : undefined)
      }
    }
  })
}

test('acceptance split uses the done stage even with a custom native name', () => {
  const capabilities = { ...createTasksBackend().capabilities, sourceStates: [{ id: 'Shipped', stage: 'done' } as const] }
  const groups = issueGroups(capabilities)
  assert.equal(issueGroupId({ sourceState: 'Shipped', accepted: false } as Issue, groups), 'Completed')
  assert.equal(issueGroupId({ sourceState: 'Shipped', accepted: true } as Issue, groups), 'Accepted')
})

test('all projects groups by derived stages while retaining native issue states', () => {
  const capabilities = { ...createTasksBackend().capabilities, workspaceScope: 'all' as const, sourceStates: [{ id: 'ready', stage: 'ready' }, { id: 'done', stage: 'done' }] as const }
  const groups = issueGroups(capabilities)
  assert.deepEqual(groups.map(group => group.id), ['ready', 'done'])
  for (const sourceState of ['Ordered backlog', 'ready-for-agent', 'backlog']) {
    assert.equal(issueGroupId({ sourceState, workspaceStage: 'ready' } as Issue, groups), 'ready')
  }
  assert.equal(issueGroupId({ sourceState: 'completed', workspaceStage: 'done', accepted: true } as Issue, groups), 'done')
})
