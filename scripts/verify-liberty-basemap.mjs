import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5193';
const output = resolve('data/generated/liberty-map-checks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'msedge',
  headless: true,
});
const report = { errors: [], responses: {}, screenshots: [], checks: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('response', (response) => {
    const url = response.url();
    const kind = url.includes('.pmtiles')
      ? 'boundary'
      : url.includes('tiles.openfreemap.org/planet/')
        ? 'basemap'
        : url.includes('/fonts/')
          ? 'font'
          : null;
    if (kind) {
      const key = `${kind}:${response.status()}`;
      report.responses[key] = (report.responses[key] || 0) + 1;
    }
  });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  async function capture(name) {
    await page.waitForFunction(
      () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(3000);
    assert.equal(await page.locator('.map-surface').getAttribute('data-map-mode'), 'tiles');
    assert.equal(await page.getByText('在线底图暂不可用。', { exact: true }).count(), 0);
    await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
    report.screenshots.push(name);
  }
  await page.goto(base + '/#/china');
  await capture('china');
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption({ label: '北京市' });
  await page.getByRole('combobox', { name: '县区', exact: true }).selectOption({ label: '东城区' });
  await capture('beijing-dongcheng');
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await page.waitForTimeout(220);
  }
  await capture('beijing-dongcheng-detail');
  await page.locator('.basemap-settings summary').click();
  assert.equal(await page.getByRole('combobox', { name: '底图类型' }).inputValue(), 'vector');
  const enabled = page.getByRole('checkbox', { name: '启用在线底图', exact: true });
  await enabled.uncheck();
  await page.waitForTimeout(1000);
  await enabled.check();
  await page.locator('.basemap-settings summary').click();
  await capture('basemap-restored');
  const state = page.locator('.inspector .state-select select');
  await state.selectOption('arrived');
  await capture('beijing-recorded');
  await page.locator('.basemap-settings summary').click();
  await enabled.uncheck();
  await enabled.check();
  await page.locator('.basemap-settings summary').click();
  assert.equal(await state.inputValue(), 'arrived', 'basemap changes preserve records');
  await state.selectOption('unvisited');
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption({ label: '浙江省' });
  await page.getByRole('combobox', { name: '地市', exact: true }).selectOption({ label: '杭州市' });
  await capture('hangzhou');
  await page.getByRole('combobox', { name: '县区', exact: true }).selectOption({ label: '上城区' });
  await capture('hangzhou-shangcheng');
  await page.getByRole('button', { name: '省级', exact: true }).click();
  await capture('zhejiang-province');
  await page.getByRole('button', { name: '县区', exact: true }).click();
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  await (await downloadWait).saveAs(resolve(output, 'boundaries-export.png'));
  assert(!requests.some((url) => url.includes('tianditu')));
  assert(!requests.some((url) => /\{key\}|%7Bkey%7D/.test(url)));
  assert(report.responses['basemap:200'] > 0, 'real OpenFreeMap vector tiles loaded');
  assert(report.responses['boundary:206'] > 0, 'boundary archive uses HTTP Range');
  assert.deepEqual(report.errors, []);
  report.checks.push(
    'Default Liberty, real vector tiles, boundary Range reads, county detail, toggle/re-enable, no TianDiTu or unresolved key requests',
  );
  report.checks.push(
    'Synthetic travel state survives basemap changes; Hangzhou city/county and Zhejiang province; boundary PNG export',
  );
  // Provider failure leaves local boundaries active and shows a retry control.
  const failed = await browser.newContext();
  await failed.route('https://tiles.openfreemap.org/**', (r) => r.abort());
  const failurePage = await failed.newPage();
  await failurePage.goto(base + '/#/china');
  await failurePage.getByText('在线底图暂不可用。', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await failurePage.locator('.map-surface').getAttribute('data-map-mode'), 'tiles');
  report.checks.push('Basemap failure keeps local boundary map');
  await failed.close();
} catch (error) {
  report.failure = error.message;
  if (page) {
    report.pageText = await page.locator('body').innerText();
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  }
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
