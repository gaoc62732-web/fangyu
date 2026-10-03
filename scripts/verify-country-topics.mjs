const base = process.env.UI_BASE_URL || 'http://localhost:5190';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const output = resolve('data/generated/country-topic-checks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() =>
  sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
);
const catalog = JSON.parse(await readFile('data/catalog/catalog.json', 'utf8'));
const checks = [];
let errors = 0,
  stage = 'load';
page.on('pageerror', () => errors++);
page.setDefaultTimeout(25000);
async function ready() {
  await page.waitForFunction(
    () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
  );
}
async function shot(name) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
}
try {
  for (const [scope, count] of Object.entries({
    uzbekistan: 14,
    vietnam: 34,
    germany: 16,
    france: 18,
    italy: 20,
    uk: 92,
    usa: 51,
    spain: 19,
  })) {
    stage = scope;
    await page.goto(base + '/#/' + scope);
    await ready();
    assert.equal(
      await page.getByRole('combobox', { name: '地区', exact: true }).locator('option').count(),
      count + 1,
    );
    assert.equal(await page.locator('.map-surface').getAttribute('data-map-mode'), 'tiles');
    assert.equal(
      await page.locator('.heritage-projects').count(),
      1,
      'heritage available in every new country',
    );
    if (scope === 'france') {
      assert.equal(await page.locator('optgroup[label="法国本土（13）"] option').count(), 13);
      assert.equal(await page.locator('optgroup[label="海外地区层级（5）"] option').count(), 5);
      const zoom = Number(await page.locator('.map-surface').getAttribute('data-map-zoom'));
      await page.getByRole('button', { name: '全部海外地区', exact: true }).click();
      await ready();
      assert(Number(await page.locator('.map-surface').getAttribute('data-map-zoom')) < zoom);
      await page.getByRole('button', { name: '法国本土', exact: true }).click();
      await ready();
    }
    if ((await page.locator('.topic-coverage').getAttribute('open')) === null)
      await page.locator('.topic-coverage > summary').click();
    assert((await page.locator('.topic-coverage').innerText()).includes('坐标'));
    await page.getByRole('combobox', { name: '地区', exact: true }).selectOption({ index: 1 });
    await ready();
    assert.notEqual(await page.locator('.inspector > h2').innerText(), '');
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'horizontal overflow',
    );
    await shot(scope);
    checks.push({ scope, regions: count, map: 'tiles' });
  }
  stage = 'football';
  await page.goto(base + '/#/uk');
  await ready();
  await page.locator('.football-grounds > summary').click();
  await page.locator('.football-grounds > details > summary').first().click();
  const entry = page.locator('.football-grounds .entry').first();
  const arrival = entry.locator('input[type=checkbox]').nth(0),
    tour = entry.locator('input[type=checkbox]').nth(1),
    match = entry.locator('input[type=checkbox]').nth(2);
  await tour.check();
  assert.equal(await arrival.isChecked(), false);
  assert.equal(await match.isChecked(), false);
  await arrival.check();
  await arrival.uncheck();
  assert.equal(await tour.isChecked(), true);
  await shot('stadium-independent-records');
  await page.reload();
  await ready();
  await page.locator('.football-grounds > summary').click();
  await page.locator('.football-grounds > details > summary').first().click();
  assert.equal(await tour.isChecked(), true);
  assert.equal(await arrival.isChecked(), false);
  checks.push({ football: 'independent activities persist' });
  stage = 'heritage';
  await page.goto(base + '/#/korea');
  await ready();
  await page.locator('.heritage-projects > summary').click();
  await page
    .getByRole('searchbox', { name: '搜索世界遗产项目' })
    .fill(catalog.heritageProjects.find((p) => p.unescoId === '736').name);
  await page.locator('.heritage-projects > article > details > summary').click();
  assert.equal(
    await page.locator('.heritage-projects > article > details > .entries > .entry').count(),
    2,
  );
  await shot('korea-independent-components');
  checks.push({ heritage: '736 two independent places' });
  stage = 'heritage empty reset';
  await page.getByRole('searchbox', { name: '搜索世界遗产项目' }).fill('no-match-xyz');
  await page.getByText('没有符合筛选的遗产项目，可清除搜索后继续查看。').waitFor();
  await page
    .getByRole('searchbox', { name: '搜索世界遗产项目' })
    .fill(catalog.heritageProjects.find((p) => p.unescoId === '736').name);
  await page.locator('.heritage-projects > article').first().waitFor();
  assert.equal(await page.locator('.heritage-projects > article').count(), 1);
  stage = 'official groups and travel places';
  await page.goto(base + '/#/france');
  await ready();
  if ((await page.locator('.heritage-projects').getAttribute('open')) === null)
    await page.locator('.heritage-projects > summary').click();
  await page
    .getByRole('searchbox', { name: '搜索世界遗产项目' })
    .fill(catalog.heritageProjects.find((p) => p.unescoId === '1567').name);
  await page.locator('.heritage-projects > article > details > summary').click();
  const memorialText = await page.locator('.heritage-projects > article').innerText();
  assert.match(memorialText, /全球地点记录\s+0\s*\/\s*140/);
  assert.match(memorialText, /官方组成单元\s+0\s*\/\s*139/);
  assert(memorialText.includes('保留的旧记录（项目／组成单元）'));
  await shot('official-groups-and-travel-places');
  checks.push({
    heritage: '1567 preserves 139 official units and displays 140 independent places',
  });
  stage = 'vietnam components';
  await page.goto(base + '/#/vietnam');
  await ready();
  if ((await page.locator('.heritage-projects').getAttribute('open')) !== null)
    await page.locator('.heritage-projects > summary').click();
  await page.locator('.national-heritage > summary').click();
  await page.getByRole('searchbox', { name: '搜索越南特别遗迹' }).fill('Cố đô Huế');
  await page.locator('.national-heritage > details > summary').first().click();
  assert.equal(await page.locator('.national-heritage > details > .entries > .entry').count(), 14);
  await shot('vietnam-components');
  checks.push({ vietnam: 'Hue 14 independent components' });
  for (const [query, expectedCount, expectedLocatable, sourceId] of [
    ['Phù Đổng', 8, 0, 'vn-special-batch-04-item-09'],
    ['Hàng Gòn', 2, 2, 'vn-special-batch-06-item-02'],
    ['Phố Hiến', 17, 16, 'vn-special-batch-05-item-11'],
    ['Bà Triệu', 6, 1, 'vn-special-batch-05-item-08'],
    ['Chương Thiện', 2, 0, 'vn-special-batch-04-item-08'],
    ['Hồ Chí Minh', 4, 0, 'vn-special-batch-11-item-01'],
    ['Hiệp Hòa', 8, 0, 'vn-special-batch-11-item-02'],
    ['Tây Đằng', 1, 0, 'vn-special-batch-04-item-11'],
    ['Tân Trào', 12, 0, 'vn-special-batch-02-item-10'],
    ['Định Hóa', 12, 0, 'vn-special-batch-02-item-11'],
    ['Đa Hòa', 3, 2, 'vn-special-batch-16-item-03'],
    ['Điện Biên Phủ', 16, 0, 'vn-special-batch-01-item-09'],
    ['Trường Sơn', 18, 0, 'vn-special-batch-04-item-01'],
  ]) {
    stage = 'vietnam-new-components-' + query;
    await page.getByRole('searchbox', { name: '搜索越南特别遗迹' }).fill(query);
    const parent = catalog.entries.find(
      (entry) => entry.categoryId === 'vn-national-special' && entry.sourceId === sourceId,
    );
    assert(parent);
    const group = page.locator('.national-heritage > details').filter({ hasText: parent.name });
    assert.equal(await group.count(), 1);
    if ((await group.getAttribute('open')) === null)
      await group.locator(':scope > summary').click();
    const rows = group.locator(':scope > .entries > .entry');
    assert.equal(await rows.count(), expectedCount);
    const expectedReviewNotes = catalog.entries.filter(
      (e) => e.nationalHeritageParentId === parent.id && e.nameTranslationNeedsReview,
    ).length;
    assert.equal(await rows.locator('.name-review-note').count(), expectedReviewNotes);
    assert.equal(
      await rows.getByRole('button', { name: '定位', exact: true }).count(),
      expectedLocatable,
    );
    await group.locator(':scope > summary').scrollIntoViewIfNeeded();
    await shot('vietnam-new-components-' + sourceId);
    checks.push({ vietnam: query, namedComponents: expectedCount, locatable: expectedLocatable });
  }

  for (const scope of ['france', 'uk', 'vietnam']) {
    stage = scope + '-mobile';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/#/' + scope);
    await ready();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'horizontal overflow',
    );
    await shot(stage);
  }
  assert.equal(errors, 0);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(
    'PASS 8 maps/counts/navigation; stadium independent records/reload; heritage place grouping; 390px overflow; zero page errors.',
  );
} catch (e) {
  await shot('failed-' + stage);
  console.log(
    await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 8)
        .map((e) => ({
          tag: e.tagName,
          class: e.className,
          right: e.getBoundingClientRect().right,
        })),
    ),
  );
  console.error(
    'FAIL country topic stage ' + stage + ' ' + e.name + ' ' + String(e.message).split('\n')[0],
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
