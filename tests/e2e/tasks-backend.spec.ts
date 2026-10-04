import { test as base, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTasksServer } from '../python-bridge.ts'

const initialTasks = `# Source workspace

Keep this introduction intact.

## Unverified proposals

- [ ] [*] Unverified source proposal

## Ordered backlog

- [ ] [1] First source issue

## Scheduled

- [ ] [*] Scheduled source work

## In Progress

- [~] [*] Active source work

## Completed / Accepted

- [ ] [2] Finished source work
- [x] [*] Already accepted work

[1]: docs/tasks/1-first.md
[2]: docs/tasks/2-finished.md

## Rules

Only explicit user acceptance checks a completed task.
`
const originalDescription = '---\nowner: source-file\n---\n\n# First source issue\n\nKeep this **Markdown** and formatting.\n'
const backlogEntries = [
  '- [ ] [1] First source issue\n\n',
  '- [*] Middle source issue\n\n  Keep this **inline description**.\n  <!-- hai:{"id":"middle-source","priority":"high"} -->\n\n',
  '- [*] Last source issue\n  <!-- hai:{"id":"last-source","labels":["Keep me"]} -->\n\n',
]
const reorderTasks = initialTasks.replace(backlogEntries[0], backlogEntries.join(''))
const test = base.extend<{ taskSource: { directory: string; file: string } }>({
  taskSource: [async ({ page }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'hai-browser-tasks-'))
    const file = join(directory, 'TASKS.md')
    await mkdir(join(directory, 'docs/tasks'), { recursive: true })
    await writeFile(file, initialTasks)
    await writeFile(join(directory, 'docs/tasks/1-first.md'), originalDescription)
    await writeFile(join(directory, 'docs/tasks/2-finished.md'), '# Finished work\n')
    const server = createTasksServer({ tasksFile: file, distDir: resolve('dist'), allowedOrigins: ['http://127.0.0.1:5173'] })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start.')
    await page.route('**/api/**', async route => {
      const original = new URL(route.request().url())
      const response = await route.fetch({ url: `http://127.0.0.1:${address.port}${original.pathname}${original.search}` })
      await route.fulfill({ response })
    })
    try { await use({ directory, file }) }
    finally {
      await page.unrouteAll({ behavior: 'wait' })
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }, { auto: true }],
})

test('the default workspace reads source sections and keeps unsupported dimensions out of the UI', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hai.workspace.v1', '{deliberately-invalid-local-demo'))
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  for (const section of ['Unverified proposals', 'Ordered backlog', 'Scheduled', 'In Progress', 'Completed', 'Accepted']) await expect(page.locator('.group-toggle').filter({ hasText: section })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh source', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cycles', exact: true })).toHaveCount(0)
  await page.getByText('First source issue', { exact: true }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('combobox', { name: 'Section', exact: true })).toHaveValue('Ordered backlog')
  await expect(editor.getByRole('combobox', { name: 'Assignee', exact: true })).toHaveCount(0)
  await expect(editor.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(originalDescription)
  await expect(editor.locator('.source-details')).toContainText('[1]')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Refresh source', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const view of ['list', 'board'] as const) test(`${view} separates completion from acceptance and can hide accepted work`, async ({ page, taskSource }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  if (view === 'board') await page.getByRole('button', { name: 'Board view', exact: true }).click()
  const group = (label: string) => page.getByRole('region', { name: `${label} ${view === 'list' ? 'group' : 'column'}`, exact: true })
  await expect(group('Completed').getByText('Finished source work', { exact: true })).toBeVisible()
  await expect(group('Completed').getByText('Already accepted work', { exact: true })).toHaveCount(0)
  await expect(group('Accepted').getByText('Already accepted work', { exact: true })).toBeVisible()
  await expect(group('Accepted').getByText('Finished source work', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add issue to Accepted', exact: true })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Completed', exact: true }).click()
  await expect(page.locator('.issue-total')).toHaveText('1 issues')
  await expect(group('Completed')).toBeVisible()
  await expect(group('Accepted')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Accepted', exact: true }).click()
  await expect(page.locator('.issue-total')).toHaveText('1 issues')
  await expect(group('Accepted')).toBeVisible()
  await expect(group('Completed')).toHaveCount(0)
  await page.getByRole('tab', { name: 'All issues', exact: true }).click()

  await page.locator('.filter-menu summary').click()
  await page.getByRole('combobox', { name: 'Section', exact: true }).selectOption('Completed')
  await expect(group('Completed')).toBeVisible()
  await expect(group('Accepted')).toHaveCount(0)
  await expect(page.locator('.issue-total')).toHaveText('1 issues')
  await page.getByRole('combobox', { name: 'Section', exact: true }).selectOption('Accepted')
  await expect(group('Accepted')).toBeVisible()
  await expect(group('Completed')).toHaveCount(0)
  await expect(page.locator('.issue-total')).toHaveText('1 issues')
  await page.getByRole('combobox', { name: 'Section', exact: true }).selectOption('')
  await page.getByRole('checkbox', { name: 'Hide accepted', exact: true }).check()
  await expect(group('Accepted')).toHaveCount(0)
  await expect(page.getByText('Already accepted work', { exact: true })).toHaveCount(0)
  await expect(group('Completed').getByText('Finished source work', { exact: true })).toBeVisible()
  await expect(group('Ordered backlog').getByText('First source issue', { exact: true })).toBeVisible()
  await expect(page.locator('.issue-total')).toHaveText('5 issues')
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(group('Accepted')).toBeVisible()
  await expect(page.locator('.issue-total')).toHaveText('6 issues')
  expect(await readFile(taskSource.file, 'utf8')).toBe(initialTasks)
})

