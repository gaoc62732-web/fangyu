import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run only after the intended preview has been published. A fresh context imports
// synthetic records through the real UI; no persistent Chrome profile is opened.
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const out = resolve(process.env.UI_OUTPUT || 'data/generated/visited-map-ui');
const fixturePath = resolve('data/generated/visited-map-markers/ui-fixture.snapshot.json');
const fixture = JSON.parse(
  await readFile('data/generated/visited-map-markers/ui-fixture.json', 'utf8'),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const result = {
  base,
  startedAt: new Date().toISOString(),
  clusterProbe: process.env.UI_CLUSTER_PROBE || 'centre',
  observedPreviews: [],
  fixtureSha256: sha(await readFile(fixturePath)),
  isolatedContext: true,
  actualUiImport: true,
  cases: [],
  errors: [],
  limitations: [
    'Screenshots and downloaded PNGs supplement DOM/click checks; this script does not certify subjective icon design.',
  ],
};
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const airportName = fixture.expectedByScope.china.markers.find(
  (m) => m.coordinateEvidenceEntryId,
).name;
const project = fixture.expectedByScope.china.markers.find((m) => m.kind === 'project-reference');
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

try {
  for (const size of [
    { name: 'desktop', width: 1440, height: 1000, touch: false },
    { name: 'mobile', width: 390, height: 844, touch: true },
  ]) {
    for (const mode of ['tiles', 'canvas']) {
      if (process.env.UI_SIZE && process.env.UI_SIZE !== size.name) continue;
      if (process.env.UI_MODE && process.env.UI_MODE !== mode) continue;
      const prefix = `${size.name}-${mode}`;
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        hasTouch: size.touch,
        isMobile: size.touch,
        deviceScaleFactor: 1,
        acceptDownloads: true,
      });
      await context.addInitScript(() =>
        sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
      );
      await context.route('**/local-records.json', (route) => route.abort());
      if (mode === 'canvas') await context.route('**/map-manifest.json', (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => result.errors.push({ prefix, error: String(error) }));
      try {
        await importFixture(page);
        await openRoute(page, 'china', mode);
        result.observedPreviews.push({
          prefix,
          footer: await page
            .locator('body')
            .innerText()
            .then((t) => t.match(/开发预览[^\n]*/)?.[0] || 'not exposed'),
        });
        await runCase(page, prefix, 'synthetic-import-and-independent-layer-switches', async () => {
          assert(await toggle(page, '已到访机场').isChecked());
          assert(await toggle(page, '已到访世界遗产').isChecked());
          await assertMapped(page, 3, 1);
          await toggle(page, '已到访机场').uncheck();
          await assertMapped(page, 1, 1);
          assert(await toggle(page, '已到访世界遗产').isChecked());
          await page.getByRole('button', { name: '撤销', exact: true }).click();
          await assertMapped(page, 3, 1);
          assert(await toggle(page, '已到访机场').isChecked());
          await toggle(page, '已到访世界遗产').uncheck();
          await assertMapped(page, 2);
          await page.waitForTimeout(500);
          await page.reload();
          await ready(page, mode);
          assert(await toggle(page, '已到访机场').isChecked());
          assert(!(await toggle(page, '已到访世界遗产').isChecked()));
          await assertMapped(page, 2);
          await toggle(page, '已到访世界遗产').check();
          await assertMapped(page, 3, 1);
          return {
            summary: await summary(page),
            persistedAcrossReload: true,
            undoRestoredIndependentAirportSwitch: true,
          };
        });
        await runCase(page, prefix, 'catalog-filters-do-not-filter-visited-overlay', async () => {
          await page
            .getByRole('searchbox', { name: '搜索目录', exact: true })
            .fill('__no_catalog_match__');
          await page
            .getByRole('combobox', { name: '地图内容类别', exact: true })
            .selectOption('railway-station');
          await page.getByRole('checkbox', { name: '显示点位', exact: true }).uncheck();
          await assertMapped(page, 3, 1);
          await openList(page);
          assert.equal(await page.locator('.visited-marker-buttons > button').count(), 3);
          await page.getByRole('searchbox', { name: '搜索目录', exact: true }).fill('');
          await page.getByRole('combobox', { name: '地图内容类别', exact: true }).selectOption('');
          return {
            overlayNames: await page.locator('.visited-marker-buttons > button').allTextContents(),
            summary: await summary(page),
          };
        });
        await runCase(
          page,
          prefix,
          'actual-airport-symbol-click-name-note-and-undo-visit',
          async () => {
            await choose(page, airportName);
            assert(
              (await page.locator('.visited-map-selection').innerText()).includes(
                'Synthetic browser fixture: china-reviewed-iata-airport-location',
              ),
            );
            await closeDetails(page);
            const b = await canvasBox(page);
            const clip = {
              x: b.x + b.width / 2 - 25,
              y: b.y + b.height / 2 - 25,
              width: 50,
              height: 50,
            };
            const visibleIcon = await page.screenshot({
              clip,
              path: resolve(out, `${prefix}-airport-icon.png`),
            });
            await toggle(page, '已到访机场').uncheck();
            await assertMapped(page, 1, 1);
            await canvasBox(page);
            await page.waitForTimeout(400);
            const hiddenIcon = await page.screenshot({ clip });
            assert.notEqual(
              sha(visibleIcon),
              sha(hiddenIcon),
              'Actual map pixels change when the airport overlay is toggled',
            );
            await toggle(page, '已到访机场').check();
            await choose(page, airportName);
            await closeDetails(page);
            await centerClick(page, size.touch);
            await page.locator('.visited-map-selection').waitFor();
            assert(
              (await page.locator('.visited-map-selection').innerText()).includes(airportName),
            );
            await page
              .getByRole('checkbox', { name: '已到访：' + airportName, exact: true })
              .click();
            await assertMapped(page, 2, 1);
            await openList(page);
            assert.equal(
              await page
                .locator('.visited-marker-buttons')
                .getByRole('button', { name: airportName, exact: true })
                .count(),
              0,
            );
            await page.getByRole('button', { name: '撤销', exact: true }).click();
            await assertMapped(page, 3, 1);
            await choose(page, airportName);
            assert(
              await page
                .getByRole('checkbox', { name: '已到访：' + airportName, exact: true })
                .isChecked(),
            );
            return {
              iconPixelHash: sha(visibleIcon),
              hiddenPixelHash: sha(hiddenIcon),
              screenshot: await snapshot(page, 'airport-details', prefix),
              pointer: size.touch ? 'touch' : 'mouse',
            };
          },
        );
        await runCase(
          page,
          prefix,
          'heritage-project-reference-and-missing-coordinate-honesty',
          async () => {
            await choose(page, project.name);
            const detail = await page.locator('.visited-map-selection').innerText();
            assert(detail.includes('不代表入口或所有组成地点'));
            assert(detail.includes(project.note));
            if (mode === 'tiles')
              assert(
                Number(await page.locator('.map-surface').getAttribute('data-map-zoom')) <= 7.01,
              );
            await closeDetails(page);
            await centerClick(page, size.touch);
            await page.locator('.visited-map-selection').waitFor();
            assert(
              (await page.locator('.visited-map-selection').innerText()).includes(project.name),
            );
            const missing = page.locator('.visited-marker-omissions');
            if (!(await missing.evaluate((e) => e.open))) await missing.locator('summary').click();
            assert((await missing.innerText()).includes('北京和沈阳的明清皇宫'));
            assert((await missing.innerText()).includes('记录仍保留'));
            return {
              detail,
              omitted: await missing.innerText(),
              screenshot: await snapshot(page, 'heritage-reference', prefix),
            };
          },
        );
        await runCase(page, prefix, 'real-rendered-cluster-opens-members', async () => {
          const clusterSnapshot = JSON.parse(await readFile(fixturePath, 'utf8'));
          clusterSnapshot.entries['02d58d97-1b14-58d5-af3e-da871b482338'] = {
            visited: true,
            subitemIds: [],
            note: 'Synthetic cluster-only fixture; not a real travel record.',
          };
          const clusterFile = resolve(out, 'cluster-only.snapshot.json');
          await writeFile(clusterFile, JSON.stringify(clusterSnapshot));
          await importFixture(page, clusterFile);
          await openRoute(page, 'china', mode);
          await assertMapped(page, 4, 1);
          await page.getByRole('checkbox', { name: '显示点位', exact: true }).uncheck();
          await closeDetails(page);
          await page.getByRole('button', { name: '全图', exact: true }).click();
          // Public zoom controls make these three actual fixture markers neighbours.
          for (let i = 0; i < 18; i++)
            await page.getByRole('button', { name: '缩小', exact: true }).click();
          await page.waitForTimeout(700);
          const b = await canvasBox(page);
          const camera = await page.locator('.map-surface').evaluate((e) => ({
            center: e.dataset.mapCenter?.split(',').map(Number),
            zoom: Number(e.dataset.mapZoom),
          }));
          let found = false;
          const candidates = [];
          // Preserve the original real regression point: pointerup used to insert
          // details before the native touch click, which then clicked a new button.
          if (mode === 'canvas' && size.touch && process.env.UI_CLUSTER_PROBE === 'edge')
            candidates.push([b.x + 223.4, b.y + 197.278125]);
          if (mode === 'canvas' && process.env.UI_CLUSTER_PROBE !== 'edge') {
            const circles = await page
              .locator('.map-surface canvas')
              .first()
              .evaluate((el) => {
                const ctx = el.getContext('2d'),
                  w = el.width,
                  h = el.height,
                  p = ctx.getImageData(0, 0, w, h).data;
                const seen = new Uint8Array(w * h),
                  found = [];
                const green = (i) =>
                  Math.abs(p[i * 4] - 33) < 3 &&
                  Math.abs(p[i * 4 + 1] - 93) < 3 &&
                  Math.abs(p[i * 4 + 2] - 80) < 3;
                for (let k = 0; k < w * h; k++)
                  if (!seen[k] && green(k)) {
                    const q = [k];
                    seen[k] = 1;
                    let loX = w,
                      loY = h,
                      hiX = 0,
                      hiY = 0;
                    for (let j = 0; j < q.length; j++) {
                      const i = q[j],
                        x = i % w,
                        y = Math.floor(i / w);
                      loX = Math.min(loX, x);
                      hiX = Math.max(hiX, x);
                      loY = Math.min(loY, y);
                      hiY = Math.max(hiY, y);
                      for (const n of [i - 1, i + 1, i - w, i + w])
                        if (n >= 0 && n < w * h && !seen[n] && green(n)) {
                          seen[n] = 1;
                          q.push(n);
                        }
                    }
                    if (q.length > 300 && hiX - loX > 25 && hiY - loY > 25)
                      found.push([
                        (((loX + hiX) / 2) * el.clientWidth) / w,
                        (((loY + hiY) / 2) * el.clientHeight) / h,
                      ]);
                  }
                return found;
              });
            for (const [x, y] of circles) candidates.push([b.x + x, b.y + y]);
          }

          if (mode === 'tiles' && camera.center) {
            const merc = ([lon, lat]) => [
              (lon + 180) / 360,
              (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2,
            ];
            const cc = merc(camera.center),
              scale = 512 * 2 ** camera.zoom;
            const pts = [
              ...fixture.expectedByScope.china.markers.map((m) => m.coordinates),
              [116.41092, 39.509945],
            ];
            for (const p of [...pts, [114, 35], [116.5, 39.8]]) {
              const q = merc(p);
              candidates.push([
                b.x + b.width / 2 + (q[0] - cc[0]) * scale,
                b.y + b.height / 2 + (q[1] - cc[1]) * scale,
              ]);
            }
          }
          for (let y = b.y + b.height * 0.2; y < b.y + b.height * 0.8; y += 16)
            for (let x = b.x + b.width * 0.35; x < b.x + b.width * 0.85; x += 16)
              candidates.push([x, y]);
          for (const [x, y] of candidates) {
            if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue;
            await page.mouse.move(x, y);
            await page.waitForTimeout(18);
            const tip = await page.evaluate(
              () => document.querySelector('.map-hover-card strong')?.textContent || '',
            );
            const clusterCount = Number(/^(\d+)\s*个已到访地点/.exec(tip)?.[1] || 0);
            if (clusterCount > 1) {
              await page.waitForTimeout(50);
              const stableTip = await page.evaluate(
                () => document.querySelector('.map-hover-card strong')?.textContent || '',
              );
              if (stableTip !== tip) continue;
              await page
                .locator('.map-surface canvas')
                .first()
                .screenshot({ path: resolve(out, `${prefix}-cluster-before-click.png`) });
              const clickAudit = await page
                .locator('.map-surface canvas')
                .first()
                .evaluate((el) => {
                  window.__visitedPointerAudit = [];
                  for (const type of ['pointerdown', 'pointerup', 'click'])
                    el.addEventListener(
                      type,
                      (e) =>
                        window.__visitedPointerAudit.push({
                          type,
                          pointerId: e.pointerId,
                          pointerType: e.pointerType,
                          x: e.offsetX,
                          y: e.offsetY,
                          clientX: e.clientX,
                          clientY: e.clientY,
                        }),
                      { capture: true },
                    );
                  const r = el.getBoundingClientRect();
                  return { x: r.x, y: r.y, width: r.width, height: r.height };
                });
              if (size.touch)
                await page
                  .locator('.map-surface canvas')
                  .first()
                  .tap({ position: { x: x - b.x, y: y - b.y } });
              else await page.mouse.click(x, y);
              await page.waitForTimeout(300);
              const selectedCount = await page.locator('.visited-selection-items article').count();
              await writeFile(
                resolve(out, `${prefix}-cluster-click-audit.json`),
                JSON.stringify(
                  {
                    oldBox: b,
                    currentBox: clickAudit,
                    x,
                    y,
                    tip,
                    selectedCount,
                    events: await page.evaluate(() => window.__visitedPointerAudit),
                  },
                  null,
                  2,
                ),
              );
              assert.equal(
                selectedCount,
                clusterCount,
                `Cluster ${tip} at [${x},${y}] must open all members, got ${selectedCount}`,
              );
              await page.waitForTimeout(700);
              assert.equal(
                await page.locator('.visited-selection-items article').count(),
                clusterCount,
                'All cluster members must remain selected after the native touch click settles',
              );
              found = true;
              break;
            }
          }
          assert(found, 'A visible real cluster must open more than one record');
          const names = await page
            .locator('.visited-selection-items .visited-marker-name')
            .allTextContents();
          assert(
            names.every(
              (name) =>
                name === 'PKX北京大兴' ||
                fixture.expectedByScope.china.markers.some((m) => m.name === name),
            ),
          );
          return {
            members: names,
            camera,
            screenshot: await snapshot(page, 'cluster-members', prefix),
          };
        });
        await runCase(page, prefix, 'france-known-region-filter-and-component-symbol', async () => {
          await openRoute(page, 'france', mode);
          await assertMapped(page, 1);
          await page
            .getByRole('combobox', { name: '地区', exact: true })
            .selectOption('15cc47d8-6dec-59bd-95d9-22265a2060d3');
          await assertMapped(page, 1);
          const marker = fixture.expectedByScope.france.markers[0];
          await choose(page, marker.name);
          await closeDetails(page);
          await centerClick(page, size.touch);
          await page.locator('.visited-map-selection').waitFor();
          assert((await page.locator('.visited-map-selection').innerText()).includes(marker.note));
          const picture = await snapshot(page, 'france-component-details', prefix);
          await page
            .getByRole('combobox', { name: '地区', exact: true })
            .selectOption('5a593687-7d6e-5628-9c16-c0a31d18ac4c');
          await assertMapped(page, 0);
          return { matchingRegionMapped: 1, unrelatedRegionMapped: 0, screenshot: picture };
        });
        await runCase(page, prefix, 'scope-switch-and-reference-only-omission', async () => {
          await openRoute(page, 'japan', mode);
          await assertMapped(page, 1);
          await openList(page);
          assert((await page.locator('.visited-marker-buttons').innerText()).includes('Narita'));
          await openRoute(page, 'indonesia', mode);
          await assertMapped(page, 1, 1);
          await openList(page);
          assert((await page.locator('.visited-marker-buttons').innerText()).includes('Borobudur'));
          await page.locator('.visited-marker-omissions > summary').click();
          assert(
            (await page.locator('.visited-marker-omissions').innerText()).includes('Ujung Kulon'),
          );
          return {
            screenshot: await snapshot(page, 'indonesia-omitted-reference', prefix),
            summary: await summary(page),
          };
        });
        await runCase(page, prefix, 'png-export-and-responsive-layout', async () => {
          await page.getByRole('checkbox', { name: '显示点位', exact: true }).uncheck();
          const downloadPromise = page.waitForEvent('download');
          await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
          const download = await downloadPromise;
          const file = resolve(out, `${prefix}-visited-map.png`);
          await download.saveAs(file);
          const bytes = await readFile(file);
          assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
          assert(bytes.readUInt32BE(16) >= 1000 && bytes.readUInt32BE(20) >= 600);
          const overflow = await page.evaluate(() => ({
            client: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
          }));
          assert(
            overflow.scroll <= overflow.client + 2,
            `No page-wide horizontal overflow: ${JSON.stringify(overflow)}`,
          );
          return {
            file,
            bytes: bytes.length,
            sha256: sha(bytes),
            width: bytes.readUInt32BE(16),
            height: bytes.readUInt32BE(20),
            overflow,
          };
        });
      } catch (error) {
        result.cases.push({
          prefix,
          name: 'setup',
          status: 'FAIL',
          error: String(error),
          screenshot: await snapshot(page, 'setup-failure', prefix).catch(() => undefined),
        });
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  result.finishedAt = new Date().toISOString();
  result.passed = result.cases.filter((r) => r.status === 'PASS').length;
  result.failed = result.cases.filter((r) => r.status === 'FAIL').length;
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
