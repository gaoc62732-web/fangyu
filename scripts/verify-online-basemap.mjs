// Never log provider URLs, response bodies, browser console text, or environment values.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const output = resolve('data/generated/online-basemap-checks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const report = {
  providerResponses: {},
  providerFailures: 0,
  providerCancelled: 0,
  boundaryTiles: 0,
  pageErrors: 0,
  checkpoints: [],
};
function layer(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 't0.tianditu.gov.cn') return null;
    const kind = parsed.searchParams.get('T');
    return ['vec_w', 'cva_w', 'img_w', 'cia_w'].includes(kind) ? kind : 'other';
  } catch {
    return null;
  }
}
page.on('pageerror', () => report.pageErrors++);
page.on('requestfailed', (r) => {
  if (layer(r.url())) {
    if (r.failure()?.errorText === 'net::ERR_ABORTED') report.providerCancelled++;
    else report.providerFailures++;
  }
});
page.on('response', (r) => {
  const type = layer(r.url());
  if (type) {
    const mime = r.headers()['content-type'] || 'unspecified';
    const key = type + ':' + r.status() + ':' + (mime.startsWith('image/') ? 'image' : 'nonimage');
    report.providerResponses[key] = (report.providerResponses[key] || 0) + 1;
  } else if (r.url().includes('/tiles/') && r.ok()) report.boundaryTiles++;
});
async function checkpoint(name) {
  // Never capture the credential panel, even when fields happen to be empty.
  await page.locator('.basemap-settings').evaluate((details) => {
    details.open = false;
  });
  await page.waitForFunction(
    () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
    null,
    { timeout: 45000 },
  );
  await page.waitForTimeout(2000);
  report.checkpoints.push({
    name,
    mode: await page.locator('.map-surface').getAttribute('data-map-mode'),
    status: await page.locator('.tile-map-note').innerText(),
  });
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
}
try {
  await page.goto((process.env.UI_BASE_URL || 'http://localhost:5190') + '/#/china');
  await checkpoint('china');
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption({ label: '北京市' });
  await page.getByRole('combobox', { name: '县区', exact: true }).selectOption({ label: '东城区' });
  await checkpoint('beijing-dongcheng');
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await page.getByRole('button', { name: '选中范围', exact: true }).click();
  await checkpoint('controls');
  if (process.env.CHECK_SATELLITE === '1') {
    await page.locator('.basemap-settings summary').click();
    await page.getByRole('combobox', { name: '底图类型' }).selectOption('satellite');
    await checkpoint('beijing-satellite');
    const imageryOk = Object.keys(report.providerResponses).some((key) =>
      key.startsWith('img_w:200:image'),
    );
    const labelsOk = Object.keys(report.providerResponses).some((key) =>
      key.startsWith('cia_w:200:image'),
    );
    report.satelliteVerified =
      imageryOk && labelsOk && !report.checkpoints.at(-1).status.includes('不可用');
    if (!report.satelliteVerified) process.exitCode = 1;
    await page.locator('.basemap-settings summary').click();
    await page.getByRole('combobox', { name: '底图类型' }).selectOption('vector');
    await checkpoint('restored-vector');
  }
} catch {
  report.testFailure = 'Browser check incomplete; details suppressed to protect credentials.';
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
