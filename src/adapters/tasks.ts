import { TASK_SECTIONS, type IssueInput, type IssuePatch, type WorkspaceBackend, type WorkspaceSource, type Issue } from '../domain'
import { assertWorkspace } from '../data/validation'

class StaleRevisionError extends Error {}

async function listTasksProjects(baseUrl: string, sourcePath?: string): Promise<WorkspaceSource[]> {
  const suffix = sourcePath ? `?source=${encodeURIComponent(sourcePath)}` : ''
  const response = await fetch(`${baseUrl}/projects${suffix}`, { cache: 'no-store' })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? 'Could not list projects.')
  if (!Array.isArray(value.sources) || value.sources.some((item: WorkspaceSource) => !item || typeof item.name !== 'string' || typeof item.path !== 'string' || !item.path.startsWith('/'))) throw new Error('The server returned an invalid project list.')
  return [...new Map<string, WorkspaceSource>(value.sources.map((item: WorkspaceSource) => [item.path, item])).values()]
}

export function createTasksBackend(baseUrl = '/api', sourcePath?: string): WorkspaceBackend {
  let revision: string | null = null
  let source: WorkspaceBackend['source']
  async function request(path: string, options?: RequestInit): Promise<Response> {
    let response: Response
    if (sourcePath !== undefined) path += `${path.includes('?') ? '&' : '?'}source=${encodeURIComponent(sourcePath)}`
    try { response = await fetch(`${baseUrl}${path}`, { ...options, cache: 'no-store' }) }
    catch { throw new Error('Cannot reach the TASKS.md server. Check the connection and refresh the source.') }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const message = typeof body?.error === 'string' ? body.error : `TASKS.md server returned ${response.status}.`
      if (response.status === 409 || response.status === 412 || response.status === 428) {
        revision = null
        const ConflictError = response.status === 412 ? StaleRevisionError : Error
        throw new ConflictError(`${message} Close this editor and refresh the source before retrying.`)
      }
      throw new Error(message)
    }
    return response
  }
  async function read(response: Response): Promise<unknown> {
    return response.json().catch(() => { throw new Error('The TASKS.md server returned an invalid response.') })
  }
  function snapshot(value: unknown) {
    if (!value || typeof value !== 'object' || !('workspace' in value) || !('revision' in value) || typeof value.revision !== 'string' || !value.revision) throw new Error('The TASKS.md server returned an invalid workspace response.')
    if ('source' in value) {
      const next = value.source
      if (!next || typeof next !== 'object' || !('name' in next) || typeof next.name !== 'string' || !next.name || !('path' in next) || typeof next.path !== 'string' || !next.path.startsWith('/') || (source && next.path !== source.path)) throw new Error('The TASKS.md server returned invalid source information.')
    } else if (sourcePath !== undefined) throw new Error('The TASKS.md server did not identify the requested source.')
    assertWorkspace(value.workspace)
    for (const issue of value.workspace.issues) {
      if (!TASK_SECTIONS.some(section => section.id === issue.sourceSection && section.status === issue.status) || typeof issue.accepted !== 'boolean'
        || (issue.accepted && issue.status !== 'done') || (issue.sourcePath !== undefined && typeof issue.sourcePath !== 'string')
        || (issue.sourceReference !== undefined && (typeof issue.sourceReference !== 'string' || !/^\[(?:\d+|\*)\]$/.test(issue.sourceReference)))
        || (issue.dependencies !== undefined && (!Array.isArray(issue.dependencies) || issue.dependencies.some(item => typeof item !== 'string')))) throw new Error('The TASKS.md server returned invalid workflow information.')
    }
    if ('source' in value) {
      source = Object.freeze({ ...(value.source as NonNullable<WorkspaceBackend['source']>) })
      sourcePath = source.path
    }
    revision = value.revision
    const issueId = 'issue' in value && value.issue && typeof value.issue === 'object' && 'id' in value.issue ? value.issue.id : undefined
    return { workspace: value.workspace, issue: value.workspace.issues.find(issue => issue.id === issueId) }
  }
  async function mutate(method: string, path: string, input?: IssueInput | IssuePatch | { issueIds: string[] }) {
    if (!revision) throw new Error('Refresh the source before saving changes to TASKS.md.')
    const response = await request(path, { method, headers: { 'Content-Type': 'application/json', 'If-Match': `"${revision}"` }, ...(input ? { body: JSON.stringify(input) } : {}) })
    return snapshot(await read(response))
  }
  return {
    capabilities: {
      id: 'tasks', name: 'TASKS.md', description: 'Connected to TASKS.md and its description files on the server.',
      get canAutoRefresh() { return !!source && !source.path.startsWith('/@') },
      canCreate: true, canUpdate: true, canDelete: true, canImport: false, canExport: true, canReorderBacklog: true, canOpenWorkspace: true, canListWorkspaces: true, canViewAllProjects: true, persistence: 'filesystem', workflow: 'tasks',
      canCreateProject: false, canUpdateProject: false, canDeleteProject: false, canCreateCycle: false, canUpdateCycle: false, canDeleteCycle: false,
      fields: { assignee: false, project: false, cycle: false, description: true },
    },
    get source() { return source },
    listWorkspaces() { return listTasksProjects(baseUrl, sourcePath) },
    openAllProjects() { return createAllTasksBackend(baseUrl, sourcePath) },
    async openWorkspace(path) { const backend = createTasksBackend(baseUrl, path); await backend.load(); return backend },
    async load() { return snapshot(await read(await request('/workspace'))).workspace },
    async pollChanges(canApply) {
      const previous = revision
      const value = await read(await request('/workspace'))
      // Never advance a draft's revision or replace a newer foreground read/save.
      if (!canApply() || revision !== previous) return null
      const result = snapshot(value)
      return revision === previous ? null : result.workspace
    },
    async createIssue(input) {
      const draft = structuredClone(input)
      let result
      try { result = await mutate('POST', '/issues', draft) }
      catch (error) {
        if (!(error instanceof StaleRevisionError) || !source) throw error
        snapshot(await read(await request('/workspace')))
        result = await mutate('POST', '/issues', draft)
      }
      if (!result.issue) throw new Error('Issue saved, but the response could not identify it. Refresh the source.')
      return result.issue
    },
    async updateIssue(id, patch) { const { issue } = await mutate('PATCH', `/issues/${encodeURIComponent(id)}`, patch); if (!issue) throw new Error('Issue saved, but it was missing from the response. Refresh the source.'); return issue },
    async deleteIssue(id) { await mutate('DELETE', `/issues/${encodeURIComponent(id)}`) },
    async reorderBacklog(issueIds) { return (await mutate('POST', '/backlog/order', { issueIds })).workspace },
    async exportData(format) { return (await request(`/export?format=${format}`)).text() },
    async importData() { throw new Error('Import is unavailable for TASKS.md. Edit the source files and refresh the workspace.') },
  }
}

