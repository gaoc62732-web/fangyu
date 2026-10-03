const base = process.env.UI_BASE_URL || 'http://localhost:5190';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const catalog = JSON.parse(await readFile('data/catalog/catalog.json', 'utf8'));
const output = resolve('data/generated/heritage-location-checks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() =>
  sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
);
page.setDefaultTimeout(25000);
let errors = 0,
  stage = 'initial';
page.on('pageerror', () => errors++);
const checks = [];
async function ready() {
  await page.waitForFunction(
    () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
  );
}
async function openEntry(key) {
  stage = key;
  const national = key.startsWith('vn-special-');
  const entry = catalog.entries.find((row) =>
    national
      ? row.sourceId === key && row.categoryId === 'vn-national-special-component'
      : row.componentKey === key && row.categoryId === 'world-heritage-component',
  );
  assert(entry, 'Expected current component ' + key);
  const scope = Object.keys(entry.topicRegions || {}).find((value) => value !== 'world');
  assert(scope, 'Expected a country topic for ' + key);
  await page.goto(base + '/#/' + scope);
  await ready();
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption('');
  await ready();
  if (national) {
    if ((await page.locator('.heritage-projects').getAttribute('open')) !== null)
      await page.locator('.heritage-projects > summary').click();
    if ((await page.locator('.national-heritage').getAttribute('open')) === null)
      await page.locator('.national-heritage > summary').click();
    const parent = catalog.entries.find((e) => e.id === entry.nationalHeritageParentId);
    assert(parent);
    await page.getByRole('searchbox', { name: '搜索越南特别遗迹' }).fill(parent.name);
    const group = page.locator('.national-heritage > details').filter({ hasText: parent.name });
    assert.equal(await group.count(), 1);
    if ((await group.getAttribute('open')) === null)
      await group.locator(':scope > summary').click();
    const row = group.locator(':scope > .entries > .entry').filter({
      has: page.getByText(entry.name, { exact: true }),
    });
    assert.equal(await row.count(), 1);
    return { entry, row };
  }
  if ((await page.locator('.heritage-projects').getAttribute('open')) === null)
    await page.locator('.heritage-projects > summary').click();
  const expectedProject = catalog.heritageProjects.find(
    (project) => project.unescoId === entry.heritageProjectId,
  );
  assert(expectedProject);
  await page.getByRole('searchbox', { name: '搜索世界遗产项目' }).fill(expectedProject.name);
  const project = page
    .locator('.heritage-projects > article > details')
    .filter({ has: page.getByText('#' + entry.heritageProjectId, { exact: true }) });
  if ((await project.getAttribute('open')) === null)
    await project.locator(':scope > summary').click();
  const row = project.locator(':scope > .entries > .entry').filter({
    has: page.getByText(entry.name, { exact: true }),
  });
  for (let pageIndex = 0; (await row.count()) === 0 && pageIndex < 60; pageIndex++) {
    const next = project
      .locator(':scope > .toolbar')
      .getByRole('button', { name: '下一页', exact: true });
    if (!(await next.count()) || !(await next.isEnabled())) break;
    await next.click();
  }
  assert.equal(await row.count(), 1, 'Expected visible row ' + key);
  return { entry, row };
}
try {
  for (const key of [
    '913:place:toshogu',
    '1569rev',
    '1319-001:place:geonwolleung',
    '307',
    '398rev',
    '344bis',
    '3bis',
    '874-177',
    '1246bis-001b',
    '1246bis-001h',
    '1246bis-001i',
    '875-012',
    '875-013',
    '874-432',
    '874-440',
    '874-464',
    '874-487',
    'vn-special-batch-05-item-11:component:den-kim-dang',
    'vn-special-batch-05-item-11:component:dinh-an-vu',
    'vn-special-batch-05-item-11:component:den-tran',
    'vn-special-batch-05-item-11:component:vo-mieu',
    'vn-special-batch-05-item-11:component:dinh-hien',
    'vn-special-batch-05-item-11:component:chua-hien',
    'vn-special-batch-05-item-11:component:dong-do-quang-hoi-thien-hau-cung',
    'vn-special-batch-05-item-08:component:den-ba-trieu',
    'vn-special-batch-16-item-03:component:den-da-hoa',
    'vn-special-batch-16-item-03:component:den-da-trach',
  ]) {
    const { entry, row } = await openEntry(key);
    assert(entry.coordinates && !entry.coordinateReferenceOnly && entry.ordinaryPointEligible);
    if (entry.coordinatePrecisionNote)
      assert(
        (await row.innerText()).includes(entry.coordinatePrecisionNote),
        'Coordinate method must be visible',
      );
    await row.getByRole('button', { name: '定位', exact: true }).click();
    await ready();
    await page.waitForFunction(([lon, lat]) => {
      const surface = document.querySelector('.map-surface');
      const center = (surface?.getAttribute('data-map-center') || '').split(',').map(Number);
      return (
        Math.abs(center[0] - lon) < 0.0001 &&
        Math.abs(center[1] - lat) < 0.0001 &&
        Number(surface?.getAttribute('data-map-zoom')) >= 13.9
      );
    }, entry.coordinates);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, key.replaceAll(':', '-') + '.png'),
      fullPage: true,
    });
    checks.push({
      key,
      result:
        'Verified entity reference focuses on its coordinates and shows available precision/method note',
    });
  }
  const chauvet = await openEntry('1426');
  assert.equal(chauvet.entry.accessibilityStatus, 'not-open-to-public');
  assert((await chauvet.row.innerText()).includes('原遗产地点不对公众开放'));
  assert.equal(
    await chauvet.row.getByRole('link', { name: '开放情况来源' }).getAttribute('href'),
    chauvet.entry.accessibilitySourceUrl,
  );
  await page.screenshot({ path: resolve(output, 'chauvet-original-not-open.png'), fullPage: true });
  checks.push({
    key: '1426',
    result: 'Original cave explicitly marked not open to the public with official source',
  });
  const forest = catalog.entries.find(
    (entry) => entry.heritageProjectId === '870' && entry.coordinateRole === 'area-reference',
  );
  assert(forest && !forest.coordinates && forest.coordinateReferenceOnly);
  const { row } = await openEntry(forest.componentKey);
  assert.equal(await row.getByRole('button', { name: '定位', exact: true }).count(), 0);
  await row.getByRole('button', { name: '查看所属地区', exact: true }).click();
  await ready();
  assert(Number(await page.locator('.map-surface').getAttribute('data-map-zoom')) < 12);
  await page.screenshot({ path: resolve(output, 'forest-area-reference.png'), fullPage: true });
  checks.push({
    key: forest.componentKey,
    result: 'Forest has region action, no ordinary point or close point focus',
  });
  for (const key of ['1246bis-001a', '1246bis-001f', '1246bis-001g', '874-463', '874-470']) {
    const { entry, row } = await openEntry(key);
    assert(entry.coordinateReferenceOnly && !entry.ordinaryPointEligible);
    assert.equal(await row.getByRole('button', { name: '定位', exact: true }).count(), 0);
    checks.push({
      key,
      result: 'Area or unresolved shared reference remains excluded from ordinary point focus',
    });
  }
  assert.equal(errors, 0);
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ version: catalog.version, checks, errors }, null, 2),
  );
  console.log(
    'PASS restored entity focus; independent temple focus; original cave accessibility; forest remains area-only; no page errors.',
  );
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failed.png'), fullPage: true });
  console.error(
    'FAIL heritage location ' +
      stage +
      ': ' +
      error.name +
      ' ' +
      String(error.message).split('\n')[0],
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
