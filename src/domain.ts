export const STATUSES = [
  { id: 'backlog', label: 'Backlog', color: '#85858e' },
  { id: 'todo', label: 'Todo', color: '#aaaab2' },
  { id: 'in_progress', label: 'In Progress', color: '#efc55b' },
  { id: 'in_review', label: 'In Review', color: '#9c8de1' },
  { id: 'done', label: 'Done', color: '#6e86d9' },
  { id: 'canceled', label: 'Canceled', color: '#85858e' },
] as const

export const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', color: '#e88c79' },
  { id: 'high', label: 'High', color: '#dba872' },
  { id: 'medium', label: 'Medium', color: '#c4bc94' },
  { id: 'low', label: 'Low', color: '#94a8bc' },
  { id: 'none', label: 'No priority', color: '#85858e' },
] as const

export type IssueStatus = typeof STATUSES[number]['id']
export type IssuePriority = typeof PRIORITIES[number]['id']
export const TASK_SECTIONS = [
  { id: 'Unverified proposals', status: 'backlog' },
  { id: 'Ordered backlog', status: 'backlog' },
  { id: 'Scheduled', status: 'todo' },
  { id: 'In Progress', status: 'in_progress' },
  { id: 'Completed / Accepted', status: 'done' },
] as const
export type TaskSection = typeof TASK_SECTIONS[number]['id']
export interface Issue {
  id: string
  identifier: string
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
  assigneeId: string | null
  projectId: string | null
  cycleId: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
  sourceSection?: TaskSection
  accepted?: boolean
  sourcePath?: string
  sourceReference?: string
  dependencies?: string[]
  workspaceSource?: WorkspaceSource
}
export interface Project {
  id: string
  name: string
  description: string
  color: string
  status: 'planned' | 'in_progress' | 'completed'
  targetDate?: string
}
export interface Cycle { id: string; name: string; startsAt: string; endsAt: string }
export type ProjectInput = Pick<Project, 'name'> & Partial<Omit<Project, 'id' | 'name'>>
export type ProjectPatch = Partial<ProjectInput>
export type CycleInput = Omit<Cycle, 'id'>
export type CyclePatch = Partial<CycleInput>
export interface Member { id: string; name: string; initials: string; color: string }
export interface Workspace { issues: Issue[]; projects: Project[]; cycles: Cycle[]; members: Member[]; currentMemberId: string | null }
export type IssueInput = Pick<Issue, 'title'> & Partial<Omit<Issue, 'id' | 'identifier' | 'createdAt' | 'updatedAt' | 'title'>>
export type IssuePatch = Partial<IssueInput>
export const ISSUE_TITLE_MAX_LENGTH = 50000
export type ExportFormat = 'json' | 'tasks'
export interface WorkspaceSource { name: string; path: string }
export interface BackendCapabilities {
  id: string
  name: string
  description: string
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canImport: boolean
  canExport: boolean
  canCreateProject?: boolean
  canUpdateProject?: boolean
  canDeleteProject?: boolean
  canCreateCycle?: boolean
  canUpdateCycle?: boolean
  canDeleteCycle?: boolean
  canReorderBacklog?: boolean
  canOpenWorkspace?: boolean
  canAutoRefresh?: boolean
  canViewAllProjects?: boolean
  workspaceScope?: 'all'
  persistence: 'browser' | 'filesystem' | 'remote'
  workflow?: 'tasks'
  fields?: { assignee: boolean; project: boolean; cycle: boolean; description: boolean }
}
export interface WorkspaceBackend {
  readonly capabilities: BackendCapabilities
  readonly source?: WorkspaceSource
  readonly sources?: WorkspaceSource[]
  readonly sourceErrors?: { source: WorkspaceSource; error: string }[]
  openWorkspace?(path: string): Promise<WorkspaceBackend>
  openAllProjects?(): WorkspaceBackend
  openIssue?(id: string): Promise<{ backend: WorkspaceBackend; issue: Issue }>
  load(): Promise<Workspace>
  pollChanges?(canApply: () => boolean): Promise<Workspace | null>
  createIssue(input: IssueInput): Promise<Issue>
  updateIssue(id: string, patch: IssuePatch): Promise<Issue>
  deleteIssue(id: string): Promise<void>
  createProject?(input: ProjectInput): Promise<Project>
  updateProject?(id: string, patch: ProjectPatch): Promise<Project>
  deleteProject?(id: string): Promise<void>
  createCycle?(input: CycleInput): Promise<Cycle>
  updateCycle?(id: string, patch: CyclePatch): Promise<Cycle>
  deleteCycle?(id: string): Promise<void>
  reorderBacklog?(issueIds: string[]): Promise<Workspace>
  exportData(format: ExportFormat): Promise<string>
  importData(content: string, format: ExportFormat): Promise<Workspace>
}
