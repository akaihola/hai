import { delimiter, resolve } from 'node:path'
import { createTasksServer } from './http.ts'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
const server = createTasksServer({
  tasksFile: resolve(process.env.HAI_TASKS_FILE ?? 'TASKS.md'),
  distDir: resolve(process.env.HAI_DIST_DIR ?? 'dist'),
  allowedHosts: process.env.HAI_ALLOWED_HOSTS?.split(',').map(value => value.trim()).filter(Boolean),
  allowedOrigins: process.env.HAI_ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean),
  projectRoots: process.env.HAI_PROJECT_ROOTS?.split(delimiter).map(value => value.trim()).filter(Boolean),
})
server.listen(port, host, () => console.log(`Hai listening on http://${host}:${port}`))
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)))
