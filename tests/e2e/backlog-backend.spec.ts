import { test, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTasksServer } from '../python-bridge.ts'

test('docs/ workflow directories support state moves, edits, creation, deletion and all projects', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'hai-backlog-browser-'))
  const project = join(directory, 'hai'), repository = join(directory, 'nixos-config'), docs = join(repository, 'docs')
  for (const state of ['ideas', 'backlog', 'in-progress', 'completed', 'rejected']) {
    await mkdir(join(docs, state), { recursive: true })
    await writeFile(join(docs, state, 'README.md'), `# ${state}\n`)
  }
  const content = '# Install fonts\n\n## Context\n\nKeep this.\n\n## Acceptance Criteria\n\n- [ ] Fonts installed\n'
  await writeFile(join(docs, 'backlog/install-fonts.md'), content)
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'TASKS.md'), '# Tasks\n\n## Unverified proposals\n\n## Ordered backlog\n\n## Scheduled\n\n## In Progress\n\n## Completed / Accepted\n\n## Rules\n\nOnly users accept.\n')
  const server = createTasksServer({ tasksFile: join(project, 'TASKS.md'), distDir: resolve('dist'), allowedOrigins: ['http://127.0.0.1:5173'] })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start.')
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${address.port}${url.pathname}${url.search}` }) })
  })
  try {
    await page.setViewportSize({ width: 1920, height: 1000 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Open project', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Open project', exact: true })
    await picker.getByRole('button', { name: 'Open nixos-config / docs', exact: true }).click()
    await expect(page.getByRole('region', { name: 'backlog group', exact: true })).toContainText('Install fonts')
    await page.getByText('Install fonts', { exact: true }).click()
    const editor = page.getByRole('dialog')
    await expect(editor.getByRole('combobox', { name: 'Priority', exact: true })).toHaveCount(0)
    await expect(editor.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('backlog')
    await expect(editor.locator('.source-details')).toContainText('backlog/install-fonts.md')
    await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Install UI fonts')
    await editor.getByRole('combobox', { name: 'Status', exact: true }).selectOption('in-progress')
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect(await readdir(join(docs, 'backlog'))).toEqual(['README.md'])
    expect(await readFile(join(docs, 'in-progress/install-fonts.md'), 'utf8')).toBe(content.replace('# Install fonts', '# Install UI fonts'))
    await page.getByRole('button', { name: 'Board view', exact: true }).click()
    await page.getByRole('button', { name: /install-fonts.*Install UI fonts/ }).dragTo(page.getByRole('region', { name: 'completed column', exact: true }))
    await expect(page.getByRole('region', { name: 'completed column', exact: true })).toContainText('Install UI fonts')
    expect(await readdir(join(docs, 'completed'))).toEqual(['README.md', 'install-fonts.md'])
    await page.getByRole('button', { name: 'Add issue to ideas', exact: true }).click()
    await expect(editor.locator('.source-details')).toContainText(docs)
    await expect(editor.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('ideas')
    await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Rough idea')
    await editor.getByRole('button', { name: 'Create issue', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect(await readFile(join(docs, 'ideas/rough-idea.md'), 'utf8')).toBe('# Rough idea\n')
    await page.getByRole('button', { name: /rough-idea.*Rough idea/ }).click()
    await editor.getByRole('button', { name: 'Delete issue', exact: true }).click()
    await editor.getByRole('button', { name: 'Confirm delete', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect(await readdir(join(docs, 'ideas'))).toEqual(['README.md'])
    await page.reload()
    await expect(page.getByRole('region', { name: 'completed column', exact: true })).toContainText('Install UI fonts')
    await page.getByRole('button', { name: 'All projects', exact: true }).click()
    await expect(page.getByRole('region', { name: 'completed column', exact: true })).toContainText('Install UI fonts')
    await page.getByRole('button', { name: /install-fonts.*Install UI fonts/ }).click()
    await expect(editor.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('completed')
  } finally {
    await page.unrouteAll({ behavior: 'wait' })
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