for (const view of ['list', 'board'] as const) test(`${view} rejects acceptance by dragging and creates completed work awaiting acceptance`, async ({ page, taskSource }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  if (view === 'board') await page.getByRole('button', { name: 'Board view', exact: true }).click()
  const accepted = page.getByRole('region', { name: `Accepted ${view === 'list' ? 'group' : 'column'}`, exact: true })
  let writes = 0
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes++ })
  const first = page.locator(view === 'list' ? '.draggable-issue' : '.issue-card').filter({ hasText: 'First source issue' })
  await first.dragTo(accepted, { targetPosition: { x: 60, y: 20 } })
  await expect(accepted.getByText('First source issue', { exact: true })).toHaveCount(0)
  expect(writes).toBe(0)
  expect(await readFile(taskSource.file, 'utf8')).toBe(initialTasks)
  await page.getByRole('button', { name: 'Add issue to Completed', exact: true }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('combobox', { name: 'Section', exact: true })).toHaveValue('Completed / Accepted')
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Created completed work')
  await editor.getByRole('button', { name: 'Create issue', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const completed = page.getByRole('region', { name: `Completed ${view === 'list' ? 'group' : 'column'}`, exact: true })
  await expect(completed.getByText('Created completed work', { exact: true })).toBeVisible()
  const source = await readFile(taskSource.file, 'utf8')
  expect(source).toContain('- [ ] [*] Created completed work')
  expect(source).not.toContain('- [x] [*] Created completed work')
  expect(source.match(/^## Completed \/ Accepted$/gm)).toHaveLength(1)
  expect(source).not.toMatch(/^## (Completed|Accepted)$/m)
})

test('create, description edit, completion, explicit acceptance, export and deletion write the source', async ({ page, taskSource }) => {
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New issue', exact: true }).click()
  let editor = page.getByRole('dialog')
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Created in the filesystem')
  await editor.getByRole('textbox', { name: 'Description', exact: true }).fill('# New description\n\nStored beside TASKS.md.\n')
  await editor.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high')
  await editor.getByRole('button', { name: 'Create issue', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect.poll(() => readFile(taskSource.file, 'utf8')).toContain('Created in the filesystem')
  await page.reload()
  await page.getByText('Created in the filesystem', { exact: true }).click()
  editor = page.getByRole('dialog')
  await expect(editor.getByRole('combobox', { name: 'Section', exact: true })).toHaveValue('Unverified proposals')
  await expect(editor.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('high')
  await editor.getByRole('textbox', { name: 'Description', exact: true }).fill('# Revised description\n\nWritten from Hai.\n')
  await editor.getByRole('combobox', { name: 'Section', exact: true }).selectOption('Completed / Accepted')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Completed group', exact: true }).getByText('Created in the filesystem', { exact: true })).toBeVisible()
  let source = await readFile(taskSource.file, 'utf8')
  const reference = /- \[ \] \[(\d+)\] Created in the filesystem/.exec(source)?.[1]
  expect(reference).toBeTruthy()
  const descriptionPath = new RegExp(`^\\[${reference}\\]: (.+)$`, 'm').exec(source)?.[1]
  expect(descriptionPath).toBeTruthy()
  expect(await readFile(join(taskSource.directory, descriptionPath!), 'utf8')).toContain('Written from Hai.')
  await page.getByText('Created in the filesystem', { exact: true }).click()
  await page.getByRole('button', { name: 'Accept completed work', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Accepted group', exact: true }).getByText('Created in the filesystem', { exact: true })).toBeVisible()
  source = await readFile(taskSource.file, 'utf8')
  expect(source).toContain(`- [x] [${reference}] Created in the filesystem`)
  await page.getByText('Created in the filesystem', { exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Section', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Integrations', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Import JSON backup', exact: true })).toBeDisabled()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export TASKS.md', exact: true }).click()
  const download = await downloadPromise
  expect(await readFile((await download.path())!, 'utf8')).toBe(source)
  await page.getByRole('button', { name: 'All issues', exact: true }).click()
  await page.getByText('Created in the filesystem', { exact: true }).click()
  await page.getByRole('button', { name: 'Delete issue', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click()
  await expect(page.getByText('Created in the filesystem', { exact: true })).toHaveCount(0)
  expect(await readFile(taskSource.file, 'utf8')).not.toContain('Created in the filesystem')
})

test('external edits conflict safely and refresh exposes the latest files', async ({ page, taskSource }) => {
  await page.goto('/')
  await page.getByText('First source issue', { exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Stale draft must not overwrite source')
  const external = initialTasks.replace('First source issue', 'Title edited outside Hai')
  await writeFile(taskSource.file, external)
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('TASKS.md or a description changed')
  expect(await readFile(taskSource.file, 'utf8')).toBe(external)
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('Refresh the source before saving')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Refresh source', exact: true }).click()
  await page.getByText('Title edited outside Hai', { exact: true }).click()
  await editor.getByRole('combobox', { name: 'Section', exact: true }).selectOption('In Progress')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(await readFile(taskSource.file, 'utf8')).toContain('- [~] [1] Title edited outside Hai')
  expect(await readFile(join(taskSource.directory, 'docs/tasks/1-first.md'), 'utf8')).toBe(originalDescription)
})

test('board moves preserve proposal sections and completion does not accept work', async ({ page, taskSource }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Board view', exact: true }).click()
  const proposal = page.locator('.issue-card').filter({ hasText: 'Unverified source proposal' })
  await proposal.dragTo(page.getByRole('region', { name: 'Ordered backlog column', exact: true }), { targetPosition: { x: 60, y: 20 } })
  await expect(page.getByRole('region', { name: 'Ordered backlog column', exact: true }).getByText('Unverified source proposal', { exact: true })).toBeVisible()
  await page.locator('.issue-card').filter({ hasText: 'First source issue' }).dragTo(page.getByRole('region', { name: 'Completed column', exact: true }), { targetPosition: { x: 60, y: 20 } })
  await expect(page.getByRole('region', { name: 'Completed column', exact: true }).getByText('First source issue', { exact: true })).toBeVisible()
  const source = await readFile(taskSource.file, 'utf8')
  expect(source).toContain('- [ ] [1] First source issue')
  expect(source).not.toContain('- [x] [1]')
  await expect(page.locator('.issue-card').filter({ hasText: 'Already accepted work' })).toHaveAttribute('draggable', 'false')
})

test('list moves reach collapsed and empty groups, persist, and preserve acceptance and descriptions', async ({ page, taskSource }) => {
  await writeFile(taskSource.file, initialTasks.replace('- [ ] [*] Scheduled source work\n', ''))
  await page.goto('/')
  const group = (label: string) => page.getByRole('region', { name: `${label} group`, exact: true })
  const first = page.locator('.draggable-issue').filter({ hasText: 'First source issue' })
  const proposals = group('Unverified proposals'), scheduled = group('Scheduled'), completed = group('Completed')
  await proposals.locator('.group-toggle').click()
  await first.dragTo(proposals.locator('.group-heading'))
  await expect(proposals.locator('.group-count')).toHaveText('2')
  await expect(proposals.locator('.group-toggle')).toHaveAttribute('aria-expanded', 'false')
  await proposals.locator('.group-toggle').click()
  await expect(proposals.getByText('First source issue', { exact: true })).toBeVisible()
  await expect(scheduled.locator('.group-count')).toHaveText('0')
  await first.dragTo(scheduled.locator('.group-heading'))
  await expect(scheduled.getByText('First source issue', { exact: true })).toBeVisible()
  await first.dragTo(completed.locator('.draggable-issue').filter({ hasText: 'Finished source work' }))
  await expect(completed.getByText('First source issue', { exact: true })).toBeVisible()
  await expect(first).toHaveAttribute('draggable', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const source = await readFile(taskSource.file, 'utf8')
  expect(source).toContain('- [ ] [1] First source issue')
  expect(source).not.toContain('- [x] [1]')
  expect(source).toContain('- [x] [*] Already accepted work')
  expect(source).toContain('Keep this introduction intact.')
  expect(source).toContain('[1]: docs/tasks/1-first.md\n[2]: docs/tasks/2-finished.md')
  expect(source).toContain('Only explicit user acceptance checks a completed task.')
  expect(await readFile(join(taskSource.directory, 'docs/tasks/1-first.md'), 'utf8')).toBe(originalDescription)
  const accepted = group('Accepted').locator('.draggable-issue').filter({ hasText: 'Already accepted work' })
  await expect(accepted).toHaveAttribute('draggable', 'false')
  await accepted.dragTo(group('Ordered backlog').locator('.group-heading'))
  expect(await readFile(taskSource.file, 'utf8')).toBe(source)
  await page.reload()
  await expect(completed.getByText('First source issue', { exact: true })).toBeVisible()
  await expect(accepted).toBeVisible()
})

for (const view of ['list', 'board'] as const) test(`${view} backlog drag and keyboard ordering persist without changing task text`, async ({ page, taskSource }) => {
  await writeFile(taskSource.file, reorderTasks)
  await page.setViewportSize({ width: 1920, height: 1000 })
  await page.goto('/')
  await expect(page.getByText('Last source issue', { exact: true })).toBeVisible()
  if (view === 'board') await page.getByRole('button', { name: 'Board view', exact: true }).click()
  const backlog = view === 'list'
    ? page.locator('.issue-group').filter({ has: page.locator('.group-toggle').filter({ hasText: 'Ordered backlog' }) })
    : page.getByRole('region', { name: 'Ordered backlog column', exact: true })
  const titles = backlog.locator(view === 'list' ? '.issue-title' : '.issue-card > strong')
  const item = (title: string) => backlog.locator(view === 'list' ? '.reorderable-issue' : '.issue-card').filter({ hasText: title })
  const first = item('First source issue'), middle = item('Middle source issue'), last = item('Last source issue')
  await expect(titles).toHaveText(['First source issue', 'Middle source issue', 'Last source issue'])

  await last.dragTo(first, { targetPosition: { x: 30, y: 4 } })
  await expect(titles).toHaveText(['Last source issue', 'First source issue', 'Middle source issue'])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const middleBounds = await middle.boundingBox()
  await last.dragTo(middle, { targetPosition: { x: 30, y: middleBounds!.height - 4 } })
  await expect(titles).toHaveText(['First source issue', 'Middle source issue', 'Last source issue'])

  const keyboardTarget = view === 'list' ? page.getByRole('button', { name: 'Reorder Last source issue', exact: true }) : last
  await keyboardTarget.focus()
  await keyboardTarget.press('Alt+ArrowUp')
  await expect(titles).toHaveText(['First source issue', 'Last source issue', 'Middle source issue'])
  await expect(keyboardTarget).toBeFocused()
  await keyboardTarget.press('Alt+ArrowDown')
  await expect(titles).toHaveText(['First source issue', 'Middle source issue', 'Last source issue'])
  await keyboardTarget.press('Alt+ArrowUp')
  await expect(titles).toHaveText(['First source issue', 'Last source issue', 'Middle source issue'])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => readFile(taskSource.file, 'utf8')).toBe(initialTasks.replace(backlogEntries[0], [backlogEntries[0], backlogEntries[2], backlogEntries[1]].join('')))
  expect(await readFile(join(taskSource.directory, 'docs/tasks/1-first.md'), 'utf8')).toBe(originalDescription)
  await page.reload()
  await expect(titles).toHaveText(['First source issue', 'Last source issue', 'Middle source issue'])
  if (view === 'list') {
    await page.setViewportSize({ width: 390, height: 844 })
    const handleBounds = await keyboardTarget.boundingBox(), identifierBounds = await last.locator('.issue-id').boundingBox()
    expect(handleBounds!.x + handleBounds!.width).toBeLessThanOrEqual(identifierBounds!.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

for (const view of ['list', 'board'] as const) test(`${view} alternative sorting disables manual ordering and allows group moves`, async ({ page, taskSource }) => {
  await writeFile(taskSource.file, reorderTasks)
  await page.setViewportSize({ width: 1920, height: 1000 })
  let writes = 0
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes++ })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Reorder Last source issue', exact: true })).toBeVisible()
  await page.getByLabel('Display options', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Order by', exact: true }).selectOption('priority')
  await expect(page.getByRole('button', { name: /^Reorder / })).toHaveCount(0)
  await page.getByLabel('Display options', { exact: true }).click()
  if (view === 'board') await page.getByRole('button', { name: 'Board view', exact: true }).click()
  const last = page.locator(view === 'list' ? '.draggable-issue' : '.issue-card').filter({ hasText: 'Last source issue' })
  const first = page.locator(view === 'list' ? '.draggable-issue' : '.issue-card').filter({ hasText: 'First source issue' })
  await (view === 'list' ? last.locator('.issue-row') : last).press('Alt+ArrowUp')
  await last.dragTo(first, { targetPosition: { x: 30, y: 4 } })
  expect(writes).toBe(0)
  expect(await readFile(taskSource.file, 'utf8')).toBe(reorderTasks)
  const proposals = page.getByRole('region', { name: `Unverified proposals ${view === 'list' ? 'group' : 'column'}`, exact: true })
  await last.dragTo(proposals, { targetPosition: { x: 60, y: 20 } })
  await expect(proposals.getByText('Last source issue', { exact: true })).toBeVisible()
  expect(writes).toBe(1)
  const source = await readFile(taskSource.file, 'utf8')
  const metadata = [...source.matchAll(/<!-- hai:(.+) -->/g)].map(match => JSON.parse(match[1]))
  expect(metadata).toContainEqual(expect.objectContaining({ id: 'last-source', labels: ['Keep me'] }))
  await page.reload()
  await expect(proposals.getByText('Last source issue', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('backlog dependency violations show an error and leave source order intact', async ({ page, taskSource }) => {
  const source = reorderTasks.replace('- [*] Middle source issue\n', '- [*] Middle source issue\n  - Depends on: [1]\n')
  await writeFile(taskSource.file, source)
  await page.goto('/')
  const first = page.locator('.reorderable-issue').filter({ hasText: 'First source issue' })
  const last = page.locator('.reorderable-issue').filter({ hasText: 'Last source issue' })
  const lastBounds = await last.boundingBox()
  await first.dragTo(last, { targetPosition: { x: 30, y: lastBounds!.height - 4 } })
  await expect(page.getByRole('alert')).toContainText(/depend|before/i)
  await expect(page.locator('.reorderable-issue .issue-title')).toHaveText(['First source issue', 'Middle source issue', 'Last source issue'])
  expect(await readFile(taskSource.file, 'utf8')).toBe(source)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('an unavailable API stays visibly disconnected without loading demo issues', async ({ page }) => {
  await page.route('**/api/workspace', route => route.abort('connectionrefused'))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Cannot reach the TASKS.md server')
  await expect(page.locator('.issue-row')).toHaveCount(0)
  await expect(page.getByText('Source unavailable', { exact: true })).toBeVisible()
})

for (const repeatedConflict of [false, true]) test(`new issue ${repeatedConflict ? 'keeps its draft after a repeated conflict' : 'automatically refreshes and saves after an external change'}`, async ({ page, taskSource }) => {
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  await page.keyboard.press('c')
  const editor = page.getByRole('dialog', { name: 'New issue', exact: true })
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Keep the original draft')
  await editor.getByRole('textbox', { name: 'Description', exact: true }).fill('Original draft description\nwith details.')
  await editor.getByRole('combobox', { name: 'Section', exact: true }).selectOption('Ordered backlog')
  await editor.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high')
  await editor.getByRole('textbox', { name: 'Labels', exact: true }).fill('original-label')
  await writeFile(join(taskSource.directory, 'docs/tasks/1-first.md'), '# External description change\n')
  let attempts = 0
  await page.route('**/api/issues?*', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    attempts++
    if (repeatedConflict) return route.fulfill({ status: 412, json: { error: 'TASKS.md or a description changed. Reload before saving.' } })
    return route.fallback()
  })
  await editor.getByRole('button', { name: 'Create issue', exact: true }).click()
  if (repeatedConflict) {
    await expect(editor.getByRole('alert')).toContainText('description changed')
    await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Keep the original draft')
    await expect(editor.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Original draft description\nwith details.')
    await expect(editor.getByRole('textbox', { name: 'Labels', exact: true })).toHaveValue('original-label')
    await expect(editor.getByRole('combobox', { name: 'Section', exact: true })).toHaveValue('Ordered backlog')
    await expect(editor.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('high')
    expect(await readFile(taskSource.file, 'utf8')).toBe(initialTasks)
  } else {
    await expect(editor).not.toBeVisible()
    await expect(page.getByText('Keep the original draft', { exact: true })).toBeVisible()
    const source = await readFile(taskSource.file, 'utf8')
    expect(source.match(/Keep the original draft/g)).toHaveLength(1)
    expect(source).toContain('- [x] [*] Already accepted work')
    await page.getByText('Keep the original draft', { exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Original draft description\nwith details.')
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('high')
    await expect(page.getByRole('dialog').getByText('original-label', { exact: true })).toBeVisible()
  }
  expect(attempts).toBe(2)
  expect(await readFile(join(taskSource.directory, 'docs/tasks/1-first.md'), 'utf8')).toBe('# External description change\n')
})

test('automatic refresh reads external tracker and description edits without changing the view', async ({ page, taskSource }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Board view', exact: true }).click()
  const external = initialTasks.replace('First source issue', 'Automatically refreshed title')
  await writeFile(taskSource.file, external)
  await writeFile(join(taskSource.directory, 'docs/tasks/1-first.md'), 'Externally edited description')
  await page.clock.fastForward(5000)
  await expect(page.getByText('Automatically refreshed title', { exact: true })).toBeVisible()
  await expect(page.locator('.board')).toBeVisible()
  await page.getByText('Automatically refreshed title', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Externally edited description')
  expect(await readFile(taskSource.file, 'utf8')).toBe(external)
})

test('automatic refresh pauses for drafts and resumes after cancellation', async ({ page, taskSource }) => {
  await page.clock.install()
  await page.goto('/')
  await page.getByText('First source issue', { exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Keep my draft')
  const external = initialTasks.replace('First source issue', 'Changed during editing')
  await writeFile(taskSource.file, external)
  await page.clock.fastForward(15000)
  await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Keep my draft')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('TASKS.md or a description changed')
  expect(await readFile(taskSource.file, 'utf8')).toBe(external)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.clock.fastForward(5000)
  await expect(page.getByText('Changed during editing', { exact: true })).toBeVisible()
})

test('automatic refresh keeps the last workspace after a source error and recovers', async ({ page, taskSource }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  await rm(join(taskSource.directory, 'docs/tasks/1-first.md'))
  await page.clock.fastForward(5000)
  await expect(page.getByText('Source unavailable', { exact: true })).toBeVisible()
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  await writeFile(join(taskSource.directory, 'docs/tasks/1-first.md'), 'Restored description')
  await page.clock.fastForward(5000)
  await expect(page.getByText('Source unavailable', { exact: true })).toHaveCount(0)
  await page.getByText('First source issue', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Restored description')
})

test('automatic refresh waits while hidden and refreshes when returning to the tab', async ({ page, taskSource }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }))
  await writeFile(taskSource.file, initialTasks.replace('First source issue', 'Updated while hidden'))
  await page.clock.fastForward(15000)
  await expect(page.getByText('First source issue', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText('Updated while hidden', { exact: true })).toBeVisible()
})
