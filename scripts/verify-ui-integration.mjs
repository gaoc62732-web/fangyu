// Run against the local preview with an isolated browser profile and synthetic records.
// PLAYWRIGHT_MODULE may point to an existing Playwright index.mjs installation.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const base = process.env.UI_BASE_URL || 'http://localhost:5187';
const output = resolve(process.env.UI_OUTPUT || 'data/generated/ui-integration');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() =>
  sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
);
page.setDefaultTimeout(30000);
const errors = [];
const checks = [];
page.on('pageerror', (e) => errors.push(String(e)));
const check = (name, details = '') => {
  checks.push({ name, details });
  console.log('PASS', name, details);
};
const screenshot = (name) =>
  page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
const nav = (name) =>
  name === '中国'
    ? page.getByRole('navigation', { name: '主导航' }).locator('a[href="#/china"]')
    : page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });
const series = (name) =>
  page
    .getByRole('navigation', { name: '成就系列', exact: true })
    .getByRole('button', { name, exact: true });
const closeDialog = async () => {
  if (await page.getByRole('dialog').count())
    await page.getByRole('button', { name: '关闭对话框' }).click();
};
const waitMap = async () => {
  await page.locator('.map-surface canvas').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.map-surface')?.getAttribute('aria-busy') === 'false',
  );
};
const noOverflow = async () =>
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'horizontal overflow',
  );
