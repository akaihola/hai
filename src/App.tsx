import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpFromLine, Blocks, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleDashed, CircleDot, CircleHelp, Code2, Database, FileText, Folder, GitBranch, GripVertical, Inbox, LayoutGrid, List, Rows3 as LayersIcon, LoaderCircle, Menu, MoreHorizontal, Plus, RefreshCw, Search, Settings2, SignalHigh, SignalLow, SignalMedium, SlidersHorizontal, Sparkles, SquarePen, TriangleAlert, UserRound, X, XCircle, type LucideIcon } from 'lucide-react'
import { STATUSES, PRIORITIES, TASK_SECTIONS, type TaskSection, type Issue, type IssueInput, type IssueStatus, type Workspace, type WorkspaceBackend, type Member, type Cycle } from './domain'
import { tasksBackend } from './adapters/tasks'
import { BACKENDS } from './adapters/catalog'
import { Dialog } from './components/Dialog'
import { IssueEditor } from './components/IssueEditor'
import { ProjectPicker } from './components/ProjectPicker'

type Route = 'issues' | 'my' | 'projects' | 'cycles' | 'inbox' | 'integrations'
type Tab = 'all' | 'active' | 'backlog' | 'completed' | 'accepted'
type IssueGroup = { id: string; label: string; status: IssueStatus; sourceSection?: TaskSection }
const emptyWorkspace: Workspace = { currentMemberId: null, issues: [], projects: [], cycles: [], members: [] }
const emptyFilters = { status: '', priority: '', assignee: '', project: '', hideAccepted: false }
const statusOrder: IssueStatus[] = ['in_progress', 'in_review', 'todo', 'backlog', 'done', 'canceled']
const statusIcons: Record<IssueStatus, LucideIcon> = { backlog: CircleDashed, todo: Circle, in_progress: CircleDot, in_review: CircleDot, done: CheckCircle2, canceled: XCircle }
const parseDate = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
const date = (value: string) => Date.parse(value) === 0 ? 'Not recorded' : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parseDate(value))
const isCurrentCycle = (cycle: Cycle) => Date.now() >= parseDate(cycle.startsAt).getTime() && Date.now() <= new Date(/^\d{4}-\d{2}-\d{2}$/.test(cycle.endsAt) ? `${cycle.endsAt}T23:59:59.999` : cycle.endsAt).getTime()
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
function readView(): 'list' | 'board' { try { return localStorage.getItem('hai:view') === 'board' ? 'board' : 'list' } catch { return 'list' } }
function StatusIcon({ status, label }: { status: IssueStatus; label?: string }) { const Icon = statusIcons[status]; return <Icon size={15} className={`status-icon status-${status.replaceAll('_', '-')}`} style={{ color: STATUSES.find(item => item.id === status)?.color }} aria-label={label ?? STATUSES.find(item => item.id === status)?.label} /> }
function PriorityIcon({ priority }: { priority: Issue['priority'] }) { const Icon = priority === 'urgent' ? TriangleAlert : priority === 'high' ? SignalHigh : priority === 'medium' ? SignalMedium : priority === 'low' ? SignalLow : MoreHorizontal; return <Icon size={15} className={`priority-icon priority-${priority}`} aria-label={`${PRIORITIES.find(item => item.id === priority)?.label} priority`} /> }
function Avatar({ member, small = false }: { member?: Member; small?: boolean }) { return member ? <span className={`avatar${small ? ' small' : ''}`} style={{ backgroundColor: member.color }} title={member.name} aria-label={member.name}>{member.initials}</span> : <span className={`avatar unassigned${small ? ' small' : ''}`} title="Unassigned"><UserRound size={12} /></span> }
function IssueRow({ issue, workspace, showAssignee = true, onOpen }: { issue: Issue; workspace: Workspace; showAssignee?: boolean; onOpen: () => void }) {
  const project = workspace.projects.find(item => item.id === issue.projectId)
  return <button className="issue-row" onClick={onOpen}>
    <PriorityIcon priority={issue.priority} /><span className="issue-id">{issue.sourceReference ?? issue.identifier}</span><StatusIcon status={issue.status} label={issue.sourceSection} /><span className="issue-title">{issue.title}</span>
    <span className="issue-labels">{issue.sourceSection === 'Completed / Accepted' && <span className={`chip acceptance-${issue.accepted ? 'accepted' : 'pending'}`}>{issue.accepted ? 'Accepted' : 'Awaiting acceptance'}</span>}{issue.labels.slice(0, 2).map(label => <span className={`chip label-${label.toLowerCase().replace(/[^a-z]/g, '')}`} key={label}><span className="label-dot" />{label}</span>)}</span>
    <span className="issue-meta">{project && <span className="project-label"><span className="project-dot" style={{ background: project.color }} />{project.name}</span>}{showAssignee && <Avatar member={workspace.members.find(member => member.id === issue.assigneeId)} small />}</span>
  </button>
}

export default function App({ backend = tasksBackend }: { backend?: WorkspaceBackend }) {
  const [opened, setOpened] = useState<{ base: WorkspaceBackend; backend: WorkspaceBackend } | null>(null)
  return <WorkspaceView backend={opened?.base === backend ? opened.backend : backend} onOpened={next => setOpened({ base: backend, backend: next })} />
}

