import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Only isolated synthetic snapshots and real UI actions; no existing profile or app hooks.
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const out = resolve(process.env.UI_OUTPUT || 'data/generated/history-temples-ui');
const fixtureDirectory = resolve('data/generated/history-temples-ui-fixture');
const fixturePath = resolve(fixtureDirectory, 'legacy.snapshot.json');
const catalogBytes = await readFile('data/catalog/catalog.json');
const catalog = JSON.parse(catalogBytes);
const chronologyBytes = await readFile(
  'packages/domain/src/achievement-chronology-data.ts',
  'utf8',
);
const compiled = ts.transpileModule(chronologyBytes, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { ACHIEVEMENT_CHRONOLOGY: chronology } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const history = catalog.achievements.definitions.filter((a) => a.section === 'history');
assert.equal(history.length, 24);
const rank = { legendary: 0, dated: 1, undated: 2 };
// Independent comparator, using explicit dates, never titles or completion.
const ordered = [...history].sort((a, b) => {
  const x = chronology[a.id],
    y = chronology[b.id];
  return (
    rank[x.kind] - rank[y.kind] ||
    (x.startYear ?? 0) - (y.startYear ?? 0) ||
    (x.endYear ?? 0) - (y.endYear ?? 0)
  );
});
const temple = history.find((a) => a.id === 'theme-chancellor');
assert.equal(temple.need, 8);
assert.equal(temple.targets.length, 8);
assert.deepEqual(
  temple.targets.slice(4).map((t) => t.label),
  ['陕西眉县', '云南保山市隆阳区', '甘肃礼县', '重庆奉节县'],
);
const oldIds = temple.targets.slice(0, 4).map((t) => t.regionIds[0]);
const newIds = temple.targets.slice(4).map((t) => {
  assert.equal(t.regionIds.length, 1);
  return t.regionIds[0];
});
const rejectedPoiIds = [
  '5fb39fb8-6a55-505a-a3e3-764a0ed9b6c8',
  'a9659daa-b155-5a9f-9e20-663abf1c7d5e',
  '4f195e9f-34c4-5aa5-99df-c0340a10414c',
];
assert(
  !catalog.entries.some((e) => rejectedPoiIds.includes(e.id)),
  'Optional unverified shrine proposals remain absent',
);
const snapshot = {
  format: 'fangyu-records',
  version: 1,
  catalogVersion: '2026-10-03.15',
  revision: 0,
  updatedAt: '2026-10-03T00:00:00.000Z',
  regions: Object.fromEntries(oldIds.map((id) => [id, 'arrived'])),
  entries: {},
  customEntries: [],
  preferences: { palette: 'jade', mapLevel: 'county' },
};
assert(catalog.compatibleCatalogVersions.includes(snapshot.catalogVersion));
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(fixturePath, JSON.stringify(snapshot, null, 2));
await writeFile(
  resolve(fixtureDirectory, 'fixture.json'),
  JSON.stringify(
    {
      purpose: 'Synthetic original four county visits; no shrine POI or personal records.',
      oldIds,
      newIds,
      expectedOldProgress: '4 / 8',
      expectedOrder: ordered.map((a) => ({ id: a.id, title: a.title, ...chronology[a.id] })),
      rejectedPoiIds,
    },
    null,
    2,
  ),
);
if (process.argv.includes('--fixture-only')) {
  console.log('Prepared history24 / temples8 synthetic fixture.');
  process.exit(0);
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
const result = {
  base,
  startedAt: new Date().toISOString(),
  catalogVersion: catalog.version,
  catalogSha256: sha(catalogBytes),
  fixtureSha256: sha(await readFile(fixturePath)),
  isolatedContext: true,
  actualUiImport: true,
  cases: [],
  errors: [],
  previews: [],
  limitations: [
    'Source links and their displayed basis are verified against explicit chronology data; this UI test does not re-audit historical scholarship.',
    'Old snapshot is a synthetic version-1/.15 backup, not personal travel history. County visits never assert visits to specific shrines.',
  ],
};
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const search = (page) => page.getByRole('searchbox', { name: '搜索成就', exact: true });
async function closeDialog(page) {
  if (await page.getByRole('button', { name: '关闭对话框', exact: true }).count())
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
}
async function historyPage(page) {
  // A same-document hash goto immediately after reload races initial router hydration.
  // Wait for the actual app navigation, then exercise its public UI link.
  await closeDialog(page);
  await page.getByRole('link', { name: '旅行成就', exact: true }).click();
  await page.waitForURL((url) => url.hash === '#/achievements');
  await closeDialog(page);
  await page.getByRole('button', { name: '历史人文', exact: true }).click();
  await page.locator('[data-history-order="chronological"]').waitFor();
  await search(page).fill('');
  await page.getByRole('combobox', { name: '成就状态', exact: true }).selectOption('');
  await page.getByRole('combobox', { name: '成就省份', exact: true }).selectOption('');
  await page.waitForTimeout(250);
}
async function collectCards(page) {
  const grid = page.locator('.virtual-grid-scroll');
  if (!(await grid.count())) return [];
  const rows = new Map();
  const height = await grid.evaluate((el) => el.scrollHeight);
  for (let top = 0; top <= height + 400; top += 350) {
    await grid.evaluate((el, top) => {
      el.scrollTop = top;
    }, top);
    await page.waitForTimeout(60);
    for (const row of await grid
      .locator('.virtual-grid-row')
      .evaluateAll((els) =>
        els.map((el) => ({
          top: parseFloat(el.style.top),
          cards: [...el.querySelectorAll('.achievement-card')].map((c) => ({
            title: c.querySelector('strong')?.textContent.trim(),
            label: c.querySelector('.achievement-chronology')?.textContent.trim(),
            basis: c.querySelector('.achievement-chronology')?.getAttribute('title'),
          })),
        })),
      ))
      rows.set(row.top, row.cards);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, cards]) => cards);
}
async function assertFullOrder(page) {
  const actual = await collectCards(page);
  assert.deepEqual(
    actual.map((x) => x.title),
    ordered.map((a) => a.title),
  );
  for (const [i, row] of actual.entries()) {
    assert.equal(row.label, chronology[ordered[i].id].label);
    assert.equal(row.basis, chronology[ordered[i].id].basis);
  }
  return actual;
}
async function openAchievement(page, a) {
  await closeDialog(page);
  await search(page).fill(a.title);
  await page
    .locator('.achievement-card')
    .filter({ has: page.locator('strong', { hasText: new RegExp(`^${a.title}$`) }) })
    .click();
  await page.getByRole('dialog', { name: a.title, exact: true }).waitFor();
  await page.locator('.detail-progress').waitFor();
}
async function templeProgress(page, n) {
  await page.waitForFunction(
    (n) => document.querySelector('.detail-progress')?.textContent.trim().startsWith(`${n} / 8`),
    n,
  );
  assert.equal(await page.locator('.achievement-target > span.marked').count(), n);
}
async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(70);
  const file = resolve(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
async function runCase(page, prefix, name, fn) {
  const row = { prefix, name, status: 'running' };
  result.cases.push(row);
  try {
    row.evidence = await fn();
    row.status = 'PASS';
  } catch (error) {
    row.status = 'FAIL';
    row.error = String(error);
    row.screenshot = await screenshot(page, `${prefix}-${name}-FAIL`).catch(() => null);
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2));
}
async function visitTarget(page, achievement, target) {
  await historyPage(page);
  await openAchievement(page, achievement);
  await page.getByRole('searchbox', { name: '搜索成就目标', exact: true }).fill(target.label);
  const row = page.locator('.achievement-target').filter({ hasText: target.label });
  await row.getByRole('button').first().click();
  await page.waitForURL(
    (url) => url.hash.includes('/china?') && url.hash.includes(target.regionIds[0]),
  );
  const select = page.locator('.inspector .state-select select');
  await select.waitFor();
  assert.equal(await select.inputValue(), 'unvisited');
  await select.selectOption('arrived');
  await page.waitForTimeout(250);
}
try {
  for (const size of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    if (process.env.UI_SIZE && process.env.UI_SIZE !== size.name) continue;
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      isMobile: size.name === 'mobile',
      hasTouch: size.name === 'mobile',
      deviceScaleFactor: 1,
      acceptDownloads: true,
    });
    await context.addInitScript(() =>
      sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
    );
    await context.route('**/local-records.json', (r) => r.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => result.errors.push({ prefix: size.name, error: String(e) }));
    try {
      await page.goto(`${base}/#/imports`);
      await page.locator('input[type=file][accept=".json,.xlsx"]').setInputFiles(fixturePath);
      await page.getByRole('button', { name: '备份并确认应用', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '已应用' }).waitFor();
      result.previews.push({
        prefix: size.name,
        footer: (await page.locator('body').innerText()).match(/开发预览[^\n]*/)?.[0],
      });
      await historyPage(page);
      await runCase(page, size.name, 'history-24-real-scroll-order-labels', async () => ({
        cards: await assertFullOrder(page),
        screenshot: await screenshot(page, `${size.name}-history-order`),
      }));
      await runCase(page, size.name, 'history-24-detail-source-links', async () => {
        const details = [];
        for (const a of ordered) {
          await openAchievement(page, a);
          const c = chronology[a.id],
            panel = page.locator('.chronology-detail');
          assert.equal((await panel.locator('strong').innerText()).trim(), c.label);
          assert.equal((await panel.locator('p').innerText()).trim(), c.basis);
          const links = await panel
            .locator('a')
            .evaluateAll((els) =>
              els.map((e) => ({
                title: e.textContent.trim(),
                url: e.getAttribute('href'),
                rel: e.rel,
              })),
            );
          assert.deepEqual(
            links.map(({ title, url }) => ({ title, url })),
            c.sources,
          );
          assert(links.every((l) => l.rel.includes('noopener')));
          details.push({ id: a.id, label: c.label, links });
          await closeDialog(page);
        }
        return details;
      });
      await runCase(page, size.name, 'search-retains-relative-chronology', async () => {
        await search(page).fill('唐');
        await page.waitForTimeout(250);
        const actual = await collectCards(page);
        assert(actual.length > 1 && actual.length < 24);
        const titles = new Set(actual.map((x) => x.title));
        assert.deepEqual(
          actual.map((x) => x.title),
          ordered.filter((a) => titles.has(a.title)).map((a) => a.title),
        );
        await search(page).fill('');
        await page.waitForTimeout(250);
        await assertFullOrder(page);
        return actual;
      });
      await runCase(
        page,
        size.name,
        'temple-old-four-of-eight-search-and-honest-detail',
        async () => {
          for (const t of temple.targets.slice(4)) {
            await closeDialog(page);
            await search(page).fill(t.label.replace(/^陕西|^云南保山市|^甘肃|^重庆/, ''));
            await page.waitForTimeout(100);
            assert(await page.locator('.achievement-card').filter({ hasText: '丞相祠堂' }).count());
          }
          await openAchievement(page, temple);
          await templeProgress(page, 4);
          assert.deepEqual(
            (await page.locator('.achievement-target > span').allTextContents()).map((t) =>
              t.trim().slice(2),
            ),
            temple.targets.map((t) => t.label),
          );
          const text = await page.getByRole('dialog').innerText();
          assert(text.includes('眉县具体祠庙待核') && text.includes('不代表具体祠庙已到访'));
          assert.deepEqual(
            await page
              .locator('.source-links a')
              .evaluateAll((els) => els.map((a) => a.getAttribute('href'))),
            temple.sources.map((s) => s.url),
          );
          for (const t of temple.targets) {
            await page.getByRole('searchbox', { name: '搜索成就目标', exact: true }).fill(t.label);
            assert.equal(await page.locator('.achievement-target').count(), 1);
          }
          await page.getByRole('searchbox', { name: '搜索成就目标', exact: true }).fill('');
          return {
            expected: '4 / 8',
            screenshot: await screenshot(page, `${size.name}-temple-old-four`),
          };
        },
      );
      await runCase(page, size.name, 'four-new-county-visits-undo-refresh-no-poi', async () => {
        const checkpoints = [];
        for (const [i, target] of temple.targets.slice(4).entries()) {
          await visitTarget(page, temple, target);
          await historyPage(page);
          await openAchievement(page, temple);
          await templeProgress(page, i + 5);
          checkpoints.push({ county: target.label, id: target.regionIds[0], count: i + 5 });
        }
        await closeDialog(page);
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await openAchievement(page, temple);
        await templeProgress(page, 7);
        await visitTarget(page, temple, temple.targets[7]);
        await page.reload();
        await historyPage(page);
        await openAchievement(page, temple);
        await templeProgress(page, 8);
        const image = await screenshot(page, `${size.name}-temple-eight-refreshed`);
        await closeDialog(page);
        await search(page).fill('');
        await assertFullOrder(page);
        await page.goto(`${base}/#/imports`);
        const wait = page.waitForEvent('download');
        await page.getByRole('button', { name: '导出 JSON 备份', exact: true }).click();
        const download = await wait,
          file = resolve(out, `${size.name}-county-only-export.snapshot.json`);
        await download.saveAs(file);
        const saved = JSON.parse(await readFile(file, 'utf8'));
        for (const id of [...oldIds, ...newIds]) assert.equal(saved.regions[id], 'arrived');
        assert.deepEqual(saved.entries, {});
        assert.deepEqual(saved.customEntries, []);
        return { checkpoints, undoCount: 7, refreshCount: 8, snapshot: file, screenshot: image };
      });
      await runCase(
        page,
        size.name,
        'modern-completion-never-reorders-and-mobile-layout',
        async () => {
          const modern = history.find((a) => a.id === 'theme-loushan');
          await visitTarget(page, modern, modern.targets[0]);
          await historyPage(page);
          await assertFullOrder(page);
          await openAchievement(page, modern);
          assert((await page.locator('.detail-progress').innerText()).includes('已完成'));
          await closeDialog(page);
          await page.getByRole('button', { name: '撤销', exact: true }).click();
          await search(page).fill('');
          await assertFullOrder(page);
          const dimensions = await page.evaluate(() => ({
            viewport: innerWidth,
            content: document.documentElement.scrollWidth,
          }));
          assert(dimensions.content <= dimensions.viewport + 1);
          return {
            dimensions,
            order: ordered.map((a) => a.id),
            screenshot: await screenshot(page, `${size.name}-final-order`),
          };
        },
      );
    } catch (error) {
      result.cases.push({ prefix: size.name, name: 'setup', status: 'FAIL', error: String(error) });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  result.finishedAt = new Date().toISOString();
  result.summary = {
    passed: result.cases.filter((c) => c.status === 'PASS').length,
    failed: result.cases.filter((c) => c.status === 'FAIL').length,
    pageErrors: result.errors.length,
  };
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.summary));
  if (result.summary.failed || result.errors.length) process.exitCode = 1;
}
