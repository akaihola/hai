import { test as base, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTasksServer } from '../python-bridge.ts'
import { longWrappedTitle } from '../fixtures/tasks-markdown'

const tracker = (name: string) => `# ${name}

## Unverified proposals

## Ordered backlog

- [1] ${name} issue

## Scheduled

## In Progress

## Completed / Accepted

[1]: docs/tasks/1-issue.md

## Rules

Keep acceptance explicit.
`

const test = base.extend<{ projects: { first: string; second: string } }>({
  projects: [async ({ page }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'hai-projects-browser-'))
    const first = join(directory, 'first-project'), second = join(directory, 'second-project')
    for (const [path, name] of [[first, 'First'], [second, 'Second']]) {
      await mkdir(join(path, 'docs/tasks'), { recursive: true })
      await writeFile(join(path, 'TASKS.md'), tracker(name))
      await writeFile(join(path, 'docs/tasks/1-issue.md'), `# ${name} description\n`)
    }
    const server = createTasksServer({ tasksFile: join(first, 'TASKS.md'), distDir: resolve('dist'), allowedOrigins: ['http://127.0.0.1:5173'] })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start.')
    await page.route('**/api/**', async route => {
      const original = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${address.port}${original.pathname}${original.search}` }) })
    })
    try { await use({ first, second }) }
    finally {
      await page.unrouteAll({ behavior: 'wait' })
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }, { auto: true }],
})

test('switches projects, keeps edits and exports isolated, and remembers the selection', async ({ page, projects }, testInfo) => {
  await page.goto('/')
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
  await picker.getByRole('textbox', { name: 'Project path', exact: true }).fill(projects.second)
  await picker.getByRole('button', { name: 'Open project', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByText('Second issue', { exact: true })).toBeVisible()
  await expect(page.getByText('First issue', { exact: true })).toHaveCount(0)
  await expect(page.locator('.breadcrumb-workspace')).toHaveText('second-project')
  await page.screenshot({ path: testInfo.outputPath('project-desktop.png'), animations: 'disabled' })
  await page.getByText('Second issue', { exact: true }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('# Second description\n')
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Edited second issue')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(await readFile(join(projects.first, 'TASKS.md'), 'utf8')).toBe(tracker('First'))
  await page.reload()
  await expect(page.getByText('Edited second issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Integrations', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export TASKS.md', exact: true }).click()
  expect(await readFile((await (await downloadPromise).path())!, 'utf8')).toBe(await readFile(join(projects.second, 'TASKS.md'), 'utf8'))
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  await picker.getByRole('button', { name: 'Open first-project', exact: true }).click()
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await expect(page.getByText('Edited second issue', { exact: true })).toHaveCount(0)
})

test('mobile project picker reports missing trackers without losing the current project', async ({ page, projects }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
  await picker.getByRole('textbox', { name: 'Project path', exact: true }).fill(join(projects.second, 'missing'))
  await picker.getByRole('button', { name: 'Open project', exact: true }).click()
  await expect(picker.getByRole('alert')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('project-picker-mobile.png'), animations: 'disabled' })
  await picker.getByRole('textbox', { name: 'Project path', exact: true }).fill(join(projects.second, 'TASKS.md'))
  await picker.getByRole('button', { name: 'Open project', exact: true }).click()
  await expect(page.getByText('Second issue', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await readFile(join(projects.first, 'TASKS.md'), 'utf8')).toBe(tracker('First'))
})

test('an unavailable remembered project can be replaced without falling back to another tracker', async ({ page, projects }) => {
  await page.addInitScript(path => localStorage.setItem('hai:tasks-source', path), join(projects.second, 'missing'))
  await page.goto('/')
  await expect(page.getByText('First issue', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
  await picker.getByRole('textbox', { name: 'Project path', exact: true }).fill(projects.first)
  await picker.getByRole('button', { name: 'Open project', exact: true }).click()
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
})

test('opens and edits a project with a long wrapped task summary without truncation', async ({ page, projects }) => {
  const source = tracker('Second').replace('Second issue', longWrappedTitle)
  await writeFile(join(projects.second, 'TASKS.md'), source)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
  await picker.getByRole('textbox', { name: 'Project path', exact: true }).fill(projects.second)
  await picker.getByRole('button', { name: 'Open project', exact: true }).click()
  const title = longWrappedTitle.replaceAll('\n  ', ' ')
  await page.getByText(title, { exact: true }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title)
  await editor.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(await readFile(join(projects.second, 'TASKS.md'), 'utf8')).toContain(longWrappedTitle)
  await page.getByText(title, { exact: true }).click()
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill(`${title} Extra detail.`)
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await page.reload()
  await expect(page.getByText(`${title} Extra detail.`, { exact: true })).toBeVisible()
  expect(await readFile(join(projects.first, 'TASKS.md'), 'utf8')).toBe(tracker('First'))
})


test('all projects combines trackers, filters and searches, then edits the owning project', async ({ page, projects }, testInfo) => {
  await page.goto('/')
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'All projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'All projects', exact: true })).toBeVisible()
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await expect(page.getByText('Second issue', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create new issue', exact: true })).toBeDisabled()
  await expect(page.locator('[draggable="true"]')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Filter by project', exact: true }).selectOption(join(projects.second, 'TASKS.md'))
  await expect(page.getByText('First issue', { exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Filter by project', exact: true }).selectOption('')
  await page.getByRole('button', { name: /^Search/ }).click()
  await page.getByRole('textbox', { name: 'Search issues', exact: true }).fill('second-project')
  const search = page.getByRole('dialog', { name: 'Search workspace', exact: true })
  await expect(search.getByRole('button', { name: /Second issue/ })).toBeVisible()
  await expect(search.getByRole('button', { name: /First issue/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'All projects', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Board view', exact: true }).click()
  await expect(page.locator('.issue-card .source-label').filter({ hasText: 'second-project' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('all-projects-desktop.png'), animations: 'disabled' })
  await page.getByText('Second issue', { exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit [1]', exact: true })
  await expect(editor.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('# Second description\n')
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Changed owning project')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(await readFile(join(projects.first, 'TASKS.md'), 'utf8')).toBe(tracker('First'))
  expect(await readFile(join(projects.second, 'TASKS.md'), 'utf8')).toContain('Changed owning project')
  await page.getByRole('button', { name: 'All projects', exact: true }).click()
  await expect(page.getByText('Changed owning project', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
  await expect(picker.getByRole('heading', { name: 'Available projects', exact: true })).toBeVisible()
  await picker.getByRole('button', { name: 'Open first-project', exact: true }).click()
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await expect(page.getByText('Changed owning project', { exact: true })).toHaveCount(0)
})

test('mobile all projects retains source labels and reports incomplete views until refresh', async ({ page, projects }, testInfo) => {
  await rm(join(projects.second, 'docs/tasks/1-issue.md'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('button', { name: 'All projects', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Incomplete view: 1 projects')
  await expect(page.locator('.issue-row .source-label')).toHaveText('first-project')
  await writeFile(join(projects.second, 'docs/tasks/1-issue.md'), '# Repaired')
  await page.getByRole('button', { name: 'Refresh source', exact: true }).click()
  await expect(page.getByText('Second issue', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.issue-row .source-label').filter({ hasText: 'second-project' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('all-projects-mobile.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Board view', exact: true }).click()
  await expect(page.locator('.issue-card .source-label').filter({ hasText: 'second-project' })).toBeVisible()
})

test('finds and opens configured projects beyond eight recents on desktop and mobile', async ({ page, projects }) => {
  const root = resolve(projects.first, '..')
  for (let index = 0; index < 10; index++) {
    const path = join(root, `configured-${index}`)
    await mkdir(path)
    await writeFile(join(path, 'TASKS.md'), tracker(`Configured ${index}`).replace('- [1]', '- [*]').replace('[1]: docs/tasks/1-issue.md\n', ''))
  }
  await page.addInitScript(root => localStorage.setItem('hai:recent-projects', JSON.stringify(Array.from({ length: 8 }, (_, index) => ({ name: `configured-${index}`, path: `${root}/configured-${index}/TASKS.md` })))), root)
  await page.goto('/')
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  for (const mobile of [false, true]) {
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Open project', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
    await expect(picker.getByRole('textbox', { name: 'Find project', exact: true })).toBeFocused()
    await expect(picker.getByRole('button', { name: 'Open configured-9', exact: true })).toBeVisible()
    await expect(picker.locator('.recent-projects button')).toHaveCount(12)
    await picker.getByRole('textbox', { name: 'Find project', exact: true }).fill('NOT-A-PROJECT')
    await expect(picker.getByRole('status')).toHaveText('No matching projects.')
    await page.keyboard.press('Enter')
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('textbox', { name: 'Project path', exact: true })).toHaveValue('')
    await picker.getByRole('textbox', { name: 'Find project', exact: true }).fill(mobile ? `${root}/configured-8` : 'CONFIGURED-9')
    await expect(picker.locator('.recent-projects button')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(picker).toHaveCount(0)
    await expect(page.getByText(`Configured ${mobile ? 8 : 9} issue`, { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(await readFile(join(projects.first, 'TASKS.md'), 'utf8')).toBe(tracker('First'))
})

test('typing immediately filters projects and Enter opens the first visible match', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
  const search = picker.getByRole('textbox', { name: 'Find project', exact: true })
  await expect(search).toBeFocused()
  await page.keyboard.type('sec')
  await expect(search).toHaveValue('sec')
  await expect(picker.locator('.recent-projects button')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(picker).toHaveCount(0)
  await expect(page.getByText('Second issue', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  await expect(search).toBeFocused()
  await page.keyboard.type('project')
  await expect(picker.locator('.recent-projects button')).toHaveCount(2)
  const firstMatch = await picker.locator('.recent-projects button').first().getAttribute('aria-label')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.breadcrumb-workspace')).toHaveText(firstMatch!.replace('Open ', ''))
})

test('catalog failure preserves path switching and the current workspace', async ({ page, projects }) => {
  await page.route('**/api/projects*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Catalog unavailable.' }) }))
  await page.goto('/')
  await expect(page.getByText('First issue', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
  await expect(picker.getByRole('alert')).toContainText('Catalog unavailable.')
  await picker.getByRole('textbox', { name: 'Project path', exact: true }).fill(projects.second)
  await picker.getByRole('button', { name: 'Open project', exact: true }).click()
  await expect(page.getByText('Second issue', { exact: true })).toBeVisible()
})
