import test from 'node:test'
import assert from 'node:assert/strict'
import { request, type IncomingHttpHeaders } from 'node:http'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTasksServer } from '../server/http.ts'

const source = '# Tasks\n\n## Unverified proposals\n\n## Ordered backlog\n\n- [1] Original title\n\n## Scheduled\n\n## In Progress\n\n## Completed / Accepted\n\n[1]: docs/tasks/1-original.md\n[*]: TASKS.md\n\n## Rules\n\nOnly the user accepts completed work.\n'
const privateHost = 'gogo.tailnet.example:8443'
const privateOrigin = `https://${privateHost}`

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'hai-security-'))
  await mkdir(join(root, 'docs/tasks'), { recursive: true })
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'TASKS.md'), source)
  await writeFile(join(root, 'docs/tasks/1-original.md'), '# Original description\n')
  await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>Hai</title>')
  const server = createTasksServer({ tasksFile: join(root, 'TASKS.md'), distDir: join(root, 'dist'), allowedHosts: ['gogo.tailnet.example'], allowedOrigins: [privateOrigin] })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server has no port')
  const port = address.port
  async function send(path: string, method = 'GET', headers: Record<string, string> = {}, data?: object): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const call = request({ hostname: '127.0.0.1', port, path, method, headers }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
      })
      call.on('error', reject)
      call.end(data === undefined ? undefined : JSON.stringify(data))
    })
  }
  return { root, send, close: async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  } }
}

test('private HTTPS proxy accepts only its configured write origin and rejects host spoofing', async () => {
  const app = await setup()
  try {
    const initial = await app.send('/api/workspace', 'GET', { host: privateHost })
    assert.equal(initial.status, 200)
    const headers = { host: privateHost, origin: privateOrigin, 'content-type': 'application/json', 'if-match': initial.headers.etag! }
    const accepted = await app.send('/api/issues/task-1', 'PATCH', headers, { title: 'Saved through private HTTPS' })
    assert.equal(accepted.status, 200, accepted.body)
    assert.equal(JSON.parse(accepted.body).workspace.issues[0].accepted, false)
    const saved = await readFile(join(app.root, 'TASKS.md'), 'utf8')
    const fresh = { ...headers, 'if-match': accepted.headers.etag! }
    for (const extra of [
      { origin: 'https://evil.example' },
      { origin: 'https://gogo.tailnet.example:8444' },
      { origin: 'null' },
      { origin: 'https://gogo.tailnet.example:8443@evil.example' },
      { 'sec-fetch-site': 'cross-site' },
    ] as Record<string, string>[]) {
      const denied = await app.send('/api/issues/task-1', 'PATCH', { ...fresh, ...extra }, { title: 'Must not save' })
      assert.equal(denied.status, 403, JSON.stringify(extra))
    }
    assert.equal((await app.send('/api/workspace', 'GET', { host: 'evil.example', 'x-forwarded-host': privateHost, 'x-forwarded-proto': 'https' })).status, 403)
    assert.equal((await app.send('/api/workspace', 'GET', { host: 'gogo.tailnet.example.evil.example:8443' })).status, 403)
    assert.equal(await readFile(join(app.root, 'TASKS.md'), 'utf8'), saved)
  } finally { await app.close() }
})

test('tracker, description directories, and static files cannot escape through symlinks', async () => {
  const app = await setup()
  try {
    await symlink(join(app.root, 'TASKS.md'), join(app.root, 'dist/source.md'))
    assert.equal((await app.send('/source.md')).status, 404)
    assert.equal((await app.send('/%2e%2e%2fTASKS.md')).status, 404)
    await rename(join(app.root, 'docs/tasks'), join(app.root, 'descriptions'))
    await symlink(join(app.root, 'descriptions'), join(app.root, 'docs/tasks'))
    assert.equal((await app.send('/api/workspace')).status, 422)
    await rm(join(app.root, 'docs/tasks'))
    await rename(join(app.root, 'descriptions'), join(app.root, 'docs/tasks'))
    await rename(join(app.root, 'TASKS.md'), join(app.root, 'real-tasks.md'))
    await symlink(join(app.root, 'real-tasks.md'), join(app.root, 'TASKS.md'))
    assert.equal((await app.send('/api/workspace')).status, 422)
    assert.equal(await readFile(join(app.root, 'real-tasks.md'), 'utf8'), source)
  } finally { await app.close() }
})
