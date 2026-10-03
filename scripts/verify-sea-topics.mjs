import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const output = resolve('data/generated/sea-topic-checks');
const catalog = JSON.parse(await readFile('data/catalog/catalog.json', 'utf8'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() =>
  sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
);
const page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [],
  checks = [];
let stage = 'navigation';
page.on('pageerror', (error) => errors.push(String(error)));
const ready = () =>
  page.waitForFunction(
    () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
  );
const shot = async (name) => {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
};
const noOverflow = async () =>
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    stage + ': overflow',
  );
const countryCard = (country) => page.locator('.country-cards [data-country="' + country + '"]');
try {
  await page.goto(base + '/#/china');
  await ready();
  assert.match(await page.locator('.app-version').innerText(), /0\.7\.1-dev/);
  const groups = {
    东亚: ['/china', '/japan', '/korea'],
    东南亚: ['/vietnam', '/indonesia', '/thailand', '/malay-region'],
    西欧: ['/germany', '/france', '/uk', '/italy', '/spain'],
    其他: ['/uzbekistan', '/usa'],
  };
  for (const [label, paths] of Object.entries(groups)) {
    const menu = page
      .locator('.nav-dropdown')
      .filter({ has: page.locator('summary').filter({ hasText: new RegExp('^' + label + '$') }) });
    const summary = menu.locator(':scope > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    for (const path of paths)
      await menu.locator('a[href="#' + path + '"]').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('open'), null, 'Escape closes ' + label);
  }
  checks.push('Four regional menus, correct membership, keyboard open/Escape');

  for (const [scope, count] of Object.entries({
    indonesia: 38,
    thailand: 77,
    malaysia: 16,
    singapore: 5,
    brunei: 4,
  })) {
    stage = scope;
    await page.goto(base + '/#/' + scope);
    await ready();
    const regions = catalog.regions.filter((region) => region.scope === scope);
    assert.equal(regions.length, count);
    assert.equal(
      await page.getByRole('combobox', { name: '地区', exact: true }).locator('option').count(),
      count + 1,
    );
    assert.equal(await page.locator('.map-surface').getAttribute('data-map-mode'), 'tiles');
    if (scope === 'singapore')
      assert(
        Number(await page.locator('.map-surface').getAttribute('data-map-zoom')) >= 8,
        'Small country should fit usefully, not retain large-country zoom cap',
      );
    assert(regions.every((region) => region.nameZh && region.nameEn && region.originalName));
    const sample = regions[0];
    for (const query of new Set([sample.nameZh, sample.nameEn, sample.originalName])) {
      await page.getByRole('searchbox', { name: '搜索目录' }).fill(query);
      await page.locator('.chip-list button').filter({ hasText: sample.name }).first().waitFor();
    }
    await page.getByRole('searchbox', { name: '搜索目录' }).fill('');
    await page.getByRole('combobox', { name: '地区', exact: true }).selectOption(sample.id);
    await ready();
    assert((await page.locator('.inspector > h2').innerText()).includes(sample.nameZh));
    if (scope === 'malaysia') {
      assert.equal(await page.locator('optgroup[label="州（13） · States"] option').count(), 13);
      assert.equal(
        await page
          .locator('optgroup[label="联邦直辖区（3） · Federal territories"] option')
          .count(),
        3,
      );
    }
    await page.getByRole('combobox', { name: '地区', exact: true }).selectOption('');
    if ((await page.locator('.topic-coverage').getAttribute('open')) === null)
      await page.locator('.topic-coverage > summary').click();
    assert((await page.locator('.topic-coverage').innerText()).includes('坐标'));
    await noOverflow();
    await shot(scope);
    checks.push({ scope, regions: count, map: 'tiles', search: 'Chinese/English/original' });
  }

  stage = 'verified temple focus';
  await page.goto(base + '/#/indonesia');
  await ready();
  await page.locator('.heritage-projects > summary').click();
  await page.getByRole('searchbox', { name: '搜索世界遗产项目' }).fill('592');
  await page.locator('.heritage-projects > article > details > summary').click();
  const temple = catalog.entries.find((entry) => entry.componentKey === '592-001');
  assert(temple?.coordinates);
  const templeRow = page
    .locator('.heritage-projects > article > details > .entries > .entry')
    .filter({ hasText: temple.name })
    .first();
  assert((await templeRow.innerText()).includes('未核实入口'));
  await templeRow.getByRole('button', { name: '定位', exact: true }).click();
  await ready();
  await page.waitForFunction((coordinates) => {
    const center = document
      .querySelector('.map-surface')
      ?.getAttribute('data-map-center')
      ?.split(',')
      .map(Number);
    return center && center.every((value, i) => Math.abs(value - coordinates[i]) < 0.0001);
  }, temple.coordinates);
  await shot('indonesia-temple-focus');
  checks.push(
    'Verified Borobudur reference point focuses on actual coordinates and retains non-entrance precision note',
  );

  stage = 'three-country statistics';
  await page.goto(base + '/#/malay-region?country=malaysia');
  await ready();
  const initialSingapore = await countryCard('singapore').innerText();
  const initialBrunei = await countryCard('brunei').innerText();
  const initialMalaysiaPlaces = (await countryCard('malaysia').innerText()).match(
    /地点记录\s*\d+\s*\/\s*\d+/,
  )?.[0];
  assert(initialMalaysiaPlaces);
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption({ index: 1 });
  await page.getByRole('combobox', { name: '旅行状态' }).selectOption('arrived');
  await page.waitForFunction(() =>
    document.querySelector('[data-country="malaysia"]')?.textContent.includes('1 / 16'),
  );
  await countryCard('singapore').click();
  await ready();
  assert.equal(await countryCard('singapore').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.country-cards .selected').count(), 1);
  assert.equal(
    await page.locator('.country-cards .router-link-active').count(),
    0,
    'Query-based country cards use selected country, not shared route activity',
  );
  assert.equal(await countryCard('singapore').innerText(), initialSingapore);
  assert.equal(await countryCard('brunei').innerText(), initialBrunei);
  await page.locator('.heritage-projects > summary').click();
  await page.getByRole('searchbox', { name: '搜索世界遗产项目' }).fill('no-match-xyz');
  await page.getByText('没有符合筛选的遗产项目，可清除搜索后继续查看。').waitFor();
  await page.getByRole('searchbox', { name: '搜索世界遗产项目' }).fill('');
  await page.locator('.heritage-projects > article > details > summary').first().click();
  const checkbox = page
    .locator('.heritage-projects > article > details > .entries > .entry input[type="checkbox"]')
    .first();
  await checkbox.check();
  await page.waitForFunction(() =>
    /地点记录\s*1\s*\//.test(
      document.querySelector('[data-country="singapore"]')?.textContent || '',
    ),
  );
  await checkbox.uncheck();
  await checkbox.check();
  await page.reload();
  await ready();
  assert.match(await countryCard('singapore').innerText(), /地点记录\s*1\s*\//);
  assert.match(await countryCard('malaysia').innerText(), /1\s*\/\s*16/);
  assert.equal(await countryCard('brunei').innerText(), initialBrunei);
  assert((await countryCard('malaysia').innerText()).includes(initialMalaysiaPlaces));
  await countryCard('brunei').click();
  await ready();
  assert.match(await countryCard('brunei').innerText(), /世界遗产\s*0\s*项/);
  assert.equal(await page.locator('.heritage-projects').count(), 0);
  await page.goBack();
  await ready();
  assert.equal(await countryCard('singapore').getAttribute('aria-current'), 'page');
  await shot('malay-region-records');
  checks.push(
    'Three countries independently browse/count/persist; no count leakage; component repeated marking; Brunei zero; browser back',
  );

  for (const width of [390, 768, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of ['/indonesia', '/thailand', '/malay-region?country=brunei']) {
      stage = route + '-' + width;
      await page.goto(base + '/#' + route);
      await ready();
      await noOverflow();
      await shot(stage.replace(/[^a-z0-9-]/g, '-'));
    }
  }
  checks.push('390/768/1920 layouts and maps');
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ version: catalog.version, base, checks, errors }, null, 2),
  );
  console.log(
    'PASS regional navigation; five new maps and bilingual search; independent three-country statistics and persistence; responsive layouts.',
  );
} catch (error) {
  await shot('failed-' + stage.replace(/[^a-z0-9-]/gi, '-'));
  console.error('FAIL', stage, error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
