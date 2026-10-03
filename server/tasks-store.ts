import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertWorkspace, nextIssueNumber, serializeBackup } from '../src/data/validation.ts'
import { mutateTasks, parseTasks, TasksError, workspaceOf, type ParsedTasks } from './tasks-markdown.ts'

const exec = promisify(execFile)
interface Snapshot { parsed: ParsedTasks; revision: string; documents: Map<string, string>; workspace: ReturnType<typeof workspaceOf> }

async function regularFile(path: string, max = 2 * 1024 * 1024): Promise<string> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > max) throw new TasksError('Tracker sources must be regular files within the size limit.', 422)
    const content = await handle.readFile('utf8')
    if (Buffer.byteLength(content) > max) throw new TasksError('Tracker source exceeds the size limit.', 422)
    return content
  } catch (error) {
    if (error instanceof TasksError) throw error
    throw new TasksError('A tracker source is missing, inaccessible, or a symbolic link.', 422)
  } finally { await handle?.close() }
}

export class TasksStore {
  private queue: Promise<unknown> = Promise.resolve()
  readonly root: string
  readonly tasksFile: string
  constructor(tasksFile: string) { this.tasksFile = resolve(tasksFile); this.root = dirname(this.tasksFile) }

  private async documentPath(path: string, create = false): Promise<string> {
    if (!/^docs\/tasks\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(path) || path.includes('..')) throw new TasksError('Description paths must name Markdown files directly inside docs/tasks.', 422)
    const absolute = resolve(this.root, path)
    const parts = relative(this.root, dirname(absolute)).split(sep)
    let directory = this.root
    for (const part of parts) {
      directory = join(directory, part)
      if (create) await mkdir(directory, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error })
      const stat = await lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TasksError('Description directories must not contain symbolic links.', 422)
    }
    return absolute
  }

  async read(): Promise<Snapshot> { await this.queue; return this.snapshot() }

  private async snapshot(): Promise<Snapshot> {
    try {
      if (await realpath(this.root) !== this.root) throw new Error('Project directory changed.')
    } catch { throw new TasksError('Project directory changed, is unavailable, or contains symbolic links. Reopen the project.', 422) }
    const source = await regularFile(this.tasksFile)
    const parsed = parseTasks(source)
    const documents = new Map<string, string>()
    for (const task of parsed.tasks) {
      const path = task.issue.sourcePath
      if (path) {
        if (!documents.has(path)) documents.set(path, await regularFile(await this.documentPath(path), 256 * 1024))
        task.issue.description = documents.get(path)!
      }
    }
    const workspace = workspaceOf(parsed)
    try { assertWorkspace(workspace) } catch (error) { throw new TasksError(error instanceof Error ? error.message : 'Invalid tracker workspace.', 422) }
    const digest = createHash('sha256').update(this.tasksFile).update('\0').update(source)
    for (const [path, content] of [...documents].sort(([a], [b]) => a.localeCompare(b))) digest.update('\0').update(path).update('\0').update(content)
    return { parsed, workspace, documents, revision: digest.digest('hex') }
  }

  private async allocate(parsed: ParsedTasks, title: string): Promise<{ number: number; path: string }> {
    const reserved = /<!-- hai:reserved-numbers:([\d,]*) -->/.exec(parsed.source)?.[1].split(',').filter(Boolean).map(Number) ?? []
    const used = new Set([...reserved, ...[...parsed.references.keys()].map(Number)])
    const directory = join(this.root, 'docs/tasks')
    let filenames: string[] = []
    try {
      await this.documentPath('docs/tasks/placeholder.md')
      filenames = await readdir(directory)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    try {
      const history = await exec('git', ['-C', this.root, 'log', '--all', '--format=', '--name-only', '--', 'docs/tasks'], { timeout: 5000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, SHELL: '/bin/bash' } })
      filenames.push(...history.stdout.split('\n').map(path => path.split('/').at(-1)!))
    } catch (error) {
      if ((error as { code?: number }).code !== 128) throw new TasksError('Cannot verify historical description numbers.', 503)
    }
    for (const name of filenames) {
      const number = /^(\d+)(?:-|\.)/.exec(name)?.[1]
      if (number) used.add(Number(number))
    }
    let number = 1
    while (used.has(number)) number++
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'task'
    return { number, path: `docs/tasks/${number}-${slug}.md` }
  }

  async mutate(operation: 'create' | 'update' | 'delete' | 'reorder', revision: string, id?: string, input: unknown = {}) {
    const perform = async () => {
      const before = await this.snapshot()
      if (revision.replace(/^"|"$/g, '') !== before.revision) throw new TasksError('TASKS.md or a description changed. Reload before saving.', 412)
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TasksError('Expected an issue object.')
      const patch = { ...input } as Record<string, unknown>
      const current = before.workspace.issues.find(issue => issue.id === id)
      if (operation === 'update' && patch.description === current?.description) delete patch.description
      const allocation = operation !== 'reorder' && typeof patch.description === 'string' && patch.description.length && !current?.sourcePath ? await this.allocate(before.parsed, String(patch.title ?? current?.title ?? 'task')) : undefined
      const result = mutateTasks(before.parsed.source, operation, id, patch, allocation)
      if (allocation || (operation === 'delete' && current?.sourcePath)) {
        const reservedPattern = /<!-- hai:reserved-numbers:([\d,]*) -->/
        const previous = reservedPattern.exec(result.source)?.[1].split(',').filter(Boolean).map(Number) ?? []
        const reserved = [...new Set([...previous, ...[...before.parsed.references.keys()].map(Number), ...(allocation ? [allocation.number] : [])])].sort((a, b) => a - b)
        const metadata = `<!-- hai:reserved-numbers:${reserved.join(',')} -->`
        result.source = reservedPattern.test(result.source) ? result.source.replace(reservedPattern, metadata) : result.source.replace(/^## Rules/m, `${metadata}${before.parsed.newline}${before.parsed.newline}## Rules`)
      }
      const candidate = parseTasks(result.source)
      for (const task of candidate.tasks) {
        if (task.issue.sourcePath) task.issue.description = task.issue.sourcePath === result.descriptionWrite?.path ? result.descriptionWrite.content : before.documents.get(task.issue.sourcePath)!
      }
      try { assertWorkspace(workspaceOf(candidate)) } catch (error) { throw new TasksError(error instanceof Error ? error.message : 'Invalid issue change.') }
      const changes: { path: string; content: string; previous?: string; mode?: number }[] = []
      if (result.descriptionWrite) changes.push({ path: await this.documentPath(result.descriptionWrite.path, true), content: result.descriptionWrite.content, previous: before.documents.get(result.descriptionWrite.path) })
      if (result.source !== before.parsed.source) changes.push({ path: this.tasksFile, content: result.source, previous: before.parsed.source })
      const temps: string[] = []
      const committed: typeof changes = []
      try {
        for (const change of changes) {
          const temporary = `${change.path}.hai-${randomUUID()}.tmp`
          temps.push(temporary)
          let mode = 0o600
          try {
            const stat = await lstat(change.path)
            if (!stat.isFile() || stat.isSymbolicLink()) throw new TasksError('Refusing to replace a nonregular source file.', 422)
            if (change.previous === undefined) throw new TasksError('The new description path already exists.', 409)
            mode = stat.mode & 0o777
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          change.mode = mode
          const handle = await open(temporary, 'wx', mode)
          try { await handle.writeFile(change.content, 'utf8'); await handle.sync() } finally { await handle.close() }
        }
        if ((await this.snapshot()).revision !== before.revision) throw new TasksError('Tracker changed during save. Reload before saving.', 412)
        for (let index = 0; index < changes.length; index++) {
          await rename(temps[index], changes[index].path)
          committed.push(changes[index])
        }
        const after = await this.snapshot()
        return { workspace: after.workspace, revision: after.revision, ...(result.id && operation !== 'delete' ? { issue: after.workspace.issues.find(issue => issue.id === result.id) } : {}) }
      } catch (error) {
        const stillOurs = await Promise.all(committed.map(async change => {
          try { return await regularFile(change.path) === change.content } catch { return false }
        }))
        if (stillOurs.some(unchanged => !unchanged)) throw new TasksError('Save was partially applied and a source changed again. Current files were preserved. Reload and review the tracker before retrying.', 409)
        for (const change of committed.reverse()) {
          if (change.previous === undefined) await rm(change.path, { force: true })
          else {
            const temporary = `${change.path}.hai-${randomUUID()}.rollback`
            const handle = await open(temporary, 'wx', change.mode ?? 0o600)
            try { await handle.writeFile(change.previous); await handle.sync() } finally { await handle.close() }
            await rename(temporary, change.path)
          }
        }
        throw error
      } finally { await Promise.all(temps.map(path => rm(path, { force: true }))) }
    }
    const pending = this.queue.then(perform, perform)
    this.queue = pending.catch(() => {})
    return pending
  }

  async export(format: string) {
    const snapshot = await this.read()
    if (format === 'tasks') return snapshot.parsed.source
    if (format === 'json') return serializeBackup({ version: 1, nextIssueNumber: nextIssueNumber(snapshot.workspace), workspace: snapshot.workspace })
    throw new TasksError('Choose tasks or json export format.')
  }
}
