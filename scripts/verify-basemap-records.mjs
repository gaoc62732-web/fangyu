// Isolated browser profile; synthetic travel records. Never dump provider URLs or storage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const output = resolve(process.env.UI_OUTPUT || 'data/generated/basemap-records');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
let errors = 0,
  stage = 'load';
const results = [];
page.on('pageerror', () => errors++);
page.setDefaultTimeout(30000);
const settings = page.locator('.basemap-settings');
async function opened() {
  if ((await settings.getAttribute('open')) === null) await settings.locator('summary').click();
}
async function waitMap() {
  await page.waitForFunction(
    () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
  );
  await page.waitForTimeout(1500);
}
async function capture(name) {
  await waitMap();
  if ((await settings.getAttribute('open')) !== null) await settings.locator('summary').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const state = await page.locator('.inspector .state-select select').inputValue();
  assert.equal(state, 'arrived');
  const surface = page.locator('.map-surface');
  await surface.screenshot({ path: resolve(output, name + '.png') });
  results.push({
    name,
    state,
    mode: await surface.getAttribute('data-map-mode'),
    status: await page.locator('.tile-map-note').innerText(),
  });
}
try {
  await page.goto((process.env.UI_BASE_URL || 'http://localhost:5190') + '/#/china');
  await waitMap();
  const surface = page.locator('.map-surface');
  assert.equal(
    Number(await surface.getAttribute('data-visible-points')),
    0,
    'unvisited points must not crowd the first national view',
  );
  await surface.screenshot({ path: resolve(output, 'home-after.png') });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(500);
  const camera = await surface.getAttribute('data-map-center');
  const zoom = Number(await surface.getAttribute('data-map-zoom'));
  console.log('camera zoom', zoom);
  assert(zoom > 3.5, 'manual zoom applied');
  await opened();
  await page.getByRole('combobox', { name: '底图类型' }).selectOption('satellite');
  await waitMap();
  assert.equal(
    await surface.getAttribute('data-map-center'),
    camera,
    'switch preserves freely panned center',
  );
  assert(
    Math.abs(Number(await surface.getAttribute('data-map-zoom')) - zoom) < 0.001,
    'switch preserves manual zoom',
  );
  results.push({ name: 'free-camera-preserved', zoom });
  await page.getByRole('combobox', { name: '底图类型' }).selectOption('vector');
  await waitMap();
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption({ label: '北京市' });
  await page.getByRole('combobox', { name: '县区', exact: true }).selectOption({ label: '东城区' });
  await page.locator('.inspector .state-select select').selectOption('arrived');
  await page.getByRole('status').filter({ hasText: '已自动保存' }).waitFor();
  for (let round = 0; round < (process.env.POINTS_ONLY ? 0 : 2); round++) {
    for (const kind of ['vector', 'satellite', 'disabled']) {
      stage = kind + '-' + round;
      await opened();
      const enabled = page.getByRole('checkbox', { name: '启用天地图在线底图' });
      if (kind === 'disabled') await enabled.uncheck();
      else {
        if (await enabled.isDisabled())
          await page.getByRole('button', { name: '使用构建配置', exact: true }).click();
        await enabled.check();
        await page.getByRole('combobox', { name: '底图类型' }).selectOption(kind);
      }
      await capture(stage);
      await page.reload();
      await waitMap();
      await page
        .getByRole('combobox', { name: '地区', exact: true })
        .selectOption({ label: '北京市' });
      await page
        .getByRole('combobox', { name: '县区', exact: true })
        .selectOption({ label: '东城区' });
      await capture(stage + '-reload');
    }
  }
  stage = 'Taiwan points';
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption({ label: '台湾省' });
  await waitMap();
  assert(
    Number(await surface.getAttribute('data-visible-points')) >= 258,
    'existing Taiwan points remain available',
  );
  await page.getByRole('combobox', { name: '地图内容类别' }).selectOption('railway-station');
  await page.locator('.category-trigger').first().click();
  await page
    .locator('.category-directory .entry')
    .filter({ hasText: '台铁南港站' })
    .locator('input[type=checkbox]')
    .first()
    .check();
  await page.getByRole('status').filter({ hasText: '已自动保存' }).waitFor();
  await page.getByRole('combobox', { name: '地图内容类别' }).selectOption('');
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption('');
  await waitMap();
  assert.equal(
    Number(await surface.getAttribute('data-visible-points')),
    1,
    'visited point remains visible nationally',
  );
  for (const kind of ['vector', 'satellite', 'disabled']) {
    stage = 'point-' + kind;
    await opened();
    const enabled = page.getByRole('checkbox', { name: '启用天地图在线底图' });
    if (kind === 'disabled') await enabled.uncheck();
    else {
      await enabled.check();
      await page.getByRole('combobox', { name: '底图类型' }).selectOption(kind);
    }
    await waitMap();
    assert.equal(Number(await surface.getAttribute('data-visible-points')), 1);
    await page.reload();
    await waitMap();
    assert.equal(Number(await surface.getAttribute('data-visible-points')), 1);
  }
  await surface.screenshot({ path: resolve(output, 'visited-point-national.png') });
  results.push({
    name: 'Taiwan 258 points preserved; marked point survives modes and reload',
    visible: 1,
  });
  assert.equal(errors, 0);
  await writeFile(
    resolve(output, process.env.POINTS_ONLY ? 'results-points.json' : 'results.json'),
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(
    'PASS ' +
      (process.env.POINTS_ONLY ? 'point checks' : 'region and point checks') +
      '; camera preserved; first-view density; mode/reload persistence; screenshots saved.',
  );
} catch (e) {
  console.error(
    'FAIL basemap record stage: ' + stage + ' ' + e.name + ' ' + String(e.message).split('\n')[0],
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
