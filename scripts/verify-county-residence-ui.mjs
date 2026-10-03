import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const output = resolve('data/generated/county-residence-ui');
await mkdir(output, { recursive: true });
const catalog = JSON.parse(await readFile('data/catalog/catalog.json', 'utf8'));
const city = catalog.regions.find((r) => r.scope === 'china' && r.code === '330100');
const counties = catalog.regions.filter(
  (r) => r.parentId === city.id && r.level === 2 && !r.historical,
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() =>
  sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
);
const page = await context.newPage();
page.setDefaultTimeout(20000);
const checks = [],
  errors = [];
let stage = 'initial';
page.on('pageerror', (e) => errors.push(String(e)));
const ready = () =>
  page.waitForFunction(
    () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
  );
async function open(region) {
  await page.goto(base + '/#/china?region=' + region.id);
  await ready();
  await page.waitForFunction(
    (name) => document.querySelector('.inspector > h2')?.textContent === name,
    region.name,
  );
}
const state = () => page.locator('.state-select select');
async function effective(label) {
  await page.waitForFunction(
    (label) =>
      document
        .querySelector('.effective-visit-state')
        ?.textContent?.includes('地图与统计状态：' + label),
    label,
  );
}
async function shot(name) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
}
async function cityCount(expected) {
  await page.goto(base + '/#/maofen');
  const row = page.locator('.maofen-table-wrap tbody tr').filter({ hasText: '浙江省' });
  await row.waitFor();
  assert.match(await row.locator('td').nth(2).innerText(), new RegExp('^' + expected + ' /'));
}
try {
  stage = 'single county and map';
  await open(city);
  await state().selectOption('transit');
  await open(counties[0]);
  await state().selectOption('resident');
  await open(city);
  await effective('居住');
  assert.equal(await state().inputValue(), 'transit');
  assert.match(await page.locator('.effective-visit-state').innerText(), /手动记录保持为途经/);
  await page.getByRole('button', { name: '市州盟', exact: true }).click();
  await page.getByRole('checkbox', { name: '显示点位', exact: true }).uncheck();
  await page.waitForTimeout(500);
  const surface = page.locator('.map-surface');
  await surface.scrollIntoViewIfNeeded();
  const center = (await surface.getAttribute('data-map-center')).split(',').map(Number);
  const zoom = Number(await surface.getAttribute('data-map-zoom'));
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  const mercator = ([x, y]) => [
    (x + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + (y * Math.PI) / 360)) / Math.PI) / 2,
  ];
  const p = mercator([120.17, 30.25]),
    c = mercator(center),
    scale = 512 * 2 ** zoom;
  await page.mouse.move(
    box.x + box.width / 2 + (p[0] - c[0]) * scale,
    box.y + box.height / 2 + (p[1] - c[1]) * scale,
  );
  await page.locator('.map-hover-card').waitFor();
  assert.match(await page.locator('.map-hover-card').innerText(), /杭州市/);
  assert.match(await page.locator('.map-hover-card').innerText(), /居住/);
  await shot('hangzhou-derived-resident');
  await cityCount(1);
  checks.push(
    'County residence changes city effective status, map tooltip and city score; manual transit retained',
  );

  stage = 'multiple counties and downgrade';
  await open(counties[1]);
  await state().selectOption('shortstay');
  await open(counties[0]);
  await state().selectOption('unvisited');
  await open(city);
  await effective('短居');
  assert.equal(await state().inputValue(), 'transit');
  await open(counties[1]);
  await state().selectOption('unvisited');
  await open(city);
  await effective('途经');
  await cityCount(0);
  checks.push(
    'Two counties resolve resident above shortstay; clearing last residence restores manual transit and city statistics',
  );

  stage = 'manual city residence and undo';
  await open(city);
  await state().selectOption('resident');
  await open(counties[0]);
  await state().selectOption('shortstay');
  await state().selectOption('unvisited');
  await open(city);
  await effective('居住');
  assert.equal(await state().inputValue(), 'resident');
  await state().selectOption('transit');
  await open(counties[0]);
  await state().selectOption('resident');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await open(city);
  await effective('途经');
  await open(counties[0]);
  await state().selectOption('resident');
  await page.waitForTimeout(350);
  await page.reload();
  await ready();
  assert.equal(await state().inputValue(), 'resident');
  await open(city);
  await effective('居住');
  assert.equal(await state().inputValue(), 'transit');
  checks.push(
    'Manual city residence retained on county clearing; undo recomputes, reload preserves raw and derived states',
  );

  stage = 'mobile and achievement';
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await shot('hangzhou-derived-mobile');
  await page.goto(base + '/#/achievements');
  await page.locator('.quantity-hero').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.quantity-hero p strong')?.textContent === '1',
  );
  const quantity = Number(await page.locator('.quantity-hero p strong').innerText());
  assert.equal(
    quantity,
    1,
    'Existing quantity achievement counts county targets only; no added parent double-count',
  );
  await page.goBack();
  await ready();
  await effective('居住');
  assert.deepEqual(errors, []);
  checks.push(
    '390px layout, achievement quantity and browser return agree with city effective state',
  );
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  await shot('failure');
  console.error(stage, error);
  throw error;
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      { base, stage, passed: checks.length === 4 && errors.length === 0, checks, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
