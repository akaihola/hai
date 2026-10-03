import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import { createLocalBackend, STORAGE_KEY, type StorageLike } from '../../src/adapters/local'
import { createSeedWorkspace } from '../../src/data/seed'
import { nextIssueNumber, serializeBackup } from '../../src/data/validation'
import type { Workspace, WorkspaceBackend } from '../../src/domain'
import '../../src/styles.css'

const providerIds = ['alpha', 'beta', 'readonly', 'selective'] as const
type ProviderId = typeof providerIds[number]
type Calls = { create: number; update: number; delete: number; import: number; export: number }
type EntityCalls = { createProject: number; updateProject: number; deleteProject: number; createCycle: number; updateCycle: number; deleteCycle: number }
interface Fixture {
  select(id: ProviderId): void
  calls(id: ProviderId): Calls
  entityCalls(id: ProviderId): EntityCalls
  snapshot(id: ProviderId): Promise<Workspace>
  backup(id: ProviderId): Promise<string>
  deferUpdate(id: ProviderId): void
  releaseUpdate(id: ProviderId): void
}
declare global { interface Window { haiFixture: Fixture } }

const calls: Record<ProviderId, Calls> = {
  alpha: { create: 0, update: 0, delete: 0, import: 0, export: 0 },
  beta: { create: 0, update: 0, delete: 0, import: 0, export: 0 },
  readonly: { create: 0, update: 0, delete: 0, import: 0, export: 0 },
  selective: { create: 0, update: 0, delete: 0, import: 0, export: 0 },
}
const entityCalls = Object.fromEntries(providerIds.map(id => [id, { createProject: 0, updateProject: 0, deleteProject: 0, createCycle: 0, updateCycle: 0, deleteCycle: 0 }])) as Record<ProviderId, EntityCalls>
const providers = {} as Record<ProviderId, WorkspaceBackend>
const sources = {} as Record<ProviderId, WorkspaceBackend>
const deferred = new Map<ProviderId, { promise: Promise<void>; release: () => void }>()
for (const id of providerIds) {
  const data = new Map<string, string>()
  const storage: StorageLike = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
  const workspace = createSeedWorkspace()
  workspace.issues[0].title = `${id} workspace issue`
  storage.setItem(STORAGE_KEY, serializeBackup({ version: 1, nextIssueNumber: nextIssueNumber(workspace), workspace }))
  const source = createLocalBackend(storage)
  const writable = id !== 'readonly'
  const entityCapabilities = {
    canCreateProject: writable && id !== 'selective', canUpdateProject: writable, canDeleteProject: writable && id !== 'selective',
    canCreateCycle: writable && id !== 'selective', canUpdateCycle: writable && id !== 'selective', canDeleteCycle: writable,
  }
  function record(operation: keyof Calls) {
    calls[id][operation]++
    if (!writable) throw new Error(`Unsupported ${operation} reached readonly backend`)
  }
  function recordEntity(operation: keyof EntityCalls, allowed: boolean) {
    entityCalls[id][operation]++
    if (!allowed) throw new Error(`Unsupported ${operation} reached ${id} backend`)
  }
  sources[id] = source
  providers[id] = {
    ...source,
    capabilities: { ...source.capabilities, ...entityCapabilities, id, name: `${id} provider`, canCreate: writable, canUpdate: writable, canDelete: writable, canImport: writable, canExport: writable },
    async createIssue(input) { record('create'); return source.createIssue(input) },
    async updateIssue(issueId, patch) { record('update'); await deferred.get(id)?.promise; return source.updateIssue(issueId, patch) },
    async deleteIssue(issueId) { record('delete'); return source.deleteIssue(issueId) },
    async importData(content, format) { record('import'); return source.importData(content, format) },
    async exportData(format) { record('export'); return source.exportData(format) },
    async createProject(input) { recordEntity('createProject', entityCapabilities.canCreateProject); return source.createProject!(input) },
    async updateProject(projectId, patch) { recordEntity('updateProject', entityCapabilities.canUpdateProject); await deferred.get(id)?.promise; return source.updateProject!(projectId, patch) },
    async deleteProject(projectId) { recordEntity('deleteProject', entityCapabilities.canDeleteProject); return source.deleteProject!(projectId) },
    async createCycle(input) { recordEntity('createCycle', entityCapabilities.canCreateCycle); return source.createCycle!(input) },
    async updateCycle(cycleId, patch) { recordEntity('updateCycle', entityCapabilities.canUpdateCycle); await deferred.get(id)?.promise; return source.updateCycle!(cycleId, patch) },
    async deleteCycle(cycleId) { recordEntity('deleteCycle', entityCapabilities.canDeleteCycle); return source.deleteCycle!(cycleId) },
  }
}

function Harness() {
  const [provider, setProvider] = useState<ProviderId>('alpha')
  useEffect(() => {
    window.haiFixture = {
      select: setProvider,
      calls: id => ({ ...calls[id] }),
      entityCalls: id => ({ ...entityCalls[id] }),
      snapshot: id => sources[id].load(),
      backup: id => sources[id].exportData('json'),
      deferUpdate: id => {
        let release!: () => void
        const promise = new Promise<void>(resolve => { release = resolve })
        deferred.set(id, { promise, release })
      },
      releaseUpdate: id => { deferred.get(id)?.release(); deferred.delete(id) },
    }
  }, [])
  return <App backend={providers[provider]} />
}
createRoot(document.getElementById('root')!).render(<Harness />)
