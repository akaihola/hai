import { test as base, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTasksServer } from '../../server/http'

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
