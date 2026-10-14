import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { installLens, removeLens } from '../src/ui.mjs';
import { sample, fixtureHTML, otherId } from './fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const output = resolve('test-results');
await mkdir(output, { recursive: true });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function inject(page, data = sample) {
  return page.evaluate(`(${installLens.toString()})(${JSON.stringify(data)})`);
}
try {
  for (const viewport of [{ width: 1100, height: 800 }, { width: 390, height: 844 }]) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({ viewport, locale: 'zh-CN' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(fixtureHTML({ dark, language: 'zh-CN' }));
      const first = await inject(page);
      check(first.buttons === 2, 'Each final reply has exactly one usage button.');
      await inject(page);
      check(await page.locator('.ul-row').count() === 2, 'Repeated injection is idempotent.');
      await page.locator('.ul-button').last().click();
      check(await page.locator('.ul-dialog').isVisible(), 'Click opens the detail panel.');
      const bounds = await page.locator('.ul-dialog').boundingBox();
      check(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1
        && bounds.y + bounds.height <= viewport.height + 1, 'Popover fits the viewport.');
      const overflow = await page.locator('.ul-dialog').evaluate(node => node.scrollWidth > node.clientWidth);
      check(!overflow, 'Detail labels and values fit without horizontal overflow.');
      await page.screenshot({ path: resolve(output, `${viewport.width}-${dark ? 'dark' : 'light'}.png`) });
      if (viewport.width === 1100 && !dark) {
        await mkdir(resolve('assets'), { recursive: true });
        await page.screenshot({ path: resolve('assets', 'preview.png') });
      }
      await page.getByRole('radio', { name: '\u539f\u503c', exact: true }).click();
      check((await page.locator('.ul-dialog').innerText()).includes('113,798'), 'Raw mode renders exact token counts.');
      await page.getByRole('checkbox').check();
      check(await page.locator('.ul-meter').isVisible(), 'Session meter is optional and can be enabled.');
      await page.keyboard.press('Escape');
      check(!await page.locator('.ul-dialog').isVisible(), 'Escape closes the panel.');
      await page.locator('.ul-meter button').click();
      check(await page.locator('.ul-dialog').isVisible(), 'Clicking the draggable meter opens session details.');
      await page.keyboard.press('Escape');
      await page.locator('.ul-button').last().click();
      await page.locator('nav').click();
      check(!await page.locator('.ul-dialog').isVisible(), 'Outside click closes the panel.');
      await page.evaluate(() => {
        document.querySelector('main').style.transform = 'translateY(-3000px)';
        document.querySelector('.ul-button').click();
      });
      const offscreenBounds = await page.locator('.ul-dialog').boundingBox();
      check(offscreenBounds.y >= 0, 'An offscreen anchor cannot place the popup above the viewport.');
      await page.keyboard.press('Escape');
      await page.evaluate(() => { document.querySelector('main').style.transform = ''; });
      await page.evaluate(id => {
        document.querySelector('[data-app-action-sidebar-thread-active="true"]')
          .setAttribute('data-app-action-sidebar-thread-active', 'false');
        document.querySelector(`[data-app-action-sidebar-thread-id="local:${id}"]`)
          .setAttribute('data-app-action-sidebar-thread-active', 'true');
      }, otherId);
      await page.waitForTimeout(200);
      check(await page.locator('.ul-row').count() === 0, 'Switching sessions clears stale buttons immediately.');
      check(!await page.locator('.ul-meter').isVisible(), 'Switching sessions does not carry over the previous total.');
      await page.evaluate(`(${removeLens.toString()})()`);
      check(await page.locator('[data-usage-lens]').count() === 0, 'Stop removes all injected UI.');
      check(!errors.length, `No browser errors: ${errors.join(', ')}`);
      await context.close();
    }
  }
  console.log(`UI checks passed: ${checks} (desktop/mobile, light/dark).`);
} finally { await browser.close(); }
