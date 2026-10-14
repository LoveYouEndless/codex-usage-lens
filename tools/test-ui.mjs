import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { installLens, removeLens } from '../src/ui.mjs';
import { probePage } from '../src/compatibility.mjs';
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
      check((await page.evaluate(`(${probePage.toString()})()`)).state === 'supported',
        'Known desktop anchors pass the read-only compatibility check.');
      const first = await inject(page);
      check(first.buttons === 2, 'Each final reply has exactly one usage button.');
      await inject(page);
      check(await page.locator('.ul-row').count() === 2, 'Repeated injection is idempotent.');
      check(await page.locator('.actions > .ul-inline').count() === 2,
        'Usage follows native branch controls in the same action row when it fits.');
      check(await page.locator('.ul-inline').last().evaluate(node =>
        node.previousElementSibling.classList.contains('native-buttons')
        && node.nextElementSibling.hasAttribute('data-assistant-message-sent-time')),
      'Usage is placed after the branch control and before the timestamp.');
      await page.mouse.move(0, 0);
      check(await page.locator('.ul-button').last().evaluate(node =>
        getComputedStyle(node).borderTopWidth === '0px'
        && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'),
      'The idle usage button is borderless and transparent.');
      check(await page.locator('.ul-button svg').last().evaluate(node =>
        node.getBoundingClientRect().width === 14), 'The compact usage icon renders.');
      check(await page.locator('.ul-button').last().evaluate(node =>
        getComputedStyle(node).color === getComputedStyle(node.closest('.actions').querySelector('.native-buttons button')).color),
      'Usage text matches the native action color.');
      const historicalRow = page.locator('.ul-row').first();
      check(await historicalRow.evaluate(node => getComputedStyle(node).opacity === '0'),
        'Historical usage is hidden along with idle native controls.');
      await page.locator('.reply').first().hover();
      check(await historicalRow.evaluate(node => getComputedStyle(node).opacity === '1'),
        'Hovering the reply body reveals historical usage.');
      await page.mouse.move(0, 0);
      check(await historicalRow.evaluate(node => getComputedStyle(node).opacity === '0'),
        'Leaving the historical reply hides its usage again.');
      await page.locator('.ul-button').first().focus();
      check(await historicalRow.evaluate(node => getComputedStyle(node).opacity === '1'),
        'Keyboard focus reveals historical usage.');
      await page.locator('.ul-button').first().click();
      await page.mouse.move(0, 0);
      check(await historicalRow.evaluate(node => getComputedStyle(node).opacity === '1'),
        'An open historical detail panel keeps its trigger visible.');
      await page.keyboard.press('Escape');
      await page.locator('nav').evaluate(node => { node.tabIndex = -1; node.focus(); });
      check(await historicalRow.evaluate(node => getComputedStyle(node).opacity === '0'),
        'Historical usage hides after closing and moving focus away.');
      await page.locator('.ul-button').last().hover();
      check(await page.locator('.ul-button').last().evaluate(node =>
        getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)'),
      'Hovering Usage shows a subtle action background.');
      await page.locator('.ul-button').last().click();
      await page.mouse.move(0, 0);
      check(await page.locator('.ul-button').last().evaluate(node =>
        node.getAttribute('aria-expanded') === 'true'
        && getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)'),
      'The pressed background remains while details are open.');
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
      const checkboxBounds = await page.getByRole('checkbox').boundingBox();
      check(checkboxBounds.width >= 14 && checkboxBounds.height >= 14,
        'The checkbox remains visible despite a global input appearance reset.');
      check(await page.getByRole('checkbox').evaluate(node => getComputedStyle(node).appearance !== 'none'),
        'Native checkbox appearance is restored.');
      await page.getByRole('checkbox').check();
      check(await page.locator('.ul-meter').isVisible(), 'Session meter is optional and can be enabled.');
      await page.keyboard.press('Escape');
      check(!await page.locator('.ul-dialog').isVisible(), 'Escape closes the panel.');
      await page.locator('.ul-meter button').click();
      check(await page.locator('.ul-dialog').isVisible(), 'Clicking the draggable meter opens session details.');
      const meterButton = await page.locator('.ul-meter button').elementHandle();
      await page.waitForTimeout(2100);
      const updated = structuredClone(sample);
      updated.session.total.input += 100;
      updated.session.total.total += 100;
      updated.session.updatedAt = '2026-10-14T06:12:02Z';
      await inject(page, updated);
      await inject(page, updated);
      check(await meterButton.evaluate(node => node.isConnected),
        'Polling retains the meter anchor instead of replacing it.');
      check(await page.locator('.ul-dialog').isVisible(), 'Session details stay open through counter refreshes.');
      check((await page.locator('.ul-dialog').innerText()).includes('188,738'),
        'The open session panel updates its counters.');
      const meterBounds = await page.locator('.ul-meter').boundingBox();
      const sessionBounds = await page.locator('.ul-dialog').boundingBox();
      check(Math.min(Math.abs(sessionBounds.y - (meterBounds.y + meterBounds.height)),
        Math.abs(meterBounds.y - (sessionBounds.y + sessionBounds.height))) <= 4.1,
      'Session details stay four pixels from the outer meter edge.');
      await page.getByRole('radio', { name: 'M', exact: true }).focus();
      await inject(page, updated);
      check(await page.getByRole('radio', { name: 'M', exact: true }).evaluate(node =>
        node === document.activeElement), 'An unchanged poll preserves keyboard focus.');
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
      await page.evaluate(() => {
        const row = document.querySelector('.actions');
        row.style.width = '160px';
      });
      await inject(page);
      check(await page.locator('.ul-row').first().evaluate(node =>
        !node.classList.contains('ul-inline') && node.previousElementSibling.classList.contains('actions')),
      'An undersized action row falls back to a separate usage row.');
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
      check(await page.locator('[data-usage-lens-reply]').count() === 0, 'Stop also restores reply host attributes.');
      await page.setContent('<html><body><main>Future desktop interface</main></body></html>');
      check((await page.evaluate(`(${probePage.toString()})()`)).state === 'idle',
        'An empty or unknown page waits read-only without injecting guessed UI.');
      check(await page.locator('[data-usage-lens]').count() === 0,
        'Compatibility probing leaves unsupported interfaces unchanged.');
      await page.setContent('<html><body><span data-assistant-message-sent-time="true">14:12</span></body></html>');
      check((await page.evaluate(`(${probePage.toString()})()`)).state === 'unsupported-ui',
        'Incompatible reply anchors are explicitly rejected before injection.');
      check(!errors.length, `No browser errors: ${errors.join(', ')}`);
      await context.close();
    }
  }
  console.log(`UI checks passed: ${checks} (desktop/mobile, light/dark).`);
} finally { await browser.close(); }
