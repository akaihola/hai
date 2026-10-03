import { useState, type FormEvent } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import type { Project, Cycle, WorkspaceBackend } from '../domain'
import { Dialog } from './Dialog'

type Entity = { kind: 'project'; item?: Project } | { kind: 'cycle'; item?: Cycle }
export function EntityEditor({ entity, backend, issueCount, onClose, onSaved }: { entity: Entity; backend: WorkspaceBackend; issueCount: number; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const { kind, item } = entity
  const project = entity.kind === 'project' ? entity.item : undefined
  const cycle = entity.kind === 'cycle' ? entity.item : undefined
  const [draft, setDraft] = useState({ name: item?.name ?? '', description: project?.description ?? '', color: project?.color ?? '#8b82e9', status: project?.status ?? 'planned', targetDate: project?.targetDate ?? '', startsAt: cycle?.startsAt ?? '', endsAt: cycle?.endsAt ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const capabilities = backend.capabilities
  const canSave = kind === 'project'
    ? item ? capabilities.canUpdateProject && !!backend.updateProject : capabilities.canCreateProject && !!backend.createProject
    : item ? capabilities.canUpdateCycle && !!backend.updateCycle : capabilities.canCreateCycle && !!backend.createCycle
  const canDelete = kind === 'project' ? capabilities.canDeleteProject && !!backend.deleteProject : capabilities.canDeleteCycle && !!backend.deleteCycle
  function change(key: keyof typeof draft, value: string) { setDraft(previous => ({ ...previous, [key]: value })) }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canSave || busy) return
    if (!draft.name.trim()) { setError(`Give this ${kind} a name.`); return }
    setBusy(true); setError('')
    try {
      if (kind === 'project') {
        const input = { name: draft.name.trim(), description: draft.description, color: draft.color, status: draft.status, targetDate: draft.targetDate || undefined }
        if (item) await backend.updateProject!(item.id, input)
        else await backend.createProject!(input)
      } else {
        const input = { name: draft.name.trim(), startsAt: draft.startsAt, endsAt: draft.endsAt }
        if (item) await backend.updateCycle!(item.id, input)
        else await backend.createCycle!(input)
      }
      await onSaved(`${kind === 'project' ? 'Project' : 'Cycle'} ${item ? 'updated' : 'created'}`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : `Unable to save this ${kind}.`) }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!item || !canDelete || busy) return
    setBusy(true); setError('')
    try {
      if (kind === 'project') await backend.deleteProject!(item.id)
      else await backend.deleteCycle!(item.id)
      await onSaved(`${kind === 'project' ? 'Project' : 'Cycle'} deleted`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : `Unable to delete this ${kind}.`) }
    finally { setBusy(false) }
  }
  function dateField(key: 'targetDate' | 'startsAt' | 'endsAt', label: string) {
    return <label className="field">{label}<input type={draft[key].includes('T') ? 'text' : 'date'} value={draft[key]} required={key !== 'targetDate'} disabled={busy || !canSave} onChange={event => change(key, event.target.value)} /></label>
  }
  return <Dialog title={`${deleting ? 'Delete' : item ? 'Edit' : 'New'} ${kind}`} onClose={() => { if (!busy) onClose() }} className="entity-dialog">
    {deleting ? <><div className="modal-body"><p>Delete <strong>{item?.name}</strong>?</p><p className="muted">{issueCount ? `${issueCount} linked ${issueCount === 1 ? 'issue will' : 'issues will'} lose this ${kind} assignment. ` : ''}Issues will be kept.</p>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button className="button" disabled={busy} onClick={() => { setDeleting(false); setError('') }}>Cancel</button><button className="button danger" disabled={busy} onClick={remove}>{busy && <LoaderCircle size={14} className="spin" />}Confirm delete</button></div></> : <form onSubmit={save}>
      <div className="modal-body">
        <label className="field">Name<input autoFocus required maxLength={500} value={draft.name} disabled={busy || !canSave} onChange={event => change('name', event.target.value)} /></label>
        {kind === 'project' ? <>
          <label className="field">Description<textarea rows={4} maxLength={50000} value={draft.description} disabled={busy || !canSave} onChange={event => change('description', event.target.value)} /></label>
          <div className="field-row"><label className="field">Status<select value={draft.status} disabled={busy || !canSave} onChange={event => change('status', event.target.value)}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label><label className="field">Color<input type="color" value={draft.color} disabled={busy || !canSave} onChange={event => change('color', event.target.value)} /></label></div>
          {dateField('targetDate', 'Target date')}
        </> : <><div className="field-row">{dateField('startsAt', 'Start date')}{dateField('endsAt', 'End date')}</div><p className="muted">A cycle is current during its date range, including its last day.</p></>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer">{item && canDelete && <button type="button" className="button danger subtle delete-button" disabled={busy} onClick={() => setDeleting(true)}><Trash2 size={14} />Delete {kind}</button>}<button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !canSave}>{busy && <LoaderCircle size={14} className="spin" />}{item ? 'Save changes' : `Create ${kind}`}</button></div>
    </form>}
  </Dialog>
}
