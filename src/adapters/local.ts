import { DEMO_STATES, selectState, statusForStage } from '../domain'
import type { Issue, IssueInput, IssuePatch, Project, Cycle, WorkspaceBackend } from '../domain'
import { createSeedWorkspace } from '../data/seed'
import { exportTasks } from '../data/export'
import { nextIssueNumber, parseBackup, serializeBackup, type WorkspaceBackup } from '../data/validation'

export const STORAGE_KEY = 'hai.workspace.v1'
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const mutableFields = new Set(['title', 'description', 'sourceState', 'status', 'priority', 'assigneeId', 'projectId', 'cycleId', 'labels'])

function validateInput(input: IssuePatch): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Issue details must be an object.')
  if (Object.keys(input).some(key => !mutableFields.has(key))) throw new Error('Issue IDs, identifiers, and timestamps cannot be edited.')
}

function readBackup(content: string): WorkspaceBackup {
  const backup = parseBackup(content)
  for (const issue of backup.workspace.issues) {
    const state = selectState(DEMO_STATES, issue.sourceState === undefined ? { status: issue.status } : { sourceState: issue.sourceState, status: issue.status })
    Object.assign(issue, { sourceState: state.id, status: statusForStage(state.stage) })
  }
  return backup
}

export function createLocalBackend(storage?: StorageLike): WorkspaceBackend {
  // honey: whole-workspace writes assume one editing tab; add revision checks before shared editing.
  function store(): StorageLike {
    try {
      const result = storage ?? globalThis.localStorage
      if (!result) throw new Error()
      return result
    } catch { throw new Error('Browser storage is unavailable. Allow site storage and try again.') }
  }
  function save(backup: WorkspaceBackup): void {
    const content = serializeBackup(backup)
    try { store().setItem(STORAGE_KEY, content) }
    catch { throw new Error('Could not save your changes. Browser storage may be full or disabled. Your previous data has not been replaced.') }
  }
  function read(): WorkspaceBackup {
    let raw: string | null
    try { raw = store().getItem(STORAGE_KEY) }
    catch { throw new Error('Could not read this workspace. Allow browser storage and try again.') }
    if (raw !== null) {
      try { return readBackup(raw) }
      catch (error) { throw new Error(`The saved workspace could not be loaded. Your stored data has been preserved. ${error instanceof Error ? error.message : ''}`) }
    }
    const workspace = createSeedWorkspace()
    const backup: WorkspaceBackup = { version: 1, nextIssueNumber: nextIssueNumber(workspace), workspace }
    save(backup)
    return backup
  }
  function validateEntityInput(input: unknown, fields: string[]): void {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) throw new Error('Entity details contain unsupported fields. IDs cannot be edited.')
  }
  function removeEntity(kind: 'projects' | 'cycles', id: string): void {
    const backup = read()
    const items = backup.workspace[kind]
    const index = items.findIndex(item => item.id === id)
    if (index === -1) throw new Error('This item no longer exists. Refresh the workspace and try again.')
    items.splice(index, 1)
    const relation = kind === 'projects' ? 'projectId' : 'cycleId'
    const updatedAt = new Date().toISOString()
    for (const issue of backup.workspace.issues) if (issue[relation] === id) { issue[relation] = null; issue.updatedAt = updatedAt }
    save(backup)
  }
  return {
    capabilities: {
      sourceStates: DEMO_STATES, fields: { description: true, assignee: true, project: true, cycle: true, acceptance: false, dependencies: false },
      id: 'local', name: 'Local workspace', description: 'Saved in this browser. Back up your workspace to keep a portable copy.',
      canCreate: true, canUpdate: true, canDelete: true, canImport: true, canExport: true, persistence: 'browser',
      canCreateProject: true, canUpdateProject: true, canDeleteProject: true, canCreateCycle: true, canUpdateCycle: true, canDeleteCycle: true,
    },
    async load() { return read().workspace },
    async createIssue(input: IssueInput) {
      validateInput(input)
      const backup = read()
      let number = backup.nextIssueNumber
      while (backup.workspace.issues.some(issue => issue.id === `issue-${number}`)) number++
      const timestamp = new Date().toISOString()
      const state = selectState(DEMO_STATES, input, 'todo')
      const issue: Issue = {
        description: '', priority: 'none', assigneeId: null, projectId: null, cycleId: null, labels: [],
        ...input, sourceState: state.id, status: statusForStage(state.stage), title: typeof input.title === 'string' ? input.title.trim() : input.title,
        id: `issue-${number}`, identifier: `HAI-${number}`, createdAt: timestamp, updatedAt: timestamp,
      }
      backup.workspace.issues.unshift(issue)
      backup.nextIssueNumber = number + 1
      save(backup)
      return structuredClone(issue)
    },
    async updateIssue(id: string, patch: IssuePatch) {
      validateInput(patch)
      const backup = read()
      const index = backup.workspace.issues.findIndex(issue => issue.id === id)
      if (index === -1) throw new Error('This issue no longer exists. Refresh the workspace and try again.')
      const state = selectState(DEMO_STATES, patch, backup.workspace.issues[index].sourceState)
      const issue = { ...backup.workspace.issues[index], ...patch, sourceState: state.id, status: statusForStage(state.stage), updatedAt: new Date().toISOString() }
      if (typeof issue.title === 'string') issue.title = issue.title.trim()
      backup.workspace.issues[index] = issue
      save(backup)
      return structuredClone(issue)
    },
    async deleteIssue(id: string) {
      const backup = read()
      const index = backup.workspace.issues.findIndex(issue => issue.id === id)
      if (index === -1) throw new Error('This issue no longer exists. Refresh the workspace and try again.')
      backup.workspace.issues.splice(index, 1)
      save(backup)
    },
    async createProject(input) {
      validateEntityInput(input, ['name', 'description', 'color', 'status', 'targetDate'])
      const backup = read()
      const project: Project = { description: '', color: '#8b82e9', status: 'planned', ...input, name: typeof input.name === 'string' ? input.name.trim() : input.name, id: `project-${crypto.getRandomValues(new Uint32Array(4)).join('-')}` }
      backup.workspace.projects.push(project)
      save(backup)
      return structuredClone(project)
    },
    async updateProject(id, patch) {
      validateEntityInput(patch, ['name', 'description', 'color', 'status', 'targetDate'])
      const backup = read()
      const project = backup.workspace.projects.find(item => item.id === id)
      if (!project) throw new Error('This project no longer exists. Refresh the workspace and try again.')
      Object.assign(project, patch)
      if (typeof project.name === 'string') project.name = project.name.trim()
      save(backup)
      return structuredClone(project)
    },
    async deleteProject(id) { removeEntity('projects', id) },
    async createCycle(input) {
      validateEntityInput(input, ['name', 'startsAt', 'endsAt'])
      const backup = read()
      const cycle: Cycle = { ...input, name: typeof input.name === 'string' ? input.name.trim() : input.name, id: `cycle-${crypto.getRandomValues(new Uint32Array(4)).join('-')}` }
      backup.workspace.cycles.push(cycle)
      save(backup)
      return structuredClone(cycle)
    },
    async updateCycle(id, patch) {
      validateEntityInput(patch, ['name', 'startsAt', 'endsAt'])
      const backup = read()
      const cycle = backup.workspace.cycles.find(item => item.id === id)
      if (!cycle) throw new Error('This cycle no longer exists. Refresh the workspace and try again.')
      Object.assign(cycle, patch)
      if (typeof cycle.name === 'string') cycle.name = cycle.name.trim()
      save(backup)
      return structuredClone(cycle)
    },
    async deleteCycle(id) { removeEntity('cycles', id) },
    async exportData(format) {
      const backup = read()
      if (format === 'tasks') return exportTasks(backup.workspace)
      if (format !== 'json') throw new Error('Unsupported export format.')
      return serializeBackup(backup)
    },
    async importData(content, format) {
      if (format !== 'json') throw new Error('TASKS.md is a readable export only. Import a Hai JSON backup to restore a workspace.')
      const backup = readBackup(content)
      read()
      save(backup)
      return structuredClone(backup.workspace)
    },
  }
}

export const localBackend = createLocalBackend()