export function createAllTasksBackend(baseUrl = '/api', sourcePath?: string): WorkspaceBackend {
  let sources: WorkspaceSource[] = []
  let sourceErrors: { source: WorkspaceSource; error: string }[] = []
  let owners = new Map<string, { path: string; id: string }>()
  const unavailable = async (): Promise<never> => { throw new Error('Open a project to edit or export its tracker.') }
  return {
    capabilities: {
      id: 'tasks-all', name: 'All projects', description: 'Issues across available TASKS.md projects. Open an issue to edit it in its project.',
      workspaceScope: 'all', canViewAllProjects: true, canOpenWorkspace: true, canListWorkspaces: true,
      canCreate: false, canUpdate: false, canDelete: false, canImport: false, canExport: false,
      canReorderBacklog: false, canAutoRefresh: false, persistence: 'filesystem', workflow: 'tasks',
      canCreateProject: false, canUpdateProject: false, canDeleteProject: false,
      canCreateCycle: false, canUpdateCycle: false, canDeleteCycle: false,
      fields: { assignee: false, project: false, cycle: false, description: true },
    },
    get sources() { return sources },
    get sourceErrors() { return sourceErrors },
    listWorkspaces() { return listTasksProjects(baseUrl, sourcePath) },
    openAllProjects() { return createAllTasksBackend(baseUrl, sourcePath) },
    async openWorkspace(path) { return createTasksBackend(baseUrl).openWorkspace!(path) },
    async openIssue(id) {
      const owner = owners.get(id)
      if (!owner) throw new Error('This issue is no longer available. Refresh all projects.')
      const backend = createTasksBackend(baseUrl, owner.path)
      const workspace = await backend.load()
      const issue = workspace.issues.find(item => item.id === owner.id)
      if (!issue) throw new Error('This issue was removed from its project. Refresh all projects.')
      return { backend, issue }
    },
    async load() {
      const listed = await listTasksProjects(baseUrl, sourcePath)
      const results = await Promise.allSettled(listed.map(async source => {
        const backend = createTasksBackend(baseUrl, source.path)
        const workspace = await backend.load()
        return { source: backend.source!, issues: workspace.issues }
      }))
      const issues: Issue[] = [], nextSources: WorkspaceSource[] = [], errors: typeof sourceErrors = []
      const nextOwners: typeof owners = new Map()
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          errors.push({ source: listed[index]!, error: result.reason instanceof Error ? result.reason.message : 'Could not open project.' })
          continue
        }
        const { source, issues: projectIssues } = result.value
        if (nextSources.some(item => item.path === source.path)) continue
        nextSources.push(source)
        for (const issue of projectIssues) {
          const id = JSON.stringify([source.path, issue.id])
          nextOwners.set(id, { path: source.path, id: issue.id })
          issues.push({ ...issue, id, workspaceSource: source })
        }
      }
      sources = nextSources; sourceErrors = errors; owners = nextOwners
      return { issues, projects: [], cycles: [], members: [], currentMemberId: null }
    },
    createIssue: unavailable, updateIssue: unavailable, deleteIssue: unavailable,
    exportData: unavailable, importData: unavailable,
  }
}

export const tasksBackend = createTasksBackend()
