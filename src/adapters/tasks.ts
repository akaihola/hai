import { TASK_SECTIONS, type IssueInput, type IssuePatch, type WorkspaceBackend } from '../domain'
import { assertWorkspace } from '../data/validation'

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
        throw new Error(`${message} Close this editor and refresh the source before retrying.`)
      }
      throw new Error(message)
    }
    return response
  }
  async function snapshot(response: Response) {
    const value: unknown = await response.json().catch(() => { throw new Error('The TASKS.md server returned an invalid response.') })
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
    return snapshot(response)
  }
  return {
    capabilities: {
      id: 'tasks', name: 'TASKS.md', description: 'Connected to TASKS.md and its description files on the server.',
      canCreate: true, canUpdate: true, canDelete: true, canImport: false, canExport: true, canReorderBacklog: true, canOpenWorkspace: true, persistence: 'filesystem', workflow: 'tasks',
      fields: { assignee: false, project: false, cycle: false, description: true },
    },
    get source() { return source },
    async openWorkspace(path) { const backend = createTasksBackend(baseUrl, path); await backend.load(); return backend },
    async load() { return (await snapshot(await request('/workspace'))).workspace },
    async createIssue(input) { const { issue } = await mutate('POST', '/issues', input); if (!issue) throw new Error('Issue saved, but the response could not identify it. Refresh the source.'); return issue },
    async updateIssue(id, patch) { const { issue } = await mutate('PATCH', `/issues/${encodeURIComponent(id)}`, patch); if (!issue) throw new Error('Issue saved, but it was missing from the response. Refresh the source.'); return issue },
    async deleteIssue(id) { await mutate('DELETE', `/issues/${encodeURIComponent(id)}`) },
    async reorderBacklog(issueIds) { return (await mutate('POST', '/backlog/order', { issueIds })).workspace },
    async exportData(format) { return (await request(`/export?format=${format}`)).text() },
    async importData() { throw new Error('Import is unavailable for TASKS.md. Edit the source files and refresh the workspace.') },
  }
}

export const tasksBackend = createTasksBackend()
