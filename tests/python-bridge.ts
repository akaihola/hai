// Test transport only. All tracker and HTTP behavior runs in Python.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import type { Workspace } from '../src/domain.ts'

const cwd = resolve(import.meta.dirname, '..')
const environment = { ...process.env, SHELL: '/bin/bash', PYTHONPATH: cwd }
function call(command: string, args: unknown[] = [], file?: string): any {
  const process = spawnSync('python3', ['tests/python/bridge.py'], { cwd, env: environment, input: JSON.stringify({ command, args, file }), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (process.error || process.status !== 0) throw process.error ?? new Error(process.stderr)
  const value = JSON.parse(process.stdout)
  if (value.error) throw Object.assign(new Error(value.error), { status: value.status })
  return value.result
}
interface Task { start: number; end: number; raw: string; marker: string; issue: Workspace['issues'][number] }
export function parseTasks(source: string): { source: string; tasks: Task[] } { return call('parse', [source]) }
export function mutateTasks(source: string, operation: string, id?: string, input: unknown = {}, allocation?: unknown): { source: string; id?: string; descriptionWrite?: { path: string; content: string } } { return call('mutate', [source, operation, id, input, allocation]) }
export function workspaceOf(parsed: ReturnType<typeof parseTasks>): Workspace { return { issues: parsed.tasks.map(task => task.issue), projects: [], members: [], cycles: [], currentMemberId: null } }
interface Options { tasksFile: string; distDir: string; allowedHosts?: string[]; allowedOrigins?: string[]; projectRoots?: string[] }
export function createTasksServer(options: Options) {
  let child: ChildProcess, port: number
  return {
    listen(requestedPort: number, host: string, ready: () => void) {
      const env = { ...environment, HAI_ALLOWED_HOSTS: options.allowedHosts?.join(',') ?? '', HAI_ALLOWED_ORIGINS: options.allowedOrigins?.join(',') ?? '' }
      if (options.projectRoots) Object.assign(env, { HAI_PROJECT_ROOTS: options.projectRoots.join(':') })
      child = spawn('python3', ['-m', 'hai_server', '--tasks-file', options.tasksFile, '--dist-dir', options.distDir, '--host', host, '--port', String(requestedPort)], { cwd, env, stdio: ['ignore', 'pipe', 'inherit'] })
      let buffer = ''
      child.stdout!.on('data', chunk => {
        buffer += chunk.toString()
        if (!port && buffer.includes('\n')) { port = JSON.parse(buffer.split('\n')[0]).port; ready() }
      })
      child.on('error', error => { throw error })
      child.on('exit', code => { if (!port) throw new Error(`Python server failed to start (${code})`) })
    },
    address() { return { port } },
    close(done: (error?: Error) => void) { child.once('exit', () => done()); child.kill('SIGTERM') },
  }
}
