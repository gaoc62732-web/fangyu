import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Fresh browser contexts + real UI restore, never an existing user profile.
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const out = resolve(process.env.UI_OUTPUT || 'data/generated/world-map-ui');
const fixtureDirectory = resolve('data/generated/world-map-ui-fixture');
const fixturePath = resolve(fixtureDirectory, 'legacy.snapshot.json');
// Rebuild the isolated fixture from stable existing IDs; no catalog mutation.
const catalog = JSON.parse(await readFile('data/catalog/catalog.json', 'utf8'));
assert(catalog.compatibleCatalogVersions.includes('2026-10-03.14'));
const ids = {
  cdg: '1504c34c-01ad-5502-a81b-79b4631a42fc',
  ory: 'da4b3e5a-081b-5a9d-a55b-fd05ddb6b8fb',
  nrt: '189ab1f2-1214-5c13-a55e-f732fb375974',
  sharedAlias: 'cae71a0d-5c5d-5784-aafc-58c3582352b8',
  franceComponent: 'ea5b284d-ca55-5081-bedb-5984ace47306',
  japanComponent: '442dc303-0107-50e4-9a0c-8b836a6e4796',
  project: '9205c4e7-13d6-5626-ac77-818a839cc7c5',
};
const legacy = {
  format: 'fangyu-records',
  version: 1,
  catalogVersion: '2026-10-03.14',
  revision: 0,
  updatedAt: '2026-10-03T00:00:00.000Z',
  regions: {},
  entries: {},
  customEntries: [],
  preferences: { palette: 'jade', mapLevel: 'county' },
};
const fixture = {
  purpose:
    'Synthetic old-shape snapshot; no historical or personal travel claims. Existing catalog locations only.',
  catalogVersion: catalog.version,
  cases: {},
  negativeUnvisited: catalog.entries.find(
    (e) => e.scope === 'world' && e.categoryId === 'airport' && e.code === 'HND',
  ),
  aliases: [],
  expected: { world: 7, airports: 4, heritage: 3, france: 3, japan: 2, malaysia: 1 },
  countryIds: {},
};
for (const [role, id] of Object.entries(ids)) {
  const entry = catalog.entries.find((e) => e.id === id);
  assert(
    entry && entry.scope === 'world' && entry.coordinates,
    `Existing world fixture identity/location: ${role}`,
  );
  const name = role === 'sharedAlias' ? 'Synthetic shared MFK record' : entry.name;
  const note = `Synthetic world-layer fixture ${role}; not a real travel record.`;
  legacy.entries[entry.recordId] = { visited: true, subitemIds: [], note };
  if (role === 'sharedAlias') legacy.entries[entry.recordId].name = name;
  fixture.cases[role] = {
    ...Object.fromEntries(
      ['id', 'recordId', 'categoryId', 'countryCode', 'coordinates', 'code'].map((key) => [
        key,
        entry[key] ?? null,
      ]),
    ),
    name,
    note,
  };
  if (role === 'sharedAlias')
    fixture.aliases = catalog.entries
      .filter((e) => e.recordId === entry.recordId)
      .map((e) =>
        Object.fromEntries(['id', 'recordId', 'scope', 'name'].map((key) => [key, e[key] ?? null])),
      );
  if (['FRA', 'JPN', 'MYS'].includes(entry.countryCode))
    fixture.countryIds[entry.countryCode] = entry.regionIds[0];
}
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(fixturePath, JSON.stringify(legacy, null, 2));
await writeFile(resolve(fixtureDirectory, 'fixture.json'), JSON.stringify(fixture, null, 2));
if (process.argv.includes('--fixture-only')) {
  console.log('Prepared synthetic world UI fixture.');
  process.exit(0);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const result = {
  base,
  startedAt: new Date().toISOString(),
  fixtureSha256: sha(await readFile(fixturePath)),
  isolatedContext: true,
  actualUiImport: true,
  cases: [],
  errors: [],
  observedPreviews: [],
  limitations: [
    'Old snapshot is synthetic version-1/.14-compatible shape without mapLayers, not a personal historical backup.',
    'World aliases retain the existing recordID; no catalog geometry or identity was injected.',
  ],
};
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let serial = 0;
async function ready(page, mode) {
  await page.waitForFunction(
    (mode) => {
      const host = document.querySelector('.map-surface');
      return (
        host?.getAttribute('aria-busy') === 'false' &&
        host.dataset.mapMode === mode &&
        host.querySelector('canvas')
      );
    },
    mode,
    { timeout: 45000 },
  );
  await page.waitForTimeout(500);
}
async function openRoute(page, route, mode) {
  await page.goto(`${base}/#/${route}`);
  await ready(page, mode);
}
const layers = (page) => page.locator('.visited-map-layers');
const toggle = (page, name) => layers(page).getByRole('checkbox', { name, exact: true });
const summary = async (page) =>
  (await page.locator('.visited-layer-summary').innerText()).replace(/\s+/g, ' ');
async function assertMapped(page, count, omitted) {
  await page.waitForFunction(
    ({ count, omitted }) => {
      const t = document.querySelector('.visited-layer-summary')?.textContent || '';
      return (
        t.includes(`可定位 ${count} 条`) &&
        (omitted === undefined || t.includes(`暂不能定位 ${omitted} 条`))
      );
    },
    { count, omitted },
  );
}
async function openList(page) {
  const details = page.locator('.visited-marker-list');
  if (!(await details.evaluate((e) => e.open))) await details.locator('summary').click();
}
async function choose(page, name) {
  await openList(page);
  await page.locator('.visited-marker-buttons').getByRole('button', { name, exact: false }).click();
  await page.locator('.visited-map-selection').waitFor();
  await page.waitForTimeout(450);
}
async function canvasBox(page) {
  const canvas = page.locator('.map-surface canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox();
  assert(b && b.width > 50 && b.height > 50);
  return b;
}
async function centerClick(page, touch) {
  const b = await canvasBox(page);
  if (touch) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
async function waitForMarkerCamera(page, marker, mode) {
  // A fixed 450 ms delay can expire before a loaded browser paints easeTo's end.
  // Assert the public camera has actually reached this marker before a centre hit.
  await canvasBox(page);
  if (mode === 'tiles')
    await page.waitForFunction(
      ({ coordinates, zoom }) => {
        const host = document.querySelector('.map-surface');
        const center = (host?.dataset.mapCenter || '').split(',').map(Number);
        return (
          center.length === 2 &&
          center.every((v, i) => Math.abs(v - coordinates[i]) < 0.00001) &&
          Math.abs(Number(host?.dataset.mapZoom) - zoom) < 0.001
        );
      },
      {
        coordinates: marker.coordinates,
        zoom: marker.id === fixture.cases.project.id ? 7 : 14,
      },
    );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  return page.locator('.map-surface').evaluate((e) => ({
    center: e.dataset.mapCenter,
    zoom: e.dataset.mapZoom,
    mode: e.dataset.mapMode,
  }));
}
async function closeDetails(page) {
  const close = page.getByRole('button', { name: '关闭已到访地点详情', exact: true });
  if (await close.count()) await close.click();
}
async function snapshot(page, name, prefix) {
  const file = resolve(out, `${prefix}-${name}.png`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(80);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
async function runCase(page, prefix, name, fn) {
  if (process.env.UI_CASE && !new RegExp(process.env.UI_CASE).test(name)) return;
  const row = { id: ++serial, prefix, name, status: 'running' };
  result.cases.push(row);
  try {
    row.evidence = await fn();
    row.status = 'PASS';
  } catch (error) {
    row.status = 'FAIL';
    row.error = String(error);
    row.screenshot = await snapshot(page, `failure-${serial}`, prefix).catch(() => undefined);
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2));
  console.log(`${prefix} ${name}: ${row.status}${row.error ? ' ' + row.error : ''}`);
}
async function importFixture(page, file = fixturePath) {
  await page.goto(`${base}/#/imports`);
  await page.locator('input[type=file][accept=".json,.xlsx"]').setInputFiles(file);
  await page.getByRole('button', { name: '备份并确认应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已应用' }).waitFor();
}

async function names(page) {
  await openList(page);
  return page.locator('.visited-marker-buttons > button').allTextContents();
}
async function setCountry(page, code = '') {
  await page
    .getByRole('combobox', { name: '地区', exact: true })
    .selectOption(code ? fixture.countryIds[code] : '');
  await page.waitForTimeout(350);
}
async function exportSnapshot(page, prefix) {
  await page.goto(`${base}/#/imports`);
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON 备份', exact: true }).click();
  const d = await wait,
    file = resolve(out, `${prefix}-export.snapshot.json`);
  await d.saveAs(file);
  return JSON.parse(await readFile(file, 'utf8'));
}
async function clickCluster(page, mode, touch, prefix) {
  await closeDetails(page);
  await page.getByRole('button', { name: '全图', exact: true }).click();
  await page.waitForTimeout(600);
  const b = await canvasBox(page),
    candidates = [];
  if (mode === 'canvas') {
    const circles = await page
      .locator('.map-surface canvas')
      .first()
      .evaluate((el) => {
        const w = el.width,
          h = el.height,
          p = el.getContext('2d').getImageData(0, 0, w, h).data,
          seen = new Uint8Array(w * h),
          found = [];
        const green = (i) =>
          Math.abs(p[i * 4] - 33) < 3 &&
          Math.abs(p[i * 4 + 1] - 93) < 3 &&
          Math.abs(p[i * 4 + 2] - 80) < 3;
        for (let k = 0; k < w * h; k++)
          if (!seen[k] && green(k)) {
            const q = [k];
            seen[k] = 1;
            let a = w,
              b = h,
              c = 0,
              d = 0;
            for (let j = 0; j < q.length; j++) {
              const i = q[j],
                x = i % w,
                y = Math.floor(i / w);
              a = Math.min(a, x);
              b = Math.min(b, y);
              c = Math.max(c, x);
              d = Math.max(d, y);
              for (const n of [i - 1, i + 1, i - w, i + w])
                if (n >= 0 && n < w * h && !seen[n] && green(n)) {
                  seen[n] = 1;
                  q.push(n);
                }
            }
            if (q.length > 300 && c - a > 25 && d - b > 25)
              found.push([
                (((a + c) / 2) * el.clientWidth) / w,
                (((b + d) / 2) * el.clientHeight) / h,
              ]);
          }
        return found;
      });
    for (const [x, y] of circles) candidates.push([b.x + x, b.y + y]);
  } else {
    const cam = await page.locator('.map-surface').evaluate((e) => ({
      center: e.dataset.mapCenter.split(',').map(Number),
      zoom: Number(e.dataset.mapZoom),
    }));
    const merc = ([x, y]) => [
        (x + 180) / 360,
        (1 - Math.log(Math.tan(Math.PI / 4 + (y * Math.PI) / 360)) / Math.PI) / 2,
      ],
      cc = merc(cam.center),
      scale = 512 * 2 ** cam.zoom;
    for (const p of [[2.39, 48.86], fixture.cases.cdg.coordinates, fixture.cases.ory.coordinates]) {
      const q = merc(p);
      candidates.push([
        b.x + b.width / 2 + (q[0] - cc[0]) * scale,
        b.y + b.height / 2 + (q[1] - cc[1]) * scale,
      ]);
    }
  }
  for (let y = b.y + b.height * 0.2; y < b.y + b.height * 0.8; y += 18)
    for (let x = b.x + b.width * 0.25; x < b.x + b.width * 0.85; x += 18) candidates.push([x, y]);
  for (const [x, y] of candidates) {
    if (x < 0 || y < 0 || x >= page.viewportSize().width || y >= page.viewportSize().height)
      continue;
    await page.mouse.move(x, y);
    await page.waitForTimeout(35);
    const text = await page
        .locator('.map-hover-card strong')
        .textContent({ timeout: 100 })
        .catch(() => ''),
      count = Number(/^(\d+)\s*个已到访地点/.exec(text)?.[1] || 0);
    if (count < 2) continue;
    if (touch)
      await page
        .locator('.map-surface canvas')
        .first()
        .tap({ position: { x: x - b.x, y: y - b.y } });
    else await page.mouse.click(x, y);
    await page.waitForTimeout(1000);
    assert.equal(
      await page.locator('.visited-selection-items article').count(),
      count,
      'Native click preserves all cluster members',
    );
    const members = await page.locator('.visited-marker-name').allTextContents();
    assert(members.every((n) => Object.values(fixture.cases).some((m) => m.name === n)));
    return { count, members, screenshot: await snapshot(page, 'world-cluster', prefix) };
  }
  throw Error('No real rendered world cluster opened');
}
try {
  for (const size of [
    { name: 'desktop', width: 1440, height: 1000, touch: false },
    { name: 'mobile', width: 390, height: 844, touch: true },
  ])
    for (const mode of ['tiles', 'canvas']) {
      if (process.env.UI_SIZE && process.env.UI_SIZE !== size.name) continue;
      if (process.env.UI_MODE && process.env.UI_MODE !== mode) continue;
      const prefix = `${size.name}-${mode}`,
        context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          isMobile: size.touch,
          hasTouch: size.touch,
          deviceScaleFactor: 1,
          acceptDownloads: true,
        });
      await context.addInitScript(() =>
        sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
      );
      await context.route('**/local-records.json', (r) => r.abort());
      if (mode === 'canvas') await context.route('**/map-manifest.json', (r) => r.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', (error) => result.errors.push({ prefix, error: String(error) }));
      try {
        await importFixture(page);
        await openRoute(page, 'world', mode);
        result.observedPreviews.push({
          prefix,
          footer: (await page.locator('body').innerText()).match(/开发预览[^\n]*/)?.[0],
        });
        await runCase(page, prefix, 'old-snapshot-world-independent-switches', async () => {
          assert(!(await toggle(page, '已到访机场').isChecked()));
          assert(!(await toggle(page, '已到访世界遗产').isChecked()));
          await toggle(page, '已到访机场').check();
          await assertMapped(page, 4);
          await toggle(page, '已到访世界遗产').check();
          await assertMapped(page, 7);
          await toggle(page, '已到访机场').uncheck();
          await assertMapped(page, 3);
          assert(await toggle(page, '已到访世界遗产').isChecked());
          await page.getByRole('button', { name: '撤销', exact: true }).click();
          await assertMapped(page, 7);
          await page.waitForTimeout(400);
          await page.reload();
          await ready(page, mode);
          await assertMapped(page, 7);
          return {
            summary: await summary(page),
            oldFormat: 1,
            mapLayersOriginallyAbsent: true,
            refreshRetained: true,
          };
        });
        // Keep subsequent assertions meaningful after a failed initial case.
        await toggle(page, '已到访机场').check();
        await toggle(page, '已到访世界遗产').check();
        await runCase(
          page,
          prefix,
          'world-record-types-unvisited-negative-and-alias-dedup',
          async () => {
            const list = await names(page);
            assert.equal(list.length, 7);
            for (const m of Object.values(fixture.cases))
              assert.equal(
                list.filter((n) => n.includes(m.name)).length,
                1,
                m.name + ' appears once',
              );
            assert(
              !list.some((n) => n.includes(fixture.negativeUnvisited.name)),
              'Unvisited HND absent',
            );
            assert.equal(fixture.aliases.length, 2);
            assert.equal(list.filter((n) => n.includes(fixture.cases.sharedAlias.name)).length, 1);
            await page
              .getByRole('searchbox', { name: '搜索目录', exact: true })
              .fill('__no_catalog_match__');
            await page
              .getByRole('combobox', { name: '地图内容类别', exact: true })
              .selectOption('airport');
            await page.getByRole('checkbox', { name: '显示点位', exact: true }).uncheck();
            await assertMapped(page, 7);
            await page.getByRole('searchbox', { name: '搜索目录', exact: true }).fill('');
            await page
              .getByRole('combobox', { name: '地图内容类别', exact: true })
              .selectOption('');
            return {
              names: list,
              sharedIdentity: fixture.aliases,
              negativeUnvisited: fixture.negativeUnvisited.name,
            };
          },
        );
        await runCase(
          page,
          prefix,
          'world-country-filter-and-national-routes-preserve-records',
          async () => {
            const seen = {};
            for (const [code, count] of [
              ['FRA', 3],
              ['JPN', 2],
              ['MYS', 1],
            ]) {
              await setCountry(page, code);
              await assertMapped(page, count);
              seen[code] = await names(page);
            }
            await setCountry(page);
            await assertMapped(page, 7);
            for (const [route, count] of [
              ['france', 3],
              ['japan', 2],
              ['malaysia', 1],
            ]) {
              await openRoute(page, route, mode);
              await assertMapped(page, count);
              seen[route] = await names(page);
            }
            await openRoute(page, 'world', mode);
            await assertMapped(page, 7);
            return { seen, screenshot: await snapshot(page, 'world-overview', prefix) };
          },
        );
        await runCase(page, prefix, 'actual-world-symbols-details-and-project-limits', async () => {
          await setCountry(page);
          await page.getByRole('checkbox', { name: '显示点位', exact: true }).uncheck();
          const checked = [];
          for (const role of ['cdg', 'franceComponent', 'project']) {
            const marker = fixture.cases[role];
            await choose(page, marker.name);
            let text = await page.locator('.visited-map-selection').innerText();
            assert(text.includes(marker.note));
            if (role === 'project') assert(text.includes('不代表入口或所有组成地点'));
            await closeDetails(page);
            const camera = await waitForMarkerCamera(page, marker, mode);
            const beforeHit = resolve(out, `${prefix}-world-${role}-before-hit.png`);
            await page.locator('.map-surface').screenshot({ path: beforeHit });
            await centerClick(page, size.touch);
            await page.locator('.visited-map-selection').waitFor();
            text = await page.locator('.visited-map-selection').innerText();
            assert(text.includes(marker.name));
            checked.push({ role, text, camera, beforeHit });
            await snapshot(page, `world-${role}-details`, prefix);
          }
          return { checked };
        });
        await runCase(page, prefix, 'world-alias-cancel-undo-canonical-export', async () => {
          const m = fixture.cases.sharedAlias;
          await choose(page, m.name);
          await page.getByRole('checkbox', { name: '已到访：' + m.name, exact: true }).click();
          await assertMapped(page, 6);
          assert(!(await names(page)).some((n) => n.includes(m.name)));
          await page.getByRole('button', { name: '撤销', exact: true }).click();
          await assertMapped(page, 7);
          const saved = await exportSnapshot(page, prefix);
          assert.equal(Object.keys(saved.entries).length, 7);
          assert.equal(saved.entries[m.recordId].visited, true);
          assert.equal(saved.entries[m.recordId].name, m.name);
          assert.equal(saved.entries[m.id], undefined, 'Alias ID is not a second record key');
          await openRoute(page, 'world', mode);
          await page.reload();
          await ready(page, mode);
          await assertMapped(page, 7);
          return {
            canonicalRecordId: m.recordId,
            aliasId: m.id,
            exportRecordCount: Object.keys(saved.entries).length,
          };
        });
        await runCase(page, prefix, 'real-world-cluster-click-members', async () =>
          clickCluster(page, mode, size.touch, prefix),
        );
        await runCase(page, prefix, 'world-png-export-responsive-layout', async () => {
          await closeDetails(page);
          await setCountry(page);
          await page.getByRole('checkbox', { name: '显示点位', exact: true }).uncheck();
          const wait = page.waitForEvent('download');
          await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
          const d = await wait,
            file = resolve(out, `${prefix}-world.png`);
          await d.saveAs(file);
          const bytes = await readFile(file);
          assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
          assert(bytes.readUInt32BE(16) >= 1000);
          const overflow = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
          }));
          assert(overflow.scroll <= overflow.width + 2);
          return {
            file,
            sha256: sha(bytes),
            width: bytes.readUInt32BE(16),
            height: bytes.readUInt32BE(20),
            overflow,
            screenshot: await snapshot(page, 'world-final', prefix),
          };
        });
      } catch (error) {
        result.cases.push({
          prefix,
          name: 'setup-or-recovery',
          status: 'FAIL',
          error: String(error),
          screenshot: await snapshot(page, 'setup-failure', prefix).catch(() => undefined),
        });
      } finally {
        await context.close();
      }
    }
} finally {
  await browser.close();
  result.finishedAt = new Date().toISOString();
  result.passed = result.cases.filter((c) => c.status === 'PASS').length;
  result.failed = result.cases.filter((c) => c.status === 'FAIL').length;
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      passed: result.passed,
      failed: result.failed,
      pageErrors: result.errors.length,
      output: out,
    }),
  );
  if (result.failed || result.errors.length) process.exitCode = 1;
}
