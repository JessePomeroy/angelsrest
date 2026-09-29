import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.PUBLICATION_PREVIEW_URL ?? 'http://127.0.0.1:5218';
const evidence = process.env.PUBLICATION_EVIDENCE_DIR ?? '/tmp/angelsrest-publication-20260928';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
let renders = 0;
let interactions = 0;
const items = ['portfolio/demo-portfolio-1', 'products/demo-product-1', 'blog/posts/demo-post-1', 'blog/authors/demo-author-1', 'blog/categories/demo-category-1'];
try {
  for (const width of [390, 1440]) {
    for (const route of items) {
      for (const state of ['unpublished', 'published', 'changed']) {
        const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', request => ['GET', 'HEAD'].includes(request.request().method()) ? request.continue() : request.abort());
        await page.goto(`${base}/?route=/admin/editor/${route}&state=populated&theme=${width === 390 ? 'dark' : 'light'}&publication=${state}`);
        const control = page.locator('.publication-control');
        await control.waitFor();
        await expect(control.locator('.publication-status')).toHaveText(state === 'changed' ? 'published · draft changes' : state);
        const main = control.getByRole('button', { name: state === 'unpublished' ? 'publish' : state === 'published' ? 'unpublish' : 'publish changes', exact: true });
        await expect(main).toBeVisible();
        await expect(main).toBeEnabled();
        if (width === 390) {
          const header = await control.locator('xpath=ancestor::header').boundingBox();
          const group = await control.boundingBox();
          const status = await control.locator('.publication-status').boundingBox();
          const actions = await control.locator('.publication-actions').boundingBox();
          assert.ok(header && group && status && actions);
          assert.ok(Math.abs(group.x - header.x) <= 1 && Math.abs(group.width - header.width) <= 1, 'Mobile publishing control spans the header');
          assert.ok(status.y + status.height <= actions.y, 'Status sits above the action row');
          for (const saved of await page.locator('header [data-save-state="saved"], header [data-publication-save-state="saved"]').all()) await expect(saved).toBeHidden();
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, route);
        await expect(page.getByRole('button', { name: /show on site|hide from site|remove from shop/i })).toHaveCount(0);
        if (state === 'changed') {
          const more = control.locator('summary');
          await more.focus();
          await page.keyboard.press('Enter');
          await expect(control.getByRole('button', { name: 'unpublish', exact: true })).toBeVisible();
          const box = await control.locator('.publication-options-panel').boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width, 'Publishing options fit viewport');
          const actions = await control.locator('.publication-actions').boundingBox();
          assert.ok(actions && Math.abs(box.x - actions.x) <= 1 && Math.abs(box.width - actions.width) <= 1, 'Dropdown aligns with both edges of the action row');
          await page.keyboard.press('Escape');
          await expect(main).toBeFocused();
          await expect(control.getByRole('button', { name: 'unpublish', exact: true })).not.toBeVisible();
          await more.click();
          if (width === 390 && /^(portfolio|products|blog\/posts)/.test(route)) await page.screenshot({ path: `${evidence}/${route.split('/')[0]}-changed-mobile.png` });
          page.once('dialog', dialog => dialog.dismiss());
          await control.getByRole('button', { name: 'unpublish', exact: true }).click();
          await expect(control.locator('.publication-status')).toHaveText('published · draft changes');
          interactions++;
        }
        if (state === 'published') {
          page.once('dialog', dialog => dialog.accept());
          await main.click();
          await expect(page.getByRole('alert').filter({ hasText: /Simulated save failure|could not confirm/i })).toBeVisible({ timeout: 12000 });
          await expect(control.locator('.publication-status')).toHaveText('published');
          if (route.startsWith('products/')) await expect(main).toBeDisabled();
          else await expect(main).toBeEnabled();
          interactions++;
        }
        renders++;
        await page.close();
      }
    }
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?route=/admin/editor/portfolio/demo-portfolio-1&state=populated&theme=dark&publication=hidden`);
    await expect(page.locator('.publication-status')).toHaveText('unpublished');
    await expect(page.locator('.publication-control').getByRole('button', { name: 'publish', exact: true })).toBeEnabled();
    renders++;
    for (const route of ['', 'pages/about']) {
      await page.goto(`${base}/?route=/admin/editor${route ? `/${route}` : ""}&state=populated&theme=dark`);
      await expect(page.locator('.publication-status')).toHaveText('published');
      if (route === 'pages/about') {
        // The host deliberately reserves About publication for the operator.
        await expect(page.locator('.publication-control button')).toBeHidden();
      } else {
        await expect(page.locator('.publication-control').getByRole('button', { name: 'publish changes', exact: true })).toBeDisabled();
      }
      await expect(page.getByRole('button', { name: 'unpublish', exact: true })).toHaveCount(0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      renders++;
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/browser-verification.json`, JSON.stringify({ renders, interactions, errors, providerWrites: 'refused', widths: [390, 1440] }, null, 2));
  console.log(JSON.stringify({ renders, interactions, errors, evidence }));
} finally { await browser.close(); }
