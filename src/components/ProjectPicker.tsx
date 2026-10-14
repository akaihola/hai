import { useEffect, useRef, useState } from 'react'
import { Check, Folder, LoaderCircle } from 'lucide-react'
import type { WorkspaceBackend, WorkspaceSource } from '../domain'
import { Dialog } from './Dialog'

function recentSources(source?: WorkspaceSource): WorkspaceSource[] {
  let recent: WorkspaceSource[] = []
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('hai:recent-projects') ?? '[]')
    if (Array.isArray(stored)) recent = stored.filter(item => item && typeof item.name === 'string' && typeof item.path === 'string')
  } catch { /* Recent projects are optional. */ }
  return [...(source ? [source] : []), ...recent.filter(item => item.path !== source?.path)].slice(0, 8)
}

export function ProjectPicker({ backend, onClose, onOpened }: { backend: WorkspaceBackend; onClose: () => void; onOpened: (backend: WorkspaceBackend) => void }) {
  const [path, setPath] = useState('')
  const [recent] = useState(() => [...new Map([...recentSources(backend.source), ...(backend.sources ?? [])].map(source => [source.path, source])).values()])
  const [available, setAvailable] = useState<WorkspaceSource[]>([])
  const [listing, setListing] = useState(!!backend.capabilities.canListWorkspaces && !!backend.listWorkspaces)
  const [listError, setListError] = useState('')
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { searchRef.current?.focus() }, [])
  useEffect(() => {
    if (!backend.capabilities.canListWorkspaces || !backend.listWorkspaces) return
    let active = true
    backend.listWorkspaces().then(sources => { if (active) setAvailable(sources) })
      .catch(failure => { if (active) setListError(failure instanceof Error ? failure.message : 'Could not list projects.') })
      .finally(() => { if (active) setListing(false) })
    return () => { active = false }
  }, [backend])
  const sources = [...new Map([...recent, ...available].map(source => [source.path, source])).values()]
  const filtered = sources.filter(source => `${source.name} ${source.path}`.toLowerCase().includes(query.trim().toLowerCase()))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function openProject(value: string) {
    if (pending || !backend.capabilities.canOpenWorkspace || !backend.openWorkspace) return
    setPending(true); setError('')
    try {
      const next = await backend.openWorkspace(value.trim())
      if (next.source) {
        try {
          localStorage.setItem('hai:tasks-source', next.source.path)
          localStorage.setItem('hai:recent-projects', JSON.stringify([next.source, ...recent.filter(item => item.path !== next.source!.path)].slice(0, 8)))
        } catch { /* Opening a project does not require browser storage. */ }
      }
      onOpened(next)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open this project.'); setPending(false) }
  }

  return <Dialog title="Open project" onClose={() => { if (!pending) onClose() }} className="project-picker">
    <form onSubmit={event => { event.preventDefault(); void openProject(path) }}>
      <div className="modal-body">
        <label className="field">Project path<input aria-label="Project path" value={path} onChange={event => setPath(event.target.value)} placeholder="~/prg/my-project/" disabled={pending} required aria-describedby="project-path-help" /><small id="project-path-help">Open a project folder, TASKS.md, .scratch/feature/issues, or docs/backlog on the Hai server.</small></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <label className="field">Find project<input ref={searchRef} aria-label="Find project" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter by name or path" disabled={pending} onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          if (filtered[0]) void openProject(filtered[0].path)
        }} /></label>
        {listing && <p role="status">Loading projects…</p>}
        {listError && <p className="form-error" role="alert">{listError} You can still open a project by path.</p>}
        {!listing && filtered.length === 0 && <p role="status">No matching projects.</p>}
        {filtered.length > 0 && <div className="recent-projects"><h3>{backend.capabilities.canListWorkspaces || backend.sources ? 'Available projects' : 'Recent projects'}</h3>{filtered.map((source, index) => <button type="button" key={source.path} disabled={pending} aria-label={`Open ${source.name}`} aria-describedby={`recent-project-${index}`} onClick={() => void openProject(source.path)}><Folder size={17} /><span><strong>{source.name}</strong><small id={`recent-project-${index}`}>{source.path}</small></span>{source.path === backend.source?.path && <Check size={15} aria-label="Current project" />}</button>)}</div>}
      </div>
      <div className="modal-footer"><button type="button" className="button" disabled={pending} onClick={onClose}>Cancel</button><button className="button primary" disabled={pending || !path.trim()}>{pending && <LoaderCircle className="spin" size={14} />}{pending ? 'Opening…' : 'Open project'}</button></div>
    </form>
  </Dialog>
}
