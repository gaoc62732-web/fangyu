const base = process.env.UI_BASE_URL || 'http://localhost:5190';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const catalog = JSON.parse(await readFile('data/catalog/catalog.json', 'utf8'));
const output = resolve('data/generated/vietnam-bilingual-checks');
await mkdir(output, { recursive: true });
const vietnam = catalog.entries.filter(
  (e) => e.countryCode === 'VNM' || e.topicRegions?.vietnam?.length,
);
assert(vietnam.length >= 319, 'Vietnam baseline entries must remain present');
assert(
  vietnam.every(
    (e) => e.nameZh && e.nameEn && e.originalName && e.aliases.includes(e.originalName),
  ),
);
assert.equal(
  catalog.regions.filter((r) => r.scope === 'vietnam' && r.nameZh && r.nameEn).length,
  34,
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() =>
  sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
);
page.setDefaultTimeout(25000);
let errors = 0;
const checks = [];
page.on('pageerror', () => errors++);
const ready = () =>
  page.waitForFunction(
    () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
  );
const shot = async (name) => {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
};
try {
  await page.goto(base + '/#/vietnam');
  await ready();
  assert((await page.locator('.page-heading h2').innerText()).includes('Vietnam'));
  const regions = page.getByRole('combobox', { name: '地区', exact: true });
  const optionNames = await regions.locator('option').allTextContents();
  assert.equal(optionNames.length, 35);
  assert(
    optionNames.slice(1).every((name) => /\p{Script=Han}/u.test(name) && /[A-Za-z]/.test(name)),
  );
  const hanoi = catalog.regions.find((r) => r.scope === 'vietnam' && r.nameZh.includes('河内'));
  assert(hanoi);
  await regions.selectOption(hanoi.id);
  await ready();
  assert((await page.locator('.inspector > h2').innerText()).includes('河内'));
  assert((await page.locator('.inspector > h2').innerText()).includes(hanoi.nameEn));
  await page.locator('.inspector > .original-name > summary').click();
  assert(
    (await page.locator('.inspector > .original-name').innerText()).includes(hanoi.originalName),
  );
  await shot('hanoi-bilingual');
  await regions.selectOption('');
  await ready();
  await page.locator('.national-heritage > summary').click();
  const search = page.getByRole('searchbox', { name: '搜索越南特别遗迹' });
  for (const query of ['独立宫', 'Independence Palace', 'Dinh Độc Lập', 'dinh doc lap']) {
    await search.fill(query);
    assert.equal(await page.locator('.national-heritage > details').count(), 1, query);
    assert(
      (await page.locator('.national-heritage > details > summary').innerText()).includes('独立宫'),
    );
  }
  const group = page.locator('.national-heritage > details');
  await group.locator(':scope > summary').click();
  const row = group.locator(':scope > .entries > .entry');
  assert.equal(await row.count(), 1);
  const palace = vietnam.find(
    (e) =>
      e.categoryId === 'vn-national-special-component' &&
      e.parentSourceId === 'vn-special-batch-01-item-10',
  );
  assert(palace && palace.coordinates);
  assert((await row.innerText()).includes(palace.nameEn));
  await row.locator('.original-name > summary').click();
  assert((await row.locator('.original-name').innerText()).includes(palace.originalName));
  await row.getByRole('button', { name: '定位', exact: true }).click();
  await ready();
  await page.waitForFunction(([lon, lat]) => {
    const center = (document.querySelector('.map-surface')?.getAttribute('data-map-center') || '')
      .split(',')
      .map(Number);
    return Math.abs(center[0] - lon) < 0.0001 && Math.abs(center[1] - lat) < 0.0001;
  }, palace.coordinates);
  await page.locator('.map-surface').scrollIntoViewIfNeeded();
  const box = await page.locator('.map-surface canvas').first().boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('tooltip').waitFor();
  const tooltip = await page.getByRole('tooltip').innerText();
  assert(tooltip.includes(palace.nameZh) && tooltip.includes(palace.nameEn));
  await page.screenshot({ path: resolve(output, 'palace-map-tooltip.png'), fullPage: true });
  await shot('palace-map-and-details');
  checks.push(
    '34 bilingual regions, original detail, Chinese/English/Vietnamese/accentless search, bilingual entity map tooltip',
  );
  await page.goto(base + '/#/vietnam');
  await ready();
  await regions.selectOption('');
  await ready();
  if ((await page.locator('.heritage-projects').getAttribute('open')) === null)
    await page.locator('.heritage-projects > summary').click();
  const heritageSearch = page.getByRole('searchbox', { name: '搜索世界遗产项目' });
  for (const query of ['胡朝', 'Citadel of the Ho Dynasty']) {
    await heritageSearch.fill(query);
    assert.equal(await page.locator('.heritage-projects > article').count(), 1);
  }
  await shot('heritage-bilingual');
  checks.push('UNESCO Chinese and English search');
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + '/#/vietnam');
    await ready();
    if ((await page.locator('.national-heritage').getAttribute('open')) === null)
      await page.locator('.national-heritage > summary').click();
    await search.fill('独立宫');
    const selectedGroup = page.locator('.national-heritage > details');
    if ((await selectedGroup.getAttribute('open')) === null)
      await selectedGroup.locator(':scope > summary').click();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Bilingual narrow-screen overflow',
    );
    await shot('vietnam-' + width);
  }
  checks.push('390px and 768px bilingual layout without overflow');
  assert.equal(errors, 0);
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      { version: catalog.version, translatedEntries: vietnam.length, checks, errors },
      null,
      2,
    ),
  );
  console.log(
    'PASS Vietnam bilingual catalogue coverage, regions, source names, multilingual search, map tooltip, detail and mobile layout.',
  );
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failed.png'), fullPage: true });
  console.error(
    'FAIL Vietnam bilingual: ' + error.name + ' ' + String(error.message).split('\n')[0],
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
