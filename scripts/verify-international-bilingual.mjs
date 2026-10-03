const base = process.env.UI_BASE_URL || 'http://localhost:5190';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const catalog = JSON.parse(await readFile('data/catalog/catalog.json', 'utf8'));
const output = resolve('data/generated/international-bilingual-checks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() =>
  sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
);
page.setDefaultTimeout(25000);
let errors = 0,
  stage = 'start';
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
const airportCodes = {
  japan: 'HND',
  korea: 'ICN',
  uzbekistan: 'TAS',
  germany: 'FRA',
  france: 'CDG',
  italy: 'FCO',
  uk: 'LHR',
  usa: 'JFK',
  spain: 'MAD',
};
try {
  for (const [scope, code] of Object.entries(airportCodes)) {
    stage = scope + ' regions';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/#/' + scope);
    await ready();
    const regions = page.getByRole('combobox', { name: '地区', exact: true });
    const optionNames = await regions.locator('option').allTextContents();
    assert(
      optionNames.slice(1).every((name) => /\p{Script=Han}/u.test(name)),
      'Region has no Chinese: ' + scope,
    );
    await regions.selectOption({ index: 1 });
    await ready();
    assert(/\p{Script=Han}/u.test(await page.locator('.inspector > h2').innerText()));
    assert(
      await page.locator('.inspector').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      'Inspector overflow',
    );
    await regions.selectOption('');
    await ready();
    const category = page.locator('.map-content-controls select');
    await category.selectOption('airport');
    await ready();
    const airport = catalog.entries.find(
      (e) => e.categoryId === 'airport' && e.code === code && e.topicRegions?.[scope]?.length,
    );
    assert(airport?.nameZh && airport.nameEn, 'Missing bilingual sample airport ' + code);
    const query = page.getByPlaceholder('搜索政区、地点、别名或线路');
    for (const value of [airport.nameZh, airport.nameEn, airport.originalName]) {
      stage = scope + ' airport search ' + value;
      await query.fill(value);
      const toggle = page
        .locator('.category-directory .category-trigger')
        .filter({ hasText: '机场' })
        .first();
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      const row = page
        .locator('.category-directory .entry')
        .filter({ has: page.getByText(airport.name, { exact: true }) })
        .first();
      await row.waitFor();
      assert((await row.innerText()).includes(airport.nameEn));
    }
    let row = page
      .locator('.category-directory .entry')
      .filter({ has: page.getByText(airport.name, { exact: true }) })
      .first();
    await row.locator('.original-name > summary').click();
    assert((await row.locator('.original-name').innerText()).includes(airport.originalName));
    if (airport.coordinates) {
      await row.getByRole('button', { name: '定位', exact: true }).click();
      await ready();
      await page.waitForFunction(([lon, lat]) => {
        const c = (document.querySelector('.map-surface')?.getAttribute('data-map-center') || '')
          .split(',')
          .map(Number);
        return Math.abs(c[0] - lon) < 0.0001 && Math.abs(c[1] - lat) < 0.0001;
      }, airport.coordinates);
      await page.locator('.map-surface').scrollIntoViewIfNeeded();
      const box = await page.locator('.map-surface canvas').first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByRole('tooltip').waitFor();
      const text = await page.getByRole('tooltip').innerText();
      assert(
        text.includes(airport.nameZh) && text.includes(airport.nameEn),
        'Bilingual airport tooltip',
      );
      await page.screenshot({
        path: resolve(output, scope + '-airport-tooltip.png'),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Narrow screen overflow',
    );
    await shot(scope + '-390');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await regions.selectOption('');
    await query.fill('');
    await category.selectOption('');
    await ready();
    stage = scope + ' heritage names';
    const component = catalog.entries.find(
      (e) =>
        e.categoryId === 'world-heritage-component' && e.nameZh && e.topicRegions?.[scope]?.length,
    );
    assert(component);
    const project = catalog.heritageProjects.find(
      (p) => p.unescoId === component.heritageProjectId,
    );
    if ((await page.locator('.heritage-projects').getAttribute('open')) === null)
      await page.locator('.heritage-projects > summary').click();
    await page.getByRole('searchbox', { name: '搜索世界遗产项目' }).fill(project.name);
    const detail = page
      .locator('.heritage-projects > article > details')
      .filter({ has: page.getByText('#' + project.unescoId, { exact: true }) });
    if ((await detail.getAttribute('open')) === null)
      await detail.locator(':scope > summary').click();
    const heritageRow = detail
      .locator(':scope > .entries > .entry')
      .filter({ has: page.getByText(component.name, { exact: true }) });
    for (let n = 0; (await heritageRow.count()) === 0 && n < 80; n++) {
      const next = detail
        .locator(':scope > .toolbar')
        .getByRole('button', { name: '下一页', exact: true });
      if (!(await next.count()) || !(await next.isEnabled())) break;
      await next.click();
    }
    assert.equal(await heritageRow.count(), 1);
    assert((await heritageRow.innerText()).includes(component.nameZh));
    assert((await heritageRow.innerText()).includes(component.nameEn));
    await shot(scope + '-heritage');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.locator('.inspector').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      'Mobile heritage inspector overflow: ' + scope,
    );
    await shot(scope + '-heritage-390');
    await page.setViewportSize({ width: 1440, height: 1000 });
    checks.push({
      scope,
      airport: code,
      result:
        'Chinese region labels; Chinese/English/original airport searches; source detail; bilingual map tooltip; heritage names; 390px layout',
    });
  }
  const countryScopes = {
    'GB-ENG': 'uk',
    'GB-SCT': 'uk',
    DE: 'germany',
    FR: 'france',
    IT: 'italy',
    ES: 'spain',
  };
  for (const league of catalog.football.competitions) {
    stage = league.competitionId + ' club search';
    await page.goto(base + '/#/' + countryScopes[league.countryCode]);
    await ready();
    if ((await page.locator('.football-grounds').getAttribute('open')) === null)
      await page.locator('.football-grounds > summary').click();
    const club = league.clubs[0];
    assert(club.nameZh && club.nameEn);
    for (const value of [club.nameZh, club.nameEn, club.originalName]) {
      await page.getByRole('searchbox', { name: '搜索球队或球场' }).fill(value);
      const group = page
        .locator('.football-grounds > details')
        .filter({ hasText: club.name })
        .first();
      if ((await group.getAttribute('open')) === null)
        await group.locator(':scope > summary').click();
      assert((await group.innerText()).includes(club.nameEn));
      assert(/\p{Script=Han}/u.test(await group.locator('ul').innerText()));
    }
    await page.getByRole('searchbox', { name: '搜索球队或球场' }).fill('zzznomatch999');
    assert((await page.locator('.football-grounds').innerText()).includes('没有匹配'));
    await page.getByRole('searchbox', { name: '搜索球队或球场' }).fill(club.nameZh);
    const restored = page
      .locator('.football-grounds > details')
      .filter({ hasText: club.name })
      .first();
    if ((await restored.getAttribute('open')) === null)
      await restored.locator(':scope > summary').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert(
      await page.locator('.inspector').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      'Mobile football inspector overflow',
    );
    await shot(league.competitionId + '-390');
    await page.setViewportSize({ width: 1440, height: 1000 });
    checks.push({
      league: league.competitionId,
      result:
        'Club and venue bilingual relationship; three-language search; empty recovery; 390px layout',
    });
  }
  assert.equal(errors, 0);
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ version: catalog.version, checks, errors }, null, 2),
  );
  console.log(
    'PASS nine international topics and six football leagues: bilingual names, original details, multilingual search, tooltips and narrow screens.',
  );
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failed.png'), fullPage: true });
  console.error(
    'FAIL international bilingual [' +
      stage +
      ']: ' +
      error.name +
      ' ' +
      String(error.message).split('\n')[0],
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