function WorkspaceView({ backend, onOpened }: { backend: WorkspaceBackend; onOpened: (backend: WorkspaceBackend) => void }) {
  const tasks = backend.capabilities.workflow === 'tasks'
  const fields = backend.capabilities.fields
  const groups: IssueGroup[] = tasks ? TASK_SECTIONS.flatMap(section => (section.id === 'Completed / Accepted' ? ['Completed', 'Accepted'] : [section.id]).map(id => ({ id, label: id, status: section.status, sourceSection: section.id }))) : statusOrder.map(status => ({ id: status, label: STATUSES.find(item => item.id === status)!.label, status }))
  const boardGroups: IssueGroup[] = tasks ? groups : STATUSES.map(status => ({ id: status.id, label: status.label, status: status.id }))
  const groupId = (issue: Issue) => tasks ? issue.sourceSection === 'Completed / Accepted' ? issue.accepted ? 'Accepted' : 'Completed' : issue.sourceSection : issue.status
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [route, setRoute] = useState<Route>('issues')
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedCycle, setSelectedCycle] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [view, setView] = useState(readView)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [editor, setEditor] = useState<{ issue?: Issue; initial?: Partial<IssueInput> } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [filters, setFilters] = useState(emptyFilters)
  const [sort, setSort] = useState(tasks ? 'source' : 'identifier')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [dragOver, setDragOver] = useState('')
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const draggedIssue = useRef('')
  const [mutating, setMutating] = useState(false)
  const [pendingImport, setPendingImport] = useState<{ name: string; content: string } | null>(null)
  const [importError, setImportError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const activeBackend = useRef(backend)
  activeBackend.current = backend
  const currentMember = workspace.members.find(member => member.id === workspace.currentMemberId)
  const project = workspace.projects.find(item => item.id === selectedProject)
  const currentCycle = workspace.cycles.find(isCurrentCycle)
  const cycle = workspace.cycles.find(item => item.id === selectedCycle) ?? currentCycle ?? workspace.cycles[0]
  const canCreate = backend.capabilities.canCreate
  const canReorder = tasks && backend.capabilities.canReorderBacklog && !!backend.reorderBacklog && sort === 'source'
  const filterCount = Object.values(filters).filter(Boolean).length

  async function refresh() { const result = await backend.load(); if (activeBackend.current === backend) setWorkspace(result); return result }
  async function load() {
    setLoading(true); setLoadError(''); setError('')
    try { await refresh() } catch (failure) { if (activeBackend.current === backend) setLoadError(errorMessage(failure)) } finally { if (activeBackend.current === backend) setLoading(false) }
  }
  useEffect(() => { let cancelled = false; endDrag(); setTab('all'); setSearchOpen(false); setQuery(''); setCollapsed([]); setProjectPickerOpen(false); setMutating(false); setSort(backend.capabilities.workflow === 'tasks' ? 'source' : 'identifier'); setEditor(null); setPendingImport(null); setSelectedProject(''); setSelectedCycle(''); setFilters(emptyFilters); setWorkspace(emptyWorkspace); setError(''); setNotice(''); setLoading(true); setLoadError(''); backend.load().then(data => { if (!cancelled) setWorkspace(data) }).catch(failure => { if (!cancelled) setLoadError(errorMessage(failure)) }).finally(() => { if (!cancelled) setLoading(false) }); return () => { cancelled = true } }, [backend])
  useEffect(() => { try { localStorage.setItem('hai:view', view) } catch { /* View preference is optional. */ } }, [view])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer) }, [notice])
  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.activeElement as HTMLElement | null
    const controls = () => [...(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [])]
    controls()[0]?.focus()
    function trapFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') { setMobileOpen(false); return }
      if (event.key !== 'Tab') return
      const items = controls(), first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trapFocus)
    return () => { document.removeEventListener('keydown', trapFocus); previous?.focus() }
  }, [mobileOpen])
  function newIssue(status: IssueStatus = tasks ? 'backlog' : 'todo', sourceSection?: TaskSection) { if (!canCreate || loading || loadError) return; setMobileOpen(false); setEditor({ initial: { status, ...(tasks ? { sourceSection: sourceSection ?? 'Unverified proposals' } : {}), ...(selectedProject ? { projectId: selectedProject } : {}), ...(route === 'cycles' && cycle ? { cycleId: cycle.id } : {}), ...(route === 'my' && currentMember ? { assigneeId: currentMember.id } : {}) } }) }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('dialog[open]')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setQuery(''); setSearchOpen(true) }
      if (event.key.toLowerCase() === 'c' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); newIssue() }
      if (event.key === '?') setShortcutsOpen(true)
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  })
  function navigate(next: Route, projectId = '') { setRoute(next); setSelectedProject(projectId); setTab('all'); setFilters(emptyFilters); setMobileOpen(false) }
  async function saved(message: string) {
    if (activeBackend.current !== backend) return
    setEditor(null); setNotice(message)
    try { await refresh() } catch (failure) { if (activeBackend.current === backend) setError(`${message}, but the workspace could not refresh. ${errorMessage(failure)}`) }
  }
  async function moveIssue(event: DragEvent, status: IssueStatus, sourceSection?: TaskSection) {
    event.preventDefault()
    const id = draggedIssue.current
    endDrag()
    if (!backend.capabilities.canUpdate || mutating) return
    const issue = workspace.issues.find(item => item.id === id)
    if (!issue || issue.accepted || (tasks ? issue.sourceSection === sourceSection : issue.status === status)) return
    setMutating(true); setError('')
    try { await backend.updateIssue(id, { status, ...(sourceSection ? { sourceSection } : {}) }); await refresh(); if (activeBackend.current !== backend) return; setNotice(`${issue.identifier} moved to ${sourceSection ?? STATUSES.find(item => item.id === status)?.label}`) }
    catch (failure) { if (activeBackend.current === backend) setError(errorMessage(failure)) } finally { if (activeBackend.current === backend) setMutating(false) }
  }
  const canDrag = (issue: Issue) => (backend.capabilities.canUpdate || !!canReorder && issue.sourceSection === 'Ordered backlog') && !mutating && !issue.accepted
  function startDrag(event: DragEvent, issue: Issue) {
    if (!canDrag(issue)) { event.preventDefault(); return }
    draggedIssue.current = issue.id
    event.dataTransfer.setData('text/plain', issue.id)
    event.dataTransfer.effectAllowed = 'move'
  }
  function endDrag() { draggedIssue.current = ''; setDropTarget(null); setDragOver('') }
  function groupHandlers({ id, status, sourceSection }: IssueGroup) {
    if (tasks && id === 'Accepted') return {}
    return {
      onDragOver(event: DragEvent<HTMLElement>) {
        const issue = workspace.issues.find(item => item.id === draggedIssue.current)
        if (!backend.capabilities.canUpdate || mutating || !issue || issue.accepted || groupId(issue) === id) return
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(null); setDragOver(id)
      },
      onDragLeave(event: DragEvent<HTMLElement>) { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver('') },
      onDrop(event: DragEvent<HTMLElement>) { void moveIssue(event, status, sourceSection) },
    }
  }
  async function reorderIssue(id: string, targetId: string, position: 'before' | 'after') {
    if (!canReorder || !backend.reorderBacklog || mutating || id === targetId) return
    const previous = workspace.issues.filter(issue => issue.sourceSection === 'Ordered backlog').map(issue => issue.id)
    if (!previous.includes(id) || !previous.includes(targetId)) return
    const next = previous.filter(value => value !== id)
    next.splice(next.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id)
    if (next.every((value, index) => value === previous[index])) return
    setMutating(true); setError('')
    try {
      const result = await backend.reorderBacklog(next)
      if (activeBackend.current !== backend) return
      setWorkspace(result); setNotice('Backlog order saved')
    } catch (failure) { if (activeBackend.current === backend) setError(errorMessage(failure)) }
    finally { if (activeBackend.current === backend) setMutating(false) }
  }
  function reorderHandlers(issue: Issue) {
    if (!canReorder || issue.sourceSection !== 'Ordered backlog') return {}
    const acceptsDrop = () => !mutating && workspace.issues.some(item => item.id === draggedIssue.current && item.sourceSection === 'Ordered backlog')
    const position = (event: DragEvent<HTMLElement>): 'before' | 'after' => {
      const { top, height } = event.currentTarget.getBoundingClientRect()
      return event.clientY < top + height / 2 ? 'before' : 'after'
    }
    return {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!acceptsDrop()) return
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDragOver('')
        setDropTarget(issue.id === draggedIssue.current ? null : { id: issue.id, position: position(event) })
      },
      onDragLeave(event: DragEvent<HTMLElement>) { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null) },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!acceptsDrop()) return
        event.preventDefault(); event.stopPropagation()
        const id = draggedIssue.current
        endDrag(); void reorderIssue(id, issue.id, position(event))
      },
      onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const backlog = visibleIssues.filter(item => item.sourceSection === 'Ordered backlog')
        const target = backlog[backlog.findIndex(item => item.id === issue.id) + (event.key === 'ArrowUp' ? -1 : 1)]
        if (target) void reorderIssue(issue.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
      },
    }
  }
  const dropClass = (issue: Issue) => dropTarget?.id === issue.id ? ` drop-${dropTarget.position}` : ''
  const visibleIssues = useMemo(() => {
    const priorityOrder = PRIORITIES.map(item => item.id)
    return workspace.issues.filter(issue => (!selectedProject || issue.projectId === selectedProject)
      && (route !== 'my' || issue.assigneeId === currentMember?.id)
      && (route !== 'cycles' || issue.cycleId === cycle?.id)
      && (tab !== 'active' || ['todo', 'in_progress', 'in_review'].includes(issue.status))
      && (tab !== 'backlog' || issue.status === 'backlog')
      && (tab !== 'completed' || issue.status === 'done' && (!tasks || !issue.accepted))
      && (tab !== 'accepted' || tasks && issue.accepted)
      && (!tasks || !filters.hideAccepted || !issue.accepted)
      && (!filters.status || groupId(issue) === filters.status)
      && (!filters.priority || issue.priority === filters.priority)
      && (!filters.assignee || (filters.assignee === 'unassigned' ? !issue.assigneeId : issue.assigneeId === filters.assignee))
      && (!filters.project || issue.projectId === filters.project))
      .sort((a, b) => sort === 'source' ? 0 : sort === 'priority' ? priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority) : sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : a.identifier.localeCompare(b.identifier, undefined, { numeric: true }))
  }, [workspace, selectedProject, route, currentMember?.id, cycle?.id, tab, filters, sort, tasks])
  const showGroup = (id: string) => (!tasks || id !== 'Accepted' || !filters.hideAccepted) && (!filters.status || id === filters.status) && (tab === 'all' || visibleIssues.some(issue => groupId(issue) === id))
  const results = useMemo(() => { const value = query.trim().toLowerCase(); return workspace.issues.filter(issue => !value || `${issue.identifier} ${issue.title} ${issue.description} ${issue.labels.join(' ')}`.toLowerCase().includes(value)).slice(0, 30) }, [workspace.issues, query])
  const recentIssues = useMemo(() => [...workspace.issues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20), [workspace.issues])
  const isIssues = route === 'issues' || route === 'my' || route === 'cycles'
  const title = project?.name ?? ({ issues: 'All issues', my: 'My issues', projects: 'Projects', cycles: 'Cycles', inbox: 'Inbox', integrations: 'Integrations' }[route])
  const titleIcon = route === 'projects' || project ? Folder : route === 'my' ? UserRound : route === 'cycles' ? CircleDashed : route === 'inbox' ? Inbox : route === 'integrations' ? Blocks : LayersIcon
  const TitleIcon = titleIcon
  function navItem(label: string, Icon: LucideIcon, next: Route, count?: number) { return <button className={`nav-item ${route === next && !selectedProject ? 'active' : ''}`} onClick={() => navigate(next)}><Icon size={16} /><span>{label}</span>{count !== undefined && <span className="nav-count">{count}</span>}</button> }
  async function exportData(format: 'json' | 'tasks') {
    setError(''); setMutating(true)
    try { const content = await backend.exportData(format); const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' })); const link = document.createElement('a'); link.href = url; link.download = format === 'json' ? 'hai-workspace.json' : 'TASKS.md'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Workspace exported') }
    catch (failure) { if (activeBackend.current === backend) setError(errorMessage(failure)) } finally { if (activeBackend.current === backend) setMutating(false) }
  }
  async function importData() {
    if (!backend.capabilities.canImport || !pendingImport || mutating) return
    setMutating(true); setImportError('')
    try { const data = await backend.importData(pendingImport.content, 'json'); if (activeBackend.current !== backend) return; setWorkspace(data); setPendingImport(null); setSelectedProject(''); setSelectedCycle(''); setNotice('Workspace imported') }
    catch (failure) { if (activeBackend.current === backend) setImportError(errorMessage(failure)) } finally { if (activeBackend.current === backend) setMutating(false) }
  }

  return <div className="app-shell">
    {mobileOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebarRef} id="main-sidebar" aria-label="Workspace navigation" className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="workspace-menu"><div className="brand"><span className="brand-mark">h</span><span>Hai</span><span className="workspace-plan">Workspace</span></div><button className="icon-button" aria-label="Workspace settings" onClick={() => navigate('integrations')}><ChevronDown size={14} /></button></div>
      {backend.capabilities.canOpenWorkspace && backend.openWorkspace && <button className="project-switcher" aria-label="Open project" title={backend.source?.path} disabled={loading || mutating} onClick={() => { setMobileOpen(false); setProjectPickerOpen(true) }}><Folder size={15} /><span>{backend.source?.name ?? 'Open project'}<small>{backend.source ? 'Switch project' : 'Choose a TASKS.md folder'}</small></span><ChevronDown size={13} /></button>}
      <div className="sidebar-actions"><button className="sidebar-search" onClick={() => { setQuery(''); setSearchOpen(true); setMobileOpen(false) }}><Search size={15} /><span>Search</span><kbd>⌘ K</kbd></button><button className="icon-button create-issue-button" aria-label="Create new issue" disabled={!canCreate || loading} onClick={() => newIssue()}><SquarePen size={17} /></button></div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {!tasks && navItem('Inbox', Inbox, 'inbox')}{fields?.assignee !== false && navItem('My issues', CircleDot, 'my', workspace.issues.filter(issue => issue.assigneeId === currentMember?.id && !['done', 'canceled'].includes(issue.status)).length)}
        <div className="sidebar-label">Workspace</div>
        {navItem('All issues', LayersIcon, 'issues')}{fields?.project !== false && navItem('Projects', Folder, 'projects')}{fields?.cycle !== false && navItem('Cycles', CircleDashed, 'cycles')}
        {fields?.project !== false && <div className="sidebar-label">Favorites<span className="sidebar-label-icon"><Sparkles size={11} /></span></div>}
        {workspace.projects.slice(0, 2).map(item => <button key={item.id} className={`nav-item ${selectedProject === item.id ? 'active' : ''}`} onClick={() => navigate('issues', item.id)}><span className="project-icon" style={{ color: item.color }}><Folder size={15} /></span><span>{item.name}</span></button>)}
        {!tasks && <><div className="sidebar-label">Your teams</div>
        <div className="team-heading"><span className="team-icon">H</span><span>Hai product</span><ChevronDown size={13} /></div>
        <div className="team-nav"><button className="nav-item" onClick={() => navigate('issues')}><LayersIcon size={15} /><span>Issues</span></button><button className="nav-item" onClick={() => { navigate('cycles'); setSelectedCycle(currentCycle?.id ?? workspace.cycles[0]?.id ?? '') }}><CircleDashed size={15} /><span>Current cycle</span></button></div></>}
      </nav>
      <div className="sidebar-footer"><div className="workspace-status"><span className="connection-dot" />{backend.capabilities.persistence === 'browser' ? 'Saved on this device' : backend.capabilities.name}</div>{navItem('Integrations', Blocks, 'integrations')}{fields?.assignee !== false && <button className="user-menu" onClick={() => navigate('my')}><Avatar member={currentMember} /><span>{currentMember?.name ?? 'Your workspace'}<small>Personal workspace</small></span><ChevronRight size={14} /></button>}</div>
    </aside>
    <main className="main-content" inert={mobileOpen}>
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="main-sidebar" onClick={() => setMobileOpen(true)}><Menu size={18} /></button><span className="breadcrumb-workspace" title={backend.source?.path}>{backend.source?.name ?? 'Hai workspace'}</span><ChevronRight size={12} /><span>{title}</span></div><div className="topbar-actions">{backend.capabilities.persistence !== 'browser' && <button className="button subtle refresh-source" aria-label="Refresh source" disabled={loading || mutating} onClick={() => void load()}><RefreshCw size={14} /><span>Refresh source</span></button>}<span className="local-badge"><span className="connection-dot" />{loadError ? 'Source unavailable' : backend.capabilities.persistence === 'browser' ? 'Local workspace' : backend.capabilities.name}</span><button className="icon-button" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><CircleHelp size={16} /></button>{fields?.assignee !== false && <Avatar member={currentMember} small />}</div></header>
      {error && <div className="error-banner" role="alert"><TriangleAlert size={16} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
      <div className="page-header"><div className="page-heading">{project && <button className="icon-button" aria-label="Back to projects" onClick={() => navigate('projects')}><ArrowLeft size={16} /></button>}<span className="page-icon"><TitleIcon size={20} /></span><h1>{title}</h1>{isIssues && <span className="count-badge">{visibleIssues.length}</span>}</div>{project && <p className="page-description">{project.description}</p>}
        {isIssues ? <div className="page-tabs" role="tablist" aria-label="Issue scope">{([['all', 'All issues'], ['active', 'Active'], ['backlog', 'Backlog'], ['completed', 'Completed'], ...(tasks ? [['accepted', 'Accepted'] as const] : [])] as const).map(([id, label]) => <button role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}</button>)}</div> : <p className="page-description">{route === 'projects' ? 'A shared view of what you’re building.' : route === 'inbox' ? 'Recent issue activity across your workspace.' : 'Your workspace, connected your way.'}</p>}
      </div>
      <div className="page-content">
      {loading ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={22} /><p>Loading your workspace…</p></div> : loadError ? <div className="error-state" role="alert"><TriangleAlert size={28} /><h2>Couldn’t open your workspace</h2><p>{loadError}</p><button className="button primary" onClick={load}>Try again</button></div> : <>
        {route === 'cycles' && <div className="cycle-strip">{workspace.cycles.map(item => { const issues = workspace.issues.filter(issue => issue.cycleId === item.id); const done = issues.filter(issue => issue.status === 'done').length; const current = isCurrentCycle(item); return <button key={item.id} className={`cycle-card ${cycle?.id === item.id ? 'selected' : ''}`} onClick={() => setSelectedCycle(item.id)}><div><CircleDashed size={16} /><strong>{item.name}</strong>{current && <span className="badge accent">Current</span>}</div><span className="muted">{date(item.startsAt)} – {date(item.endsAt)}</span><div className="cycle-progress"><span className="progress-track"><span style={{ width: `${issues.length ? done / issues.length * 100 : 0}%` }} /></span><span>{done}/{issues.length}</span></div></button> })}</div>}
        {isIssues && <><div className="toolbar"><div className="toolbar-left"><details className="filter-menu"><summary className={`button subtle ${filterCount ? 'filter-active' : ''}`}><SlidersHorizontal size={14} />Filter{filterCount > 0 && <span className="count-badge">{filterCount}</span>}</summary><div className="popover"><div className="popover-heading">Filter issues{filterCount > 0 && <button className="text-button" onClick={() => setFilters(emptyFilters)}>Clear</button>}</div><label className="field">{tasks ? 'Section' : 'Status'}<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">{tasks ? 'All sections' : 'All statuses'}</option>{groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="field">Priority<select value={filters.priority} onChange={event => setFilters({ ...filters, priority: event.target.value })}><option value="">All priorities</option>{PRIORITIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{tasks && <label className="checkbox-field"><input type="checkbox" checked={filters.hideAccepted} onChange={event => setFilters({ ...filters, hideAccepted: event.target.checked })} />Hide accepted</label>}{fields?.assignee !== false && <label className="field">Assignee<select value={filters.assignee} onChange={event => setFilters({ ...filters, assignee: event.target.value })}><option value="">Anyone</option><option value="unassigned">Unassigned</option>{workspace.members.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{fields?.project !== false && <label className="field">Project<select value={filters.project} onChange={event => setFilters({ ...filters, project: event.target.value })}><option value="">All projects</option>{workspace.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div></details><span className="toolbar-divider" /><span className="issue-total">{visibleIssues.length} issues</span>{filterCount > 0 && <button className="text-button" onClick={() => setFilters(emptyFilters)}>Clear filters<X size={11} /></button>}</div><div className="toolbar-right"><div className="view-switch" aria-label="Issue layout"><button className={view === 'list' ? 'active' : ''} aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={15} /></button><button className={view === 'board' ? 'active' : ''} aria-label="Board view" aria-pressed={view === 'board'} onClick={() => setView('board')}><LayoutGrid size={14} /></button></div><details className="display-menu"><summary className="button subtle" aria-label="Display options"><Settings2 size={14} /><span>Display</span></summary><div className="popover"><label className="field">Order by<select value={sort} onChange={event => setSort(event.target.value)}>{tasks && <option value="source">Source order</option>}<option value="identifier">Issue number</option><option value="priority">Priority</option>{!tasks && <option value="updated">Last updated</option>}</select></label><p className="muted">Issues are grouped by {tasks ? 'source section and acceptance' : 'status'}.</p>{tasks && backend.capabilities.canReorderBacklog && <p className="muted">Use Source order to reorder the backlog.</p>}</div></details><button className="button primary new-issue-button" aria-label="New issue" disabled={!canCreate} onClick={() => newIssue()}><Plus size={14} /><span>New issue</span><kbd>C</kbd></button></div></div>
          {!visibleIssues.length ? <div className="empty-state"><CheckCheck size={35} /><h2>{route === 'my' && !currentMember ? 'No current member selected' : filterCount ? 'No matching issues' : tab === 'completed' ? 'No completed issues yet' : tab === 'accepted' ? 'No accepted issues yet' : 'A little room to focus'}</h2><p>{route === 'my' && !currentMember ? 'This workspace backend has not supplied a current member.' : filterCount ? 'Try another filter to find what you’re looking for.' : 'Create an issue to start moving work forward.'}</p>{filterCount ? <button className="button" onClick={() => setFilters(emptyFilters)}>Clear filters</button> : canCreate && <button className="button primary" onClick={() => newIssue()}><Plus size={14} />Create issue</button>}</div> : view === 'list' ? <div className="issue-list">{groups.filter(item => showGroup(item.id)).map(item => { const status = item.id; const issues = visibleIssues.filter(issue => groupId(issue) === status); return (issues.length > 0 || backend.capabilities.canUpdate && !filters.status) && <section className={`issue-group${dragOver === status ? ' drag-over' : ''}`} key={status} aria-label={`${item.label} group`} {...groupHandlers(item)}><div className="group-heading"><button className="group-toggle" aria-expanded={!collapsed.includes(status)} onClick={() => setCollapsed(previous => previous.includes(status) ? previous.filter(value => value !== status) : [...previous, status])}><ChevronDown size={13} className={collapsed.includes(status) ? 'collapsed' : ''} /><StatusIcon status={item.status} label={item.label} /><span>{item.label}</span><span className="group-count">{issues.length}</span></button>{canReorder && status === 'Ordered backlog' && <span className="reorder-hint">Drag to reorder</span>}{!(tasks && status === 'Accepted') && <button className="icon-button group-add" aria-label={`Add issue to ${item.label}`} disabled={!canCreate} onClick={() => newIssue(item.status, item.sourceSection)}><Plus size={14} /></button>}</div>{!collapsed.includes(status) && issues.map(issue => <div key={issue.id} className={`draggable-issue${canReorder && status === 'Ordered backlog' ? ' reorderable-issue' : ''}${dropClass(issue)}`} draggable={canDrag(issue)} onDragStart={event => startDrag(event, issue)} onDragEnd={endDrag} {...reorderHandlers(issue)}>{canReorder && status === 'Ordered backlog' && <button className="icon-button reorder-handle" aria-label={`Reorder ${issue.title}`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" aria-disabled={mutating} title="Drag to reorder, or press Alt+Up / Alt+Down"><GripVertical size={14} /></button>}<IssueRow issue={issue} workspace={workspace} showAssignee={fields?.assignee !== false} onOpen={() => setEditor({ issue })} /></div>)}</section> })}</div> : <div className="board-wrapper"><p className="board-hint">Drag issues between columns{canReorder ? ' or to reorder the backlog' : ''}, or open an issue to change its status.</p><div className="board">{boardGroups.filter(status => showGroup(status.id) && (status.id !== 'canceled' || visibleIssues.some(issue => issue.status === 'canceled'))).map(status => { const issues = visibleIssues.filter(issue => groupId(issue) === status.id); return <section key={status.id} className={`board-column ${dragOver === status.id ? 'drag-over' : ''}`} aria-label={`${status.label} column`} {...groupHandlers(status)}><div className="board-header"><StatusIcon status={status.status} label={status.label} /><strong>{status.label}</strong><span className="group-count">{issues.length}</span>{!(tasks && status.id === 'Accepted') && <button className="icon-button" aria-label={`Add issue to ${status.label}`} disabled={!canCreate} onClick={() => newIssue(status.status, status.sourceSection)}><Plus size={14} /></button>}</div>{issues.map(issue => <button key={issue.id} className={`issue-card${dropClass(issue)}`} draggable={canDrag(issue)} onDragStart={event => startDrag(event, issue)} onDragEnd={endDrag} {...reorderHandlers(issue)} aria-keyshortcuts={canReorder && issue.sourceSection === 'Ordered backlog' ? 'Alt+ArrowUp Alt+ArrowDown' : undefined} title={canReorder && issue.sourceSection === 'Ordered backlog' ? 'Drag to reorder, or press Alt+Up / Alt+Down' : undefined} onClick={() => setEditor({ issue })}><span className="card-top">{canReorder && issue.sourceSection === 'Ordered backlog' && <GripVertical className="card-grip" size={14} aria-hidden="true" />}<span className="issue-id">{issue.sourceReference ?? issue.identifier}</span><PriorityIcon priority={issue.priority} /></span><strong>{issue.title}</strong><span className="card-labels">{tasks && issue.status === 'done' && <span className={`chip acceptance-${issue.accepted ? 'accepted' : 'pending'}`}>{issue.accepted ? 'Accepted' : 'Awaiting acceptance'}</span>}{issue.labels.map(label => <span className="chip" key={label}><span className="label-dot" />{label}</span>)}</span><span className="card-bottom"><span className="project-label">{workspace.projects.find(item => item.id === issue.projectId)?.name}</span>{fields?.assignee !== false && <Avatar member={workspace.members.find(member => member.id === issue.assigneeId)} small />}</span></button>)}</section> })}</div></div>}
          <footer className="list-footer"><span>{visibleIssues.length} issues</span><span>{view === 'list' && backend.capabilities.canUpdate ? 'Drag between groups or open an issue' : 'Open an issue to see the details'}<span className="footer-dot">·</span><kbd>C</kbd> to create</span></footer>
        </>}
        {route === 'projects' && <div className="projects-page"><div className="section-heading"><h2>All projects <span className="count-badge">{workspace.projects.length}</span></h2><span className="muted">Progress from completed issues</span></div><div className="projects-grid">{workspace.projects.map(item => { const issues = workspace.issues.filter(issue => issue.projectId === item.id); const completed = issues.filter(issue => issue.status === 'done').length; const percentage = issues.length ? Math.round(completed / issues.length * 100) : 0; return <button className="project-card" key={item.id} onClick={() => navigate('issues', item.id)}><div className="project-card-header"><span className="project-card-icon" style={{ color: item.color, background: `${item.color}18` }}><Folder size={21} /></span><span className={`badge ${item.status === 'in_progress' ? 'accent' : ''}`}>{item.status === 'in_progress' ? 'In progress' : item.status === 'completed' ? 'Completed' : 'Planned'}</span><ArrowRight size={15} /></div><h2>{item.name}</h2><p>{item.description}</p><div className="project-progress-label"><span>{completed} of {issues.length} issues completed</span><strong>{percentage}%</strong></div><div className="progress-track"><span style={{ width: `${percentage}%`, background: item.color }} /></div><div className="project-card-footer"><span><CalendarDays size={13} />{item.targetDate ? date(item.targetDate) : 'No target date'}</span><div className="avatar-group">{workspace.members.filter(member => issues.some(issue => issue.assigneeId === member.id)).slice(0, 3).map(member => <Avatar member={member} small key={member.id} />)}</div></div></button> })}</div>{!workspace.projects.length && <div className="empty-state"><Folder size={32} /><h2>No projects in this workspace</h2><p>Your projects appear here when supplied by your workspace backend.</p></div>}<div className="projects-note"><Folder size={16} /><span>Keep the big picture in view. Open a project to explore its issues.</span></div></div>}
        {route === 'inbox' && <div className="inbox-page"><div className="section-heading"><h2>Latest activity</h2><span className="muted">Sorted by last update</span></div>{recentIssues.length ? <div className="activity-list">{recentIssues.map(issue => <button className="activity-item" key={issue.id} onClick={() => setEditor({ issue })}><span className="activity-icon"><StatusIcon status={issue.status} /></span><div className="activity-content"><div><span className="issue-id">{issue.sourceReference ?? issue.identifier}</span><span className="activity-date">{date(issue.updatedAt)}</span></div><strong>{issue.title}</strong><p>{STATUSES.find(status => status.id === issue.status)?.label}<span className="footer-dot">·</span>{workspace.members.find(member => member.id === issue.assigneeId)?.name ?? 'Unassigned'}<span className="footer-dot">·</span>{issue.createdAt === issue.updatedAt ? 'Created' : 'Updated'}</p></div><ChevronRight size={15} /></button>)}</div> : <div className="empty-state"><Inbox size={32} /><h2>You’re all caught up</h2><p>Issue activity will appear here as your workspace grows.</p></div>}</div>}
        {route === 'integrations' && <div className="integrations-page"><div className="settings-section-heading"><h2>Workspace backend</h2><p>Your issue data is stored by the selected backend.</p></div><div className="settings-card connected-card"><span className="integration-icon local-icon"><Database size={23} /></span><div className="settings-card-content"><div className="integration-title"><h3>{backend.capabilities.name}</h3><span className="badge connected"><span className="connection-dot" />Active</span></div><p>{backend.capabilities.description}</p><small>{backend.capabilities.persistence === 'browser' ? 'Data stays in this browser. Export a backup to keep a separate copy.' : `Storage: ${backend.capabilities.persistence}`}</small></div></div><div className="settings-section-heading"><h2>Import & export</h2><p>Take your work with you.</p></div><div className="settings-grid"><div className="settings-card"><span className="integration-icon"><FileText size={21} /></span><div className="settings-card-content"><h3>TASKS.md</h3><p>{tasks ? 'The original TASKS.md, including references, formatting, and workflow rules.' : 'A readable Markdown snapshot of your issues, grouped by status.'}</p><button className="button" disabled={!backend.capabilities.canExport || mutating} onClick={() => void exportData('tasks')}><ArrowDownToLine size={14} />Export TASKS.md</button></div></div><div className="settings-card"><span className="integration-icon"><Code2 size={21} /></span><div className="settings-card-content"><h3>Workspace backup</h3><p>{tasks ? 'Export a workspace snapshot. Update source files directly to import changes.' : 'Export your complete workspace, or restore a Hai JSON backup.'}</p><div className="settings-actions"><button className="button" disabled={!backend.capabilities.canExport || mutating} onClick={() => void exportData('json')}><ArrowDownToLine size={14} />Export JSON</button><button className="button" disabled={!backend.capabilities.canImport || mutating} onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={14} />Import JSON backup</button></div></div></div></div><input ref={fileInput} type="file" disabled={!backend.capabilities.canImport || mutating} accept="application/json,.json" className="visually-hidden" aria-label="Import JSON backup file" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 2 * 1024 * 1024) { setError('This file is too large. Choose a JSON backup smaller than 2 MB.'); return } try { const content = await file.text(); if (activeBackend.current !== backend) return; setPendingImport({ name: file.name, content }); setImportError('') } catch (failure) { setError(errorMessage(failure)) } }} /><div className="settings-section-heading"><h2>On the roadmap</h2><p>These backends are planned. Connection is not available yet.</p></div><div className="settings-grid planned-grid">{BACKENDS.filter(item => item.status === 'planned' && item.id !== backend.capabilities.id).map(item => <div className="settings-card planned-card" key={item.id}><span className="integration-icon">{item.id === 'github' ? <GitBranch size={22} /> : item.id === 'beans' ? <Blocks size={22} /> : <FileText size={22} />}</span><div className="settings-card-content"><div className="integration-title"><h3>{item.name}</h3><span className="badge">Planned</span></div><p>{item.description}</p>{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-button">Learn more<ArrowRight size={12} /></a>}</div></div>)}</div><p className="settings-footnote">Backends share one issue model. Available actions depend on the connected backend.</p></div>}
      </>}
      </div>
    </main>
    {projectPickerOpen && <ProjectPicker backend={backend} onClose={() => setProjectPickerOpen(false)} onOpened={next => { setRoute('issues'); onOpened(next) }} />}
    {editor && <IssueEditor issue={editor.issue} initial={editor.initial} workspace={workspace} backend={backend} onClose={() => setEditor(null)} onSaved={saved} />}
    {searchOpen && <Dialog title="Search workspace" onClose={() => setSearchOpen(false)} className="search-dialog"><div className="search-field"><Search size={19} /><input autoFocus aria-label="Search issues" placeholder="Search issues by title, ID, or label…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>esc</kbd></div><div className="search-results"><div className="search-heading">{query.trim() ? `${results.length}${results.length === 30 ? '+' : ''} matching issues` : 'Your issues'}</div>{results.map(issue => <button key={issue.id} className="search-result" onClick={() => { setSearchOpen(false); setEditor({ issue }) }}><StatusIcon status={issue.status} /><span className="issue-id">{issue.sourceReference ?? issue.identifier}</span><span>{issue.title}</span><ArrowRight size={13} /></button>)}{!results.length && <div className="empty-state"><Search size={26} /><h2>No issues found</h2><p>Try a different title, issue number, or label.</p></div>}</div><div className="search-footer"><span>Search across all projects</span><span><kbd>tab</kbd> navigate <kbd>enter</kbd> open</span></div></Dialog>}
    {shortcutsOpen && <Dialog title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)} className="shortcuts-dialog"><div className="modal-body shortcut-list"><div><span>Search issues</span><kbd>⌘ / Ctrl + K</kbd></div><div><span>Create an issue</span><kbd>C</kbd></div><div><span>Show keyboard shortcuts</span><kbd>?</kbd></div>{tasks && backend.capabilities.canReorderBacklog && <div><span>Reorder focused backlog issue in source order</span><kbd>Alt + ↑ / ↓</kbd></div>}<div><span>Close a dialog</span><kbd>Esc</kbd></div><p className="muted">Shortcuts pause while you’re typing in a field.</p></div></Dialog>}
    {pendingImport && <Dialog title="Restore workspace backup" onClose={() => { if (!mutating) setPendingImport(null) }}><div className="modal-body"><p>Import <strong>{pendingImport.name}</strong>?</p><p className="muted">This replaces all current issues, projects, cycles, and members. Export a JSON backup first if you want to keep them.</p>{importError && <p className="form-error" role="alert">{importError}</p>}</div><div className="modal-footer"><button className="button" disabled={mutating} onClick={() => setPendingImport(null)}>Cancel</button><button className="button primary" disabled={mutating} onClick={() => void importData()}>{mutating && <LoaderCircle className="spin" size={14} />}Replace workspace</button></div></Dialog>}
    {notice && <div className="toast" role="status"><Check size={15} />{notice}</div>}
  </div>
}
