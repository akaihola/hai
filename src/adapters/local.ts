import type { Issue, IssueInput, IssuePatch, WorkspaceBackend } from '../domain'
import { createSeedWorkspace } from '../data/seed'
import { exportTasks } from '../data/export'
import { nextIssueNumber, parseBackup, serializeBackup, type WorkspaceBackup } from '../data/validation'

export const STORAGE_KEY = 'hai.workspace.v1'
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const mutableFields = new Set(['title', 'description', 'status', 'priority', 'assigneeId', 'projectId', 'cycleId', 'labels'])

function validateInput(input: IssuePatch): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Issue details must be an object.')
  if (Object.keys(input).some(key => !mutableFields.has(key))) throw new Error('Issue IDs, identifiers, and timestamps cannot be edited.')
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
      try { return parseBackup(raw) }
      catch (error) { throw new Error(`The saved workspace could not be loaded. Your stored data has been preserved. ${error instanceof Error ? error.message : ''}`) }
    }
    const workspace = createSeedWorkspace()
    const backup: WorkspaceBackup = { version: 1, nextIssueNumber: nextIssueNumber(workspace), workspace }
    save(backup)
    return backup
  }
  return {
    capabilities: {
      id: 'local', name: 'Local workspace', description: 'Saved in this browser. Back up your workspace to keep a portable copy.',
      canCreate: true, canUpdate: true, canDelete: true, canImport: true, canExport: true, persistence: 'browser',
    },
    async load() { return read().workspace },
    async createIssue(input: IssueInput) {
      validateInput(input)
      const backup = read()
      let number = backup.nextIssueNumber
      while (backup.workspace.issues.some(issue => issue.id === `issue-${number}`)) number++
      const timestamp = new Date().toISOString()
      const issue: Issue = {
        description: '', status: 'todo', priority: 'none', assigneeId: null, projectId: null, cycleId: null, labels: [],
        ...input, title: typeof input.title === 'string' ? input.title.trim() : input.title,
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
      const issue = { ...backup.workspace.issues[index], ...patch, updatedAt: new Date().toISOString() }
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
    async exportData(format) {
      const backup = read()
      if (format === 'tasks') return exportTasks(backup.workspace)
      if (format !== 'json') throw new Error('Unsupported export format.')
      return serializeBackup(backup)
    },
    async importData(content, format) {
      if (format !== 'json') throw new Error('TASKS.md is a readable export only. Import a Hai JSON backup to restore a workspace.')
      const backup = parseBackup(content)
      read()
      save(backup)
      return structuredClone(backup.workspace)
    },
  }
}

export const localBackend = createLocalBackend()
