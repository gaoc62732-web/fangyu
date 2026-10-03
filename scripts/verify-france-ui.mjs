import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const output = resolve('data/generated/france-ui-checks');
await mkdir(output, { recursive: true });
const catalog = JSON.parse(await readFile('data/catalog/catalog.json', 'utf8'));
const source = JSON.parse(
  await readFile('data/extensions/research/france-idf-paris-boundaries.json', 'utf8'),
);
const regions = catalog.regions.filter((r) => r.scope === 'france');
const idf = regions.find((r) => r.code === 'FR-IDF');
const paris = regions.find((r) => r.level === 2 && r.sourceCode === '75');
const district = regions.find((r) => r.sourceCode === '75101');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() =>
  sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
);
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [],
  checks = [];
let stage = 'start';
page.on('pageerror', (e) => errors.push(String(e)));
const surface = page.locator('.map-surface');
const ready = async (level) => {
  await page.waitForFunction((level) => {
    const el = document.querySelector('.map-surface');
    return (
      el?.getAttribute('aria-busy') === 'false' &&
      (!level || el.getAttribute('data-map-level') === level)
    );
  }, level);
  await page.waitForTimeout(350);
};
const selected = async (r) => {
  await page.waitForFunction(
    (name) => document.querySelector('.inspector > h2')?.textContent === name,
    r.name,
  );
  assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('region'), r.id);
};
const shot = async (name) => {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
};
const open = async (r) => {
  await page.goto(base + '/#/france' + (r ? '?region=' + r.id : ''));
  await ready(
    r?.level === 3 || r?.id === paris.id
      ? 'county'
      : r?.id === idf.id || r?.level === 2
        ? 'city'
        : 'province',
  );
};
const state = () => page.locator('.state-select select');
const stats = () => page.locator('.france-layer-statistics').innerText();
const back = () => page.getByRole('button', { name: '返回上一级', exact: true }).click();
const clickCoordinate = async ([lon, lat]) => {
  await surface.scrollIntoViewIfNeeded();
  const center = (await surface.getAttribute('data-map-center')).split(',').map(Number);
  const zoom = Number(await surface.getAttribute('data-map-zoom'));
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  const mercator = ([x, y]) => [
    (x + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + (y * Math.PI) / 360)) / Math.PI) / 2,
  ];
  const c = mercator(center),
    p = mercator([lon, lat]),
    scale = 512 * 2 ** zoom;
  await page.mouse.click(
    box.x + box.width / 2 + (p[0] - c[0]) * scale,
    box.y + box.height / 2 + (p[1] - c[1]) * scale,
  );
};
function inside([x, y], ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}
function interior(geometry) {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  const xs = ring.map((p) => p[0]),
    ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  for (const ratio of [0.5, 0.4, 0.6, 0.3, 0.7])
    for (const vertical of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const point = [minX + (maxX - minX) * ratio, minY + (maxY - minY) * vertical];
      if (inside(point, ring)) return point;
    }
  throw Error('No interior test point');
}
try {
  stage = 'map drill';
  await open();
  await page.getByRole('checkbox', { name: '显示点位', exact: true }).uncheck();
  assert.equal(
    await page.getByRole('combobox', { name: '地区', exact: true }).locator('option').count(),
    19,
  );
  assert.match(await stats(), /法国大区：已到访 0 \/ 18/);
  await clickCoordinate([2.35, 48.85]);
  await selected(idf);
  await ready('city');
  assert.equal(await page.locator('.child-region-list > button').count(), 8);
  await state().selectOption('arrived');
  assert.match(await stats(), /法国大区：已到访 1 \/ 18/);
  assert.match(await stats(), /法兰西岛省级单位：已到访 0 \/ 8/);
  await shot('idf-eight-departments');
  await clickCoordinate([2.35, 48.85]);
  await selected(paris);
  await ready('county');
  assert.equal(await state().inputValue(), 'unvisited');
  assert.equal(await page.locator('.child-region-list > button').count(), 20);
  assert.equal(
    await page.getByRole('combobox', { name: '巴黎市区', exact: true }).locator('option').count(),
    21,
  );
  assert.match(await page.locator('.france-drilldown').innerText(), /Paris Centre/);
  await shot('paris-twenty-arrondissements');
  checks.push(
    'Real map clicks France → Île-de-France → Paris; 18/8/20; parent visit does not populate children',
  );

  stage = 'twenty map polygons';
  for (const row of source.regions.filter((r) => r.level === 3)) {
    const r = regions.find((r) => r.sourceCode === row.code && r.level === 3);
    await clickCoordinate(interior(row.geometry));
    await selected(r);
    await ready('county');
    await back();
    await selected(paris);
    await ready('county');
  }
  checks.push('All 20 separate arrondissement polygons clickable, each returns to Paris');

  stage = 'independent records and history';
  await page.getByRole('combobox', { name: '巴黎市区', exact: true }).selectOption(district.id);
  await selected(district);
  await ready('county');
  await state().selectOption('resident');
  await state().selectOption('resident');
  assert.match(await stats(), /法兰西岛省级单位：已到访 0 \/ 8/);
  assert.match(await stats(), /巴黎市区：已到访 1 \/ 20/);
  await page.waitForTimeout(300);
  await page.reload();
  await ready('county');
  await selected(district);
  assert.equal(await state().inputValue(), 'resident');
  await back();
  await selected(paris);
  assert.equal(await state().inputValue(), 'unvisited');
  await back();
  await selected(idf);
  await ready('city');
  await page.goBack();
  await selected(paris);
  await ready('county');
  await page.goForward();
  await selected(idf);
  await ready('city');
  await back();
  await ready('province');
  checks.push(
    'Independent layer visits, repeated selection, reload persistence, parent return, browser back/forward',
  );

  stage = 'search and empty layers';
  for (const query of [district.nameZh, district.nameEn, district.originalName, 'Louvre']) {
    await page.getByRole('searchbox', { name: '搜索目录' }).fill(query);
    await page.locator('.chip-list button').filter({ hasText: district.name }).first().click();
    await selected(district);
    await ready('county');
  }
  assert.match(await page.locator('.france-drilldown').innerText(), /尚未分配到省或市区/);
  await page.getByRole('searchbox', { name: '搜索目录' }).fill('nonexistent-france-xyz');
  assert.equal(await page.locator('.chip-list button').count(), 0);
  await page.getByRole('searchbox', { name: '搜索目录' }).fill('');
  await page.getByRole('button', { name: '全部海外地区', exact: true }).click();
  await ready('province');
  assert(Number(await surface.getAttribute('data-map-zoom')) < 3);
  await page.getByRole('button', { name: '法国本土', exact: true }).click();
  await ready('province');
  checks.push(
    'Chinese/English/French/alias search, empty district entries, overseas/mainland reset from drilldown',
  );

  stage = 'responsive';
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await open(paris);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'overflow at ' + width,
    );
    await shot('paris-' + width);
  }
  checks.push('1440 / 768 / 390 widths without horizontal overflow');

  stage = 'achievements';
  await page.goto(base + '/#/achievements');
  await page
    .getByRole('navigation', { name: '成就系列', exact: true })
    .getByRole('button', { name: '行遍', exact: true })
    .click();
  await page.locator('.achievement-card').first().waitFor();
  await page.locator('.achievement-card').first().click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.goBack();
  await selected(paris);
  await ready('county');
  checks.push('Achievement dialog, Escape and browser return retain Paris drilldown');
  stage = 'canvas fallback';
  await page.route('**/map-manifest.json', (route) => route.abort());
  await page.reload();
  await ready('county');
  assert.equal(await surface.getAttribute('data-map-mode'), 'canvas');
  await back();
  await selected(idf);
  await ready('city');
  await page
    .getByRole('combobox', { name: '法兰西岛省级单位', exact: true })
    .selectOption(paris.id);
  await selected(paris);
  await ready('county');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  await (await download).saveAs(resolve(output, 'paris-fallback-export.png'));
  await shot('paris-canvas-fallback');
  checks.push('Canvas fallback preserves layers/navigation and PNG export');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  await shot('failure-' + stage.replaceAll(' ', '-'));
  console.error('FAILED', stage, error);
  throw error;
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      { base, stage, checks, errors, passed: checks.length === 7 && errors.length === 0 },
      null,
      2,
    ),
  );
  await browser.close();
}
