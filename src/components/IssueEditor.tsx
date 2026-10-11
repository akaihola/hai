import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, Trash2, X } from 'lucide-react'
import { ISSUE_TITLE_MAX_LENGTH, STATUSES, PRIORITIES, TASK_SECTIONS, type TaskSection, type Issue, type IssueInput, type Workspace, type WorkspaceBackend } from '../domain'
import { Dialog } from './Dialog'

export function IssueEditor({ issue, initial, workspace, backend, onClose, onSaved }: { issue?: Issue; initial?: Partial<IssueInput>; workspace: Workspace; backend: WorkspaceBackend; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const titleRef = useRef<HTMLInputElement>(null)
  const tasks = backend.capabilities.workflow === 'tasks'
  const states = backend.capabilities.sourceStates
  const fields = backend.capabilities.fields
  const [draft, setDraft] = useState<IssueInput>({ title: '', description: '', status: tasks ? 'backlog' : 'todo', ...(tasks ? { sourceSection: 'Unverified proposals' } : {}), priority: 'none', assigneeId: null, projectId: null, cycleId: null, labels: [], ...(states ? { sourceState: states[0].id, status: states[0].status } : {}), ...initial, ...issue })
  const [labels, setLabels] = useState<string[]>(issue?.labels ?? initial?.labels ?? [])
  const [labelDraft, setLabelDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { titleRef.current?.focus() }, [deleting])
  const canSave = issue ? backend.capabilities.canUpdate : backend.capabilities.canCreate
  const hasChanges = issue && (['title', 'description', 'status', 'priority', 'sourceSection', 'sourceState'] as const).some(key => draft[key] !== issue[key]) || JSON.stringify(labels) !== JSON.stringify(issue?.labels ?? []) || Boolean(labelDraft.trim())
  function change<K extends keyof IssueInput>(key: K, value: IssueInput[K]) { setDraft(previous => ({ ...previous, [key]: value })) }
  function addLabel() {
    const value = labelDraft.trim()
    if (value) setLabels(previous => [...new Set([...previous, value])])
    setLabelDraft('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canSave || busy) return
    const title = draft.title.trim()
    if (!title) { setError('Give this issue a title.'); return }
    setBusy(true); setError('')
    try {
      const { description, status, priority, assigneeId, projectId, cycleId, sourceSection, sourceState } = draft
      const input = { title, ...(fields?.description !== false ? { description } : {}), status, ...(fields?.priority !== false ? { priority } : {}), ...(states ? { sourceState } : {}), ...(fields?.assignee !== false ? { assigneeId } : {}), ...(fields?.project !== false ? { projectId } : {}), ...(fields?.cycle !== false ? { cycleId } : {}), ...(tasks ? { sourceSection } : {}), ...(fields?.labels !== false ? { labels: labelDraft.trim() ? [...new Set([...labels, labelDraft.trim()])] : labels } : {}) }
      if (issue) {
        const patch = tasks || states ? Object.fromEntries(Object.entries(input).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(issue[key as keyof Issue]))) : input
        if (Object.keys(patch).length) await backend.updateIssue(issue.id, patch)
      }
      else await backend.createIssue(input)
      await onSaved(issue ? 'Issue updated' : 'Issue created')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save this issue. Try again.') }
    finally { setBusy(false) }
  }
  async function accept() {
    if (!issue || issue.status !== 'done' || issue.accepted || !canSave || busy) return
    setBusy(true); setError('')
    try { await backend.updateIssue(issue.id, { accepted: true }); await onSaved('Completed work accepted') }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to accept this issue.') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!issue || busy || !backend.capabilities.canDelete) return
    setBusy(true); setError('')
    try { await backend.deleteIssue(issue.id); await onSaved('Issue deleted') }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to delete this issue. Try again.') }
    finally { setBusy(false) }
  }
  return <Dialog title={deleting ? 'Delete issue' : issue ? `Edit ${issue.sourceReference ?? issue.identifier}` : 'New issue'} onClose={() => { if (!busy) onClose() }} className="issue-dialog">
    {deleting ? <><div className="modal-body"><p>Delete <strong>{issue?.identifier}: {issue?.title}</strong>?</p><p className="muted">This issue will be permanently removed from this workspace.</p>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button className="button" disabled={busy} onClick={() => { setDeleting(false); setError('') }}>Cancel</button><button className="button danger" disabled={busy} onClick={remove}>{busy && <LoaderCircle size={14} className="spin" />}Confirm delete</button></div></> : <form onSubmit={save}>
      <div className="modal-body">
        {(tasks || states) && <div className="source-details"><span>{issue?.sourceReference ?? issue?.identifier ?? ''} · {issue?.sourcePath ?? (states ? backend.source?.path ?? '.scratch' : 'TASKS.md')}</span>{issue?.dependencies?.length ? <span>{states ? 'Blocked by' : 'Depends on'}: {issue.dependencies.join(', ')}</span> : null}</div>}
        <label className="field title-field">Title<input ref={titleRef} required maxLength={ISSUE_TITLE_MAX_LENGTH} placeholder="Issue title" value={draft.title} disabled={!canSave || busy} onChange={event => change('title', event.target.value)} /></label>
        <label className="field">Description<textarea rows={5} maxLength={50000} placeholder="Add a description…" value={draft.description ?? ''} disabled={!canSave || busy || fields?.description === false} onChange={event => change('description', event.target.value)} onKeyDown={event => {
          if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return
          event.preventDefault()
          if (!event.repeat && canSave && !busy) event.currentTarget.form?.requestSubmit()
        }} /></label>
        <div className="field-row">
          {states ? <label className="field">Status<select value={draft.sourceState} disabled={!canSave || busy} onChange={event => { const state = states.find(item => item.id === event.target.value)!; setDraft(previous => ({ ...previous, sourceState: state.id, status: state.status })) }}>{states.map(state => <option key={state.id}>{state.id}</option>)}</select></label> : tasks ? <label className="field">Section<select value={draft.sourceSection} disabled={!canSave || busy || issue?.accepted} onChange={event => { const sourceSection = event.target.value as TaskSection; setDraft(previous => ({ ...previous, sourceSection, status: TASK_SECTIONS.find(section => section.id === sourceSection)!.status })) }}>{TASK_SECTIONS.map(section => <option key={section.id}>{section.id}</option>)}</select></label> : <label className="field">Status<select value={draft.status} disabled={!canSave || busy} onChange={event => change('status', event.target.value as IssueInput['status'])}>{STATUSES.map(status => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label>}
          {fields?.priority !== false && <label className="field">Priority<select value={draft.priority} disabled={!canSave || busy} onChange={event => change('priority', event.target.value as IssueInput['priority'])}>{PRIORITIES.map(priority => <option key={priority.id} value={priority.id}>{priority.label}</option>)}</select></label>}
        </div>
        {(fields?.assignee !== false || fields?.project !== false) && <div className="field-row">
          {fields?.assignee !== false && <label className="field">Assignee<select value={draft.assigneeId ?? ''} disabled={!canSave || busy} onChange={event => change('assigneeId', event.target.value || null)}><option value="">Unassigned</option>{workspace.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
          {fields?.project !== false && <label className="field">Project<select value={draft.projectId ?? ''} disabled={!canSave || busy} onChange={event => change('projectId', event.target.value || null)}><option value="">No project</option>{workspace.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
        </div>}
        <div className="field-row">
          {fields?.cycle !== false && <label className="field">Cycle<select value={draft.cycleId ?? ''} disabled={!canSave || busy} onChange={event => change('cycleId', event.target.value || null)}><option value="">No cycle</option>{workspace.cycles.map(cycle => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>}
          {fields?.labels !== false && <div className="field"><label htmlFor="issue-label-input">Labels</label><div className="label-editor">{labels.length > 0 && <div className="label-tokens">{labels.map((label, index) => <span className="chip editable-label" key={`${label}-${index}`}>{label}<button type="button" aria-label={`Remove label ${label}`} disabled={!canSave || busy} onClick={() => setLabels(previous => previous.filter((_, position) => position !== index))}><X size={11} /></button></span>)}</div>}<div className="label-input-row"><input id="issue-label-input" placeholder="Add a label…" maxLength={100} value={labelDraft} disabled={!canSave || busy} onChange={event => setLabelDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addLabel() } }} /><button type="button" className="button subtle" disabled={!labelDraft.trim() || !canSave || busy} onClick={addLabel}>Add</button></div></div></div>}
        </div>
        {tasks && draft.sourceSection === 'Completed / Accepted' && <div className="acceptance-note"><p>{issue?.accepted ? 'Accepted by the user.' : 'Completed work awaits your acceptance. Moving here leaves its checkbox unchecked.'}</p>{issue?.status === 'done' && !issue.accepted && <><button type="button" className="button" disabled={!canSave || busy || hasChanges} onClick={accept}>Accept completed work</button>{hasChanges && <p className="muted">Save your changes before accepting this work.</p>}</>}</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!canSave && <p className="muted">This backend does not support editing issues.</p>}
      </div>
      <div className="modal-footer">
        {issue && <button type="button" className="button danger subtle delete-button" disabled={busy || !backend.capabilities.canDelete} onClick={() => setDeleting(true)}><Trash2 size={14} />Delete issue</button>}
        <button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy || !canSave}>{busy && <LoaderCircle size={14} className="spin" />}{issue ? 'Save changes' : 'Create issue'}</button>
      </div>
    </form>}
  </Dialog>
}
