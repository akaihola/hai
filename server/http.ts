import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { TasksStore } from './tasks-store.ts'
import { TasksError } from './tasks-markdown.ts'

interface Options { tasksFile: string; distDir: string; allowedHosts?: string[]; allowedOrigins?: string[]; projectRoots?: string[] }
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

function json(response: ServerResponse, status: number, data: unknown, revision?: string) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(revision ? { ETag: `"${revision}"` } : {}) })
  response.end(JSON.stringify(data))
}

async function body(request: IncomingMessage) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new TasksError('Use application/json.', 415)
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 1024 * 1024) throw new TasksError('Request body exceeds 1 MB.', 413)
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { throw new TasksError('Request body must be valid JSON.') }
}

export function createTasksServer(options: Options) {
  const tasksFile = resolve(options.tasksFile)
  const expandHome = (path: string) => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
  const roots = [...new Set([dirname(tasksFile), ...(options.projectRoots ?? [dirname(dirname(tasksFile))])].map(path => resolve(expandHome(path))))]
  const canonicalRoots = new Map<string, Promise<string>>()
  const stores = new Map<string, TasksStore>()
  const contains = (root: string, path: string) => { const child = relative(root, path); return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child) }
  async function selectSource(input: string | null) {
    let file = tasksFile
    if (input !== null) {
      if (!input.trim() || input.length > 4096 || /[\x00-\x1f\x7f\\]/.test(input)) throw new TasksError('Enter a project directory or TASKS.md path.')
      const path = expandHome(input)
      if (!isAbsolute(path)) throw new TasksError('Use an absolute server path or a path starting with ~/.')
      file = basename(path) === 'TASKS.md' || resolve(path) === tasksFile || stores.has(resolve(path)) ? resolve(path) : resolve(path, 'TASKS.md')
    }
    const allowed = await Promise.all(roots.map(async root => {
      let canonical = canonicalRoots.get(root)
      if (!canonical) {
        canonical = realpath(root).catch(() => {
          canonicalRoots.delete(root)
          throw new TasksError('A configured project root is unavailable. Check HAI_PROJECT_ROOTS.', 503)
        })
        canonicalRoots.set(root, canonical)
      }
      return { root, canonical: await canonical }
    }))
    if (!allowed.some(({ root, canonical }) => contains(root, file) || contains(canonical, file))) throw new TasksError('Project is outside the allowed project roots. Check HAI_PROJECT_ROOTS.', 403)
    let canonical: string
    try {
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new TasksError('TASKS.md must be a regular file, not a symbolic link.', 422)
      canonical = await realpath(file)
    } catch (error) {
      if (error instanceof TasksError) throw error
      throw new TasksError('Cannot open TASKS.md at that path. Check that the project and tracker exist and are readable.', 404)
    }
    if (!allowed.some(({ canonical: root }) => contains(root, canonical))) throw new TasksError('Project links must stay inside the allowed project roots.', 403)
    let store = stores.get(canonical)
    if (!store) { store = new TasksStore(canonical); stores.set(canonical, store) }
    return { store, source: { name: basename(dirname(canonical)), path: canonical } }
  }
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(options.allowedHosts ?? [])])
  const origins = new Set(options.allowedOrigins ?? [])
  const dist = resolve(options.distDir)
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
    try {
      const host = request.headers.host
      if (!host || !allowedHosts.has(new URL(`http://${host}`).hostname)) throw new TasksError('Host is not allowed.', 403)
      const url = new URL(request.url ?? '/', `http://${host}`)
      const method = request.method ?? 'GET'
      if (!['GET', 'HEAD'].includes(method)) {
        const origin = request.headers.origin
        if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${host}` && !origins.has(origin))) throw new TasksError('Cross-origin writes are not allowed.', 403)
      }
      if (method === 'GET' && url.pathname === '/healthz') {
        const { store } = await selectSource(null)
        await store.read()
        return json(response, 200, { ok: true })
      }
      if (url.searchParams.getAll('source').length > 1) throw new TasksError('Provide only one project source.')
      const selected = url.pathname.startsWith('/api/') ? await selectSource(url.searchParams.get('source')) : undefined
      if (method === 'GET' && url.pathname === '/api/workspace') {
        const { store, source } = selected!
        const { workspace, revision } = await store.read()
        return json(response, 200, { workspace, revision, source }, revision)
      }
      if (method === 'GET' && url.pathname === '/api/export') {
        const format = url.searchParams.get('format') ?? 'tasks'
        const content = await selected!.store.export(format)
        response.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${format === 'json' ? 'hai-workspace.json' : 'TASKS.md'}"` })
        return response.end(content)
      }
      const issuePath = /^\/api\/issues\/([\w-]+)$/.exec(url.pathname)
      const reorder = url.pathname === '/api/backlog/order' && method === 'POST'
      if (reorder || (url.pathname === '/api/issues' && method === 'POST') || (issuePath && ['PATCH', 'DELETE'].includes(method))) {
        const { store, source } = selected!
        const revision = request.headers['if-match']
        if (typeof revision !== 'string') throw new TasksError('Load the workspace and provide its revision with If-Match.', 428)
        const operation = reorder ? 'reorder' : method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update'
        const result = await store.mutate(operation, revision, issuePath?.[1], operation === 'delete' ? {} : await body(request))
        return json(response, operation === 'create' ? 201 : 200, { ...result, source }, result.revision)
      }
      if (url.pathname.startsWith('/api/')) throw new TasksError('API route not found.', 404)
      if (!['GET', 'HEAD'].includes(method)) throw new TasksError('Method not allowed.', 405)
      let pathname: string
      try { pathname = decodeURIComponent(url.pathname) } catch { throw new TasksError('Invalid URL path.') }
      if (pathname.includes('\0') || pathname.includes('\\')) throw new TasksError('Invalid URL path.')
      const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (relative(dist, path).startsWith(`..${sep}`) || relative(dist, path) === '..') throw new TasksError('File not found.', 404)
      let canonical: string
      try {
        canonical = await realpath(path)
        if (relative(dist, canonical).startsWith(`..${sep}`) || relative(dist, canonical) === '..' || !(await lstat(canonical)).isFile()) throw new Error('unsafe path')
      } catch { throw new TasksError('File not found.', 404) }
      response.writeHead(200, { 'Content-Type': types[extname(canonical)] ?? 'application/octet-stream', 'Cache-Control': extname(canonical) === '.html' ? 'no-cache' : 'public, max-age=3600' })
      response.end(method === 'HEAD' ? undefined : await readFile(canonical))
    } catch (error) {
      if (!response.headersSent) json(response, error instanceof TasksError ? error.status : 500, { error: error instanceof TasksError ? error.message : 'The server could not read or save the tracker.' })
      else response.end()
      if (!(error instanceof TasksError)) console.error(error)
    }
  })
}