try {
  await page.goto(base + '/#/china');
  await waitMap();
  await nav('旅行成就').waitFor();
  const homeStyle = await page.locator('.site-header').evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    background: getComputedStyle(el).backgroundColor,
  }));
  await screenshot('home-1440');
  await nav('旅行成就').click();
  await page.locator('.quantity-hero').waitFor();
  assert.match(await page.locator('.quantity-hero').innerText(), /0 个已到访/);
  assert.equal(await page.locator('.quantity-levels > div').count(), 19);
  assert.equal(
    await page
      .getByRole('navigation', { name: '成就系列', exact: true })
      .getByRole('button')
      .count(),
    9,
  );
  await page.evaluate(() => document.fonts.ready);
  await screenshot('achievements-quantity-1440');
  check('空记录、九系列、十九级称号与字体载入');
  for (const name of [
    '行遍',
    '满贯',
    '制霸',
    '历史人文',
    '政区趣味',
    '山河线路',
    '要素数量',
    '国际成就',
  ]) {
    await series(name).click();
    await page.locator('.achievement-card').first().waitFor();
    assert(
      (await page.locator('.achievement-card').count()) < 80,
      'virtualized grid must stay bounded',
    );
  }
  for (const button of await page
    .getByRole('navigation', { name: '国际成就系列' })
    .getByRole('button')
    .all()) {
    await button.click();
    await page.locator('.achievement-card').first().waitFor();
  }
  check('全部系列、国际五系列与虚拟卡片');
  await series('行遍').click();
  await page.getByRole('searchbox', { name: '搜索成就', exact: true }).fill('不存在的成就XYZ');
  await page.getByText('没有符合筛选的成就').waitFor();
  await screenshot('achievements-empty');
  await page.getByRole('searchbox', { name: '搜索成就', exact: true }).fill('');
  await page.getByRole('combobox', { name: '成就省份' }).selectOption({ label: '北京市' });
  const card = page.locator('.achievement-card').first();
  await card.dblclick();
  await page.locator('.achievement-target').first().waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1);
  await page.getByRole('searchbox', { name: '搜索成就目标' }).fill('无此目标XYZ');
  await page.getByText('没有符合筛选的目标。').waitFor();
  await page.getByRole('searchbox', { name: '搜索成就目标' }).fill('');
  await page.getByRole('combobox', { name: '目标状态' }).selectOption('todo');
  await screenshot('achievements-detail');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出目标', exact: true }).click();
  await (await download).saveAs(resolve(output, 'synthetic-achievement-targets.csv'));
  await page.locator('.achievement-target button').first().click();
  await waitMap();
  assert.match(page.url(), /#\/china\?region=/);
  await page.getByRole('link', { name: '返回旅行成就' }).waitFor();
  const selectedName = await page.locator('.inspector > h2').innerText();
  assert.notEqual(selectedName, '中国旅游手册');
  await page.getByRole('link', { name: '返回旅行成就' }).click();
  await page.getByRole('dialog').waitFor();
  await closeDialog();
  assert.equal(await series('行遍').getAttribute('aria-pressed'), 'true');
  assert.equal(
    await page.getByRole('combobox', { name: '成就省份' }).locator('option:checked').innerText(),
    '北京市',
  );
  check('搜索空态、省份筛选、重复点击、详情导出、地图定位与返回上下文', selectedName);
  await page.locator('.nav-dropdown > summary').filter({ hasText: '东亚' }).click();
  await nav('中国').click();
  await waitMap();
  assert.deepEqual(
    await page.locator('.site-header').evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      background: getComputedStyle(el).backgroundColor,
    })),
    homeStyle,
  );
  await page.getByRole('combobox', { name: '地区', exact: true }).selectOption({ label: '北京市' });
  await page.getByRole('combobox', { name: '县区', exact: true }).selectOption({ label: '东城区' });
  await page.locator('.inspector .state-select select').selectOption('arrived');
  await page.getByRole('status').filter({ hasText: '已自动保存' }).waitFor();
  await nav('旅行成就').click();
  await series('数量').click();
  await page.waitForFunction(
    () => document.querySelector('.quantity-hero p strong')?.textContent === '1',
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.quantity-hero p strong')?.textContent === '0',
  );
  check('合成到访记录实时更新成就、撤销同步、主页样式无污染');
  await page.getByRole('button', { name: '卯分明细', exact: true }).click();
  await page.getByRole('combobox', { name: '卯分排序' }).selectOption('ratio');
  const scoreDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
  await (await scoreDownload).saveAs(resolve(output, 'synthetic-score.csv'));
  await nav('点卯计算器').click();
  await page.locator('.maofen-summary').waitFor();
  check('成就卯分排序和导出、原独立点卯入口');
  await nav('旅行成就').click();
  await page.getByRole('button', { name: '成就图鉴', exact: true }).click();
  await series('要素数量').click();
  await page.locator('.achievement-card').first().click();
  await page.locator('.achievement-target').first().waitFor();
  assert.equal(await page.locator('.achievement-target').count(), 60);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.match(await page.getByRole('dialog').innerText(), /2 \/ /);
  await page.getByRole('combobox', { name: '目标状态' }).selectOption('done');
  await page.getByText('没有符合筛选的目标。').waitFor();
  assert(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled());
  await closeDialog();
  await series('国际成就').click();
  await page.getByRole('navigation', { name: '国际成就系列' }).getByRole('button').first().click();
  await screenshot('achievements-international');
  await page.locator('.achievement-card').first().click();
  await page.locator('.achievement-target button').first().click();
  await waitMap();
  assert.match(page.url(), /#\/world\?region=/);
  await page.getByRole('link', { name: '返回旅行成就' }).click();
  await page.getByRole('dialog').waitFor();
  await closeDialog();
  assert.equal(await series('国际成就').getAttribute('aria-pressed'), 'true');
  await page.locator('.nav-dropdown > summary').filter({ hasText: '东亚' }).click();
  await nav('中国').click();
  await waitMap();
  for (const country of ['日本专题 · Japan', '韩国专题 · South Korea']) {
    await page.locator('.nav-dropdown > summary').filter({ hasText: '东亚' }).click();
    await page.getByRole('link', { name: country, exact: true }).click();
    await waitMap();
    await page.getByRole('heading', { name: country, exact: true }).first().waitFor();
  }
  check('目标分页与筛选复位、国际成就世界地图往返、日韩原导航');
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await nav('旅行成就').click();
    await page.getByRole('button', { name: '成就图鉴', exact: true }).click();
    await series('行遍').click();
    await page.getByRole('combobox', { name: '成就省份' }).selectOption('');
    await page.locator('.achievement-card').first().waitFor();
    await noOverflow();
    await screenshot('achievements-flags-' + width);
    await page.locator('.nav-dropdown > summary').filter({ hasText: '东亚' }).click();
    await nav('中国').click();
    await waitMap();
    await noOverflow();
    await screenshot('home-' + width);
  }
  check('1280、1440、1920 和 390 宽度页面无横向溢出');
  await page.setViewportSize({ width: 1440, height: 900 });
  await nav('旅行成就').click();
  await page.getByRole('button', { name: '切换到夜间模式' }).click();
  await screenshot('achievements-dark');
  await page.locator('.achievement-card').first().click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert(
    await page
      .locator('.achievement-card')
      .first()
      .evaluate((el) => el === document.activeElement),
  );
  await page.goBack();
  await waitMap();
  await page.goForward();
  await page.locator('.achievement-card').first().waitFor();
  check('夜间模式、Escape 关闭与焦点恢复、浏览器后退前进');
  assert.deepEqual(errors, []);
  check('浏览器无未捕获运行时异常');
} catch (error) {
  await screenshot('failure');
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ base, checks, errors }, null, 2),
  );
  await browser.close();
}
