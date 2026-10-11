import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function createIssue(page: Page, title: string) {
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: 'New issue', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('A task created through the real UI.');
  await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high');
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

for (const trigger of ['button', 'keyboard']) test(`new issue focuses Title when opened by ${trigger}`, async ({ page }) => {
  await page.goto('/?backend=local');
  const button = page.getByRole('button', { name: 'New issue', exact: true });
  await expect(button).toBeVisible();
  for (let opening = 0; opening < 2; opening++) {
    if (trigger === 'button') await button.click();
    else await page.keyboard.press('c');
    const dialog = page.getByRole('dialog', { name: 'New issue', exact: true });
    const title = dialog.getByRole('textbox', { name: 'Title', exact: true });
    await expect(title).toBeFocused();
    await page.keyboard.type('Start typing immediately');
    await expect(title).toHaveValue('Start typing immediately');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    if (trigger === 'button') await expect(button).toBeFocused();
  }
});

for (const modifier of ['Control', 'Meta']) test(`${modifier}+Enter creates an issue from its description`, async ({ page }) => {
  await page.goto('/?backend=local');
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New issue', exact: true });
  const title = `Created with ${modifier}+Enter`;
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  const description = dialog.getByRole('textbox', { name: 'Description', exact: true });
  await description.fill('First line');
  await description.press('Enter');
  await description.press(`${modifier}+Enter`);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(1);
  await page.reload();
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('First line\n');
});

test('Ctrl+Enter validates the title and leaves ordinary Enter available for newlines', async ({ page }) => {
  await page.goto('/?backend=local');
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New issue', exact: true });
  const description = dialog.getByRole('textbox', { name: 'Description', exact: true });
  await description.fill('Draft');
  await description.press('Control+Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
  await expect(description).toHaveValue('Draft');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Valid title');
  await description.press('Enter');
  await expect(description).toHaveValue('Draft\n');
  await expect(dialog).toBeVisible();
  await description.press('Control+Enter');
  await expect(dialog).not.toBeVisible();
});

test('issue creation, editing, persistence, and deletion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?backend=local');
  await expect(page.getByRole('button', { name: 'All issues', exact: true })).toBeVisible();
  await createIssue(page, 'Verify release checklist');
  await page.getByText('Verify release checklist', { exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Verified release checklist');
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('in_progress');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByText('Verified release checklist', { exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('in_progress');
  await expect(dialog.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('high');
  await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('A task created through the real UI.');
  await dialog.getByRole('button', { name: 'Delete issue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByText('Verified release checklist', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Verified release checklist', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('canceling deletion restores Title focus and immediate typing', async ({ page }) => {
  await page.goto('/?backend=local');
  await expect(page.getByRole('button', { name: 'New issue', exact: true })).toBeVisible();
  await createIssue(page, 'Keep this issue');
  await page.getByText('Keep this issue', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete issue', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete issue', exact: true });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  const title = page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' updated');
  await expect(title).toHaveValue('Keep this issue updated');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.reload();
  await expect(page.getByText('Keep this issue updated', { exact: true })).toBeVisible();
});

test('keyboard search opens an issue and Escape restores the workspace', async ({ page }) => {
  await page.goto('/?backend=local');
  await expect(page.getByRole('button', { name: 'All issues', exact: true })).toBeVisible();
  await createIssue(page, 'Find this unique task');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog');
  await expect(search).toBeVisible();
  await search.getByRole('textbox').fill('Find this unique task');
  await search.getByText('Find this unique task', { exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Find this unique task');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('board moves persist and status filters select the same records', async ({ page }) => {
  await page.goto('/?backend=local');
  await expect(page.getByRole('button', { name: 'All issues', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const destination = page.getByRole('region', { name: 'In Progress column', exact: true });
  await page.locator('.issue-card').filter({ hasText: 'Add filtering by status and assignee' }).dragTo(destination, { targetPosition: { x: 70, y: 20 } });
  await expect(destination.getByText('Add filtering by status and assignee', { exact: true })).toBeVisible();
  await page.reload();
  await expect(destination.getByText('Add filtering by status and assignee', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.locator('.filter-menu summary').click();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('done');
  await page.locator('.filter-menu summary').click();
  await expect(page.getByText('Add filtering by status and assignee', { exact: true })).toHaveCount(0);
  await expect(page.locator('.issue-group')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByText('Add filtering by status and assignee', { exact: true })).toBeVisible();
});

test('corrupt storage is reported and preserved', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hai.workspace.v1', '{broken-json'));
  await page.goto('/?backend=local');
  await expect(page.getByRole('alert')).toContainText('Your stored data has been preserved');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('hai.workspace.v1'))).toBe('{broken-json');
});

test('desktop and mobile layout retain working navigation and creation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?backend=local');
  await expect(page.locator('.issue-row').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'All issues', exact: true }).click();
  await page.getByRole('button', { name: /New issue/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New issue', exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(390);
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Created on mobile');
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
  await expect(page.getByText('Created on mobile', { exact: true })).toBeVisible();
});

test('backup export and validated restore preserve the workspace on failure', async ({ page }) => {
  await page.goto('/?backend=local');
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  const original = await page.evaluate(() => localStorage.getItem('hai.workspace.v1'));
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const backupFile = await jsonDownload;
  const backup = JSON.parse(await readFile((await backupFile.path())!, 'utf8'));
  expect(backup).toEqual(JSON.parse(original!));
  const markdownDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export TASKS.md', exact: true }).click();
  const markdownFile = await markdownDownload;
  expect(markdownFile.suggestedFilename()).toBe('TASKS.md');
  expect(await readFile((await markdownFile.path())!, 'utf8')).toContain('- [x]');

  const input = page.getByLabel('Import JSON backup file', { exact: true });
  await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  const dialog = page.getByRole('dialog', { name: 'Restore workspace backup', exact: true });
  await dialog.getByRole('button', { name: 'Replace workspace', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('not valid JSON');
  expect(await page.evaluate(() => localStorage.getItem('hai.workspace.v1'))).toBe(original);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  backup.workspace.issues[0].title = 'Restored from a verified backup';
  await input.setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await dialog.getByRole('button', { name: 'Replace workspace', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'All issues', exact: true }).click();
  await expect(page.getByText('Restored from a verified backup', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Restored from a verified backup', { exact: true })).toBeVisible();
});

test('project, cycle, and activity views reflect workspace issues', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?backend=local');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('projects.png'), animations: 'disabled' });
  await page.locator('.project-card').filter({ hasText: 'Core experience' }).click();
  await expect(page.getByRole('heading', { name: 'Core experience', exact: true })).toBeVisible();
  await expect(page.getByText('Define a common adapter interface', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('board.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Cycles', exact: true }).click();
  await expect(page.locator('.cycle-card.selected')).toContainText('Cycle 12');
  await page.locator('.cycle-card').filter({ hasText: 'Cycle 13' }).click();
  await expect(page.locator('.issue-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(page.locator('.activity-item')).toHaveCount(20);
  await page.locator('.activity-item').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('issue.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  await expect(page.getByText('These backends are planned. Connection is not available yet.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('integrations.png'), animations: 'disabled' });
});
