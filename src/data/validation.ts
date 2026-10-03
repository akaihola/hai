import { ISSUE_TITLE_MAX_LENGTH, PRIORITIES, STATUSES, type Workspace } from '../domain'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, max = 500, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0)
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false
  const day = value.slice(0, 10)
  return new Date(day).toISOString().slice(0, 10) === day
}
function color(value: unknown): boolean {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
}
function fail(message: string): never { throw new Error(`Invalid workspace: ${message}`) }

export function assertWorkspace(value: unknown): asserts value is Workspace {
  if (!record(value)) fail('expected a workspace object.')
  for (const key of ['issues', 'projects', 'cycles', 'members'] as const) {
    const items = value[key]
    if (!Array.isArray(items) || items.length > 10000) fail(`${key} must be an array with at most 10,000 entries.`)
    const ids = new Set<string>()
    for (const item of items) {
      if (!record(item) || !text(item.id, 200)) fail(`${key} contains an invalid ID.`)
      if (ids.has(item.id)) fail(`${key} contains duplicate ID ${item.id}.`)
      ids.add(item.id)
    }
  }
  const workspace = value as unknown as Workspace
  for (const member of workspace.members) {
    if (!text(member.name) || !text(member.initials, 5) || !color(member.color)) fail(`member ${member.id} is invalid.`)
  }
  if (workspace.currentMemberId !== null && !workspace.members.some(member => member.id === workspace.currentMemberId)) fail('current member does not exist.')
  for (const project of workspace.projects) {
    if (!text(project.name) || !text(project.description, 50000, true) || !color(project.color)
      || !['planned', 'in_progress', 'completed'].includes(project.status)
      || (project.targetDate !== undefined && !date(project.targetDate))) fail(`project ${project.id} is invalid.`)
  }
  for (const cycle of workspace.cycles) {
    if (!text(cycle.name) || !date(cycle.startsAt) || !date(cycle.endsAt)
      || Date.parse(cycle.startsAt) > Date.parse(cycle.endsAt)) fail(`cycle ${cycle.id} is invalid.`)
  }
  const identifiers = new Set<string>()
  const references = {
    assigneeId: new Set(workspace.members.map(member => member.id)),
    projectId: new Set(workspace.projects.map(project => project.id)),
    cycleId: new Set(workspace.cycles.map(cycle => cycle.id)),
  }
  for (const issue of workspace.issues) {
    if (!text(issue.identifier, 200) || identifiers.has(issue.identifier)) fail(`issue ${issue.id} has an invalid or duplicate identifier.`)
    identifiers.add(issue.identifier)
    if (!text(issue.title, ISSUE_TITLE_MAX_LENGTH) || !text(issue.description, 50000, true)) fail(`issue ${issue.identifier} needs a title of 1–${ISSUE_TITLE_MAX_LENGTH.toLocaleString('en-US')} characters and a description of at most 50,000 characters.`)
    if (!STATUSES.some(status => status.id === issue.status)) fail(`issue ${issue.identifier} has an unknown status.`)
    if (!PRIORITIES.some(priority => priority.id === issue.priority)) fail(`issue ${issue.identifier} has an unknown priority.`)
    if (!Array.isArray(issue.labels) || issue.labels.length > 50 || issue.labels.some(label => !text(label, 100))) fail(`issue ${issue.identifier} has invalid labels.`)
    if (!date(issue.createdAt) || !date(issue.updatedAt)) fail(`issue ${issue.identifier} has invalid dates.`)
    for (const key of ['assigneeId', 'projectId', 'cycleId'] as const) {
      if (issue[key] !== null && !references[key].has(issue[key])) fail(`issue ${issue.identifier} has an unknown ${key}.`)
    }
  }
}

export interface WorkspaceBackup { version: 1; nextIssueNumber: number; workspace: Workspace }
const MAX_BACKUP_BYTES = 2 * 1024 * 1024
export function nextIssueNumber(workspace: Workspace): number {
  return Math.max(0, ...workspace.issues.map(issue => Number(/^HAI-(\d+)$/.exec(issue.identifier)?.[1] ?? 0))) + 1
}
function assertBackup(parsed: unknown): asserts parsed is WorkspaceBackup {
  if (!record(parsed) || parsed.version !== 1) throw new Error('Unsupported backup format. Choose a version 1 Hai JSON backup.')
  assertWorkspace(parsed.workspace)
  if (typeof parsed.nextIssueNumber !== 'number' || !Number.isSafeInteger(parsed.nextIssueNumber)
    || parsed.nextIssueNumber >= Number.MAX_SAFE_INTEGER
    || parsed.nextIssueNumber < nextIssueNumber(parsed.workspace)) throw new Error('Invalid workspace: issue numbering is inconsistent.')
}
function checkSize(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) throw new Error('This backup is too large. The limit is 2 MB.')
}
export function serializeBackup(backup: WorkspaceBackup): string {
  assertBackup(backup)
  const content = `${JSON.stringify(backup, null, 2)}\n`
  checkSize(content)
  return content
}
export function parseBackup(content: string): WorkspaceBackup {
  checkSize(content)
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { throw new Error('This file is not valid JSON. Choose a Hai JSON backup.') }
  assertBackup(parsed)
  return parsed
}
