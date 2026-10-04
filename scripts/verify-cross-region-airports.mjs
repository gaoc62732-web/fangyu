import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5198';
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'chrome',
  headless: true,
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base + '/#/records');
  await page.getByRole('combobox', { name: '类别' }).selectOption('airport');
  const search = page.getByRole('searchbox', { name: '搜索要素' });
  for (const airport of ['PEK北京首都', 'PKX北京大兴', 'LYA洛阳北郊', 'LPF六盘水月照']) {
    await search.fill(airport);
    const rows = page.locator('.entries > .entry');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 1, `${airport} should appear once`);
    assert.match(await rows.first().innerText(), /涉及 2 个政区/);
  }
  await search.fill('PKX北京大兴');
  const checkbox = page.locator('.entries > .entry input[type="checkbox"]').first();
  await checkbox.check();
  assert(await checkbox.isChecked(), 'Marking the grouped airport updates both entries');
  await page.reload();
  await page.getByRole('combobox', { name: '类别' }).selectOption('airport');
  await page.getByRole('searchbox', { name: '搜索要素' }).fill('PKX北京大兴');
  assert(await page.locator('.entries > .entry input[type="checkbox"]').first().isChecked());
  console.log('PASS four duplicated airports each display once; cross-city marking persists.');
} finally {
  await browser.close();
}
