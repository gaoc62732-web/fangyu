import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const base = process.env.UI_BASE_URL || 'http://localhost:5190';
const output = resolve(process.env.UI_OUTPUT || 'data/generated/tiled-map-checks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [];
const check = (name, detail) => {
  checks.push({ name, detail });
  console.log('PASS', name, detail || '');
};
async function ready(page, mode) {
  await page.waitForFunction(
    (mode) => {
      const el = document.querySelector('.map-surface');
      return (
        el?.getAttribute('aria-busy') === 'false' &&
        el?.getAttribute('data-map-mode') === mode &&
        el.querySelector('canvas')
      );
    },
    mode,
    { timeout: 40000 },
  );
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() =>
    sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.goto(base + '/#/china');
  await ready(page, 'tiles');
  const first = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => ({ url: e.name, bytes: e.transferSize, duration: Math.round(e.duration) })),
  );
  assert(urls.some((u) => u.includes('/tiles/china/county/')));
  assert(
    !urls.some((u) =>
      /\/geometry\/|\/maps\/|\/catalog\.json(?:\?|$)|\/tiles\/china\/(province|city)\//.test(u),
    ),
  );
  assert(!urls.some((u) => !u.startsWith(base)));
  check(
    'first screen uses current-level local tiles and compressed catalog, no raw geometry or external requests',
    {
      bytes: first.reduce((s, r) => s + r.bytes, 0),
      requests: urls.length,
      tileRequests: urls.filter((u) => u.includes('/tiles/')).length,
    },
  );
  await page.screenshot({ path: resolve(output, 'tiles-home.png'), fullPage: true });
  const provinceResponse = page.waitForResponse(
    (r) => r.url().includes('/tiles/china/province/') && r.ok(),
  );
  await page.getByRole('button', { name: '省级', exact: true }).click();
  await provinceResponse;
  check('switching levels loads province tiles on demand');
  // Scan the canvas for a real feature tooltip, then click that exact feature.
  const canvas = page.locator('.map-surface canvas');
  const box = await canvas.boundingBox();
  let hit;
  for (const x of [0.35, 0.5, 0.65, 0.8]) {
    for (const y of [0.35, 0.5, 0.65]) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
      if (await page.getByRole('tooltip').count()) {
        hit = { x: box.x + box.width * x, y: box.y + box.height * y };
        break;
      }
    }
    if (hit) break;
  }
  assert(hit, 'rendered region is hit-testable');
  await page.mouse.click(hit.x, hit.y);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.setViewportSize({ width: 1000, height: 800 });
  await ready(page, 'tiles');
  await page.screenshot({ path: resolve(output, 'selected-resized.png'), fullPage: true });
  check('actual vector region hover/click, zoom and resize');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  const download = await downloadWait;
  const pngPath = resolve(output, 'export.png');
  await download.saveAs(pngPath);
  const png = await readFile(pngPath);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1600, 'export canvas initialized before drawing');
  assert.equal(png.readUInt32BE(20), 1160);
  assert(png.length > 10000);
  check('PNG export without an online provider', png.length);
  await context.close();
  for (const scenario of ['tile-failure', 'no-webgl', 'all-map-failure']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() =>
      sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
    );
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(scenario + ': ' + e));
    if (scenario === 'no-webgl')
      await p.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return /webgl/.test(type) ? null : original.call(this, type, ...args);
        };
      });
    else await p.route('**/tiles/**', (route) => route.abort());
    if (scenario === 'all-map-failure') await p.route('**/maps/**', (route) => route.abort());
    await p.goto(base + '/#/china');
    if (scenario === 'all-map-failure') {
      await p
        .getByText('地图暂时无法载入，请检查连接后重试。列表与已有记录仍可使用。', { exact: true })
        .waitFor();
      await p.unroute('**/tiles/**');
      await p.unroute('**/maps/**');
      await p.getByRole('button', { name: '重试地图', exact: true }).click();
      await ready(p, 'tiles');
    } else await ready(p, 'canvas');
    await p.screenshot({ path: resolve(output, scenario + '.png'), fullPage: true });
    check(
      scenario === 'all-map-failure'
        ? 'explicit failure message and successful retry'
        : scenario + ' falls back to working Canvas',
    );
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ checks, errors, firstScreenResources: first }, null, 2),
  );
} finally {
  await browser.close();
}
