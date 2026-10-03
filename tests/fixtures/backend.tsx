import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import { createLocalBackend, STORAGE_KEY, type StorageLike } from '../../src/adapters/local'
import { createSeedWorkspace } from '../../src/data/seed'
import { nextIssueNumber, serializeBackup } from '../../src/data/validation'
import type { Workspace, WorkspaceBackend } from '../../src/domain'
import '../../src/styles.css'

type ProviderId = 'alpha' | 'beta' | 'readonly'
type Calls = { create: number; update: number; delete: number; import: number; export: number }
interface Fixture {
  select(id: ProviderId): void
  calls(id: ProviderId): Calls
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
}
const providers = {} as Record<ProviderId, WorkspaceBackend>
const sources = {} as Record<ProviderId, WorkspaceBackend>
const deferred = new Map<ProviderId, { promise: Promise<void>; release: () => void }>()
for (const id of ['alpha', 'beta', 'readonly'] as const) {
  const data = new Map<string, string>()
  const storage: StorageLike = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
  const workspace = createSeedWorkspace()
  workspace.issues[0].title = `${id} workspace issue`
  storage.setItem(STORAGE_KEY, serializeBackup({ version: 1, nextIssueNumber: nextIssueNumber(workspace), workspace }))
  const source = createLocalBackend(storage)
  const writable = id !== 'readonly'
  function record(operation: keyof Calls) {
    calls[id][operation]++
    if (!writable) throw new Error(`Unsupported ${operation} reached readonly backend`)
  }
  sources[id] = source
  providers[id] = {
    ...source,
    capabilities: { ...source.capabilities, id, name: `${id} provider`, canCreate: writable, canUpdate: writable, canDelete: writable, canImport: writable, canExport: writable },
    async createIssue(input) { record('create'); return source.createIssue(input) },
    async updateIssue(issueId, patch) { record('update'); await deferred.get(id)?.promise; return source.updateIssue(issueId, patch) },
    async deleteIssue(issueId) { record('delete'); return source.deleteIssue(issueId) },
    async importData(content, format) { record('import'); return source.importData(content, format) },
    async exportData(format) { record('export'); return source.exportData(format) },
  }
}

function Harness() {
  const [provider, setProvider] = useState<ProviderId>('alpha')
  useEffect(() => {
    window.haiFixture = {
      select: setProvider,
      calls: id => ({ ...calls[id] }),
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
