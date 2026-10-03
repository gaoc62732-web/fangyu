import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const output = resolve(process.env.UI_OUTPUT || 'data/generated/indonesia-ui');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const research = await read('data/extensions/research/indonesia-open-boundaries.json');
const expectedIds = research.rows.map((r) => r.regionId);
const result = {
  base,
  startedAt: new Date().toISOString(),
  isolatedChrome: true,
  basemap: 'disabled',
  cases: [],
  errors: [],
  limitations: [
    'QA land coordinates are derived interior points, not capital/POI locations. Natural Earth coast is generalized; small-island completeness is not claimed.',
  ],
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mercator = ([lon, lat]) => [
  (lon + 180) / 360,
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2,
];
const flatMercator = ([lon, lat]) => [
  lon,
  (-Math.log(Math.tan(Math.PI / 4 + (Math.max(-80, Math.min(80, lat)) * Math.PI) / 360)) * 180) /
    Math.PI,
];
const selected = async (page) =>
  page.evaluate(() => ({
    region: document.querySelector('select[aria-label=地区]')?.value || null,
    heading: document.querySelector('.inspector > h2')?.textContent || '',
    selects: [...document.querySelectorAll('select')].map((s) => ({
      label: s.getAttribute('aria-label'),
      value: s.value,
    })),
  }));
async function ready(page, mode) {
  await page.waitForFunction(
    (mode) => {
      const el = document.querySelector('.map-surface');
      return (
        el?.getAttribute('aria-busy') === 'false' &&
        el.dataset.mapMode === mode &&
        el.querySelector('canvas')
      );
    },
    mode,
    { timeout: 45000 },
  );
  await page.waitForTimeout(350);
}
function inRing([x, y], ring) {
  let v = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [c, d] = ring[j];
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) v = !v;
  }
  return v;
}
function inGeometry(p, g) {
  const polys =
    g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((r) => inRing(p, r[0]) && !r.slice(1).some((h) => inRing(p, h)));
}
const geometryCache = new Map();
async function actualGeometry(scope) {
  if (!geometryCache.has(scope)) {
    const response = await fetch(`${base}/maps/${scope}.json`);
    assert(response.ok, `public geometry ${scope}: ${response.status}`);
    geometryCache.set(scope, await response.json());
  }
  return geometryCache.get(scope);
}
async function canvasBox(page) {
  const canvas = page.locator('.map-surface canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert(box && box.width > 50 && box.height > 50, 'visible map canvas');
  return { canvas, box };
}
async function tileCamera(page) {
  return page.locator('.map-surface').evaluate((el) => ({
    center: el.dataset.mapCenter?.split(',').map(Number),
    zoom: Number(el.dataset.mapZoom),
  }));
}
async function drag(page, dx, dy) {
  const { box } = await canvasBox(page);
  const sx = box.x + box.width / 2,
    sy = box.y + box.height / 2;
  const k = Math.min(
    1,
    (box.width * 0.38) / Math.max(1, Math.abs(dx)),
    (box.height * 0.38) / Math.max(1, Math.abs(dy)),
  );
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx * k, sy + dy * k, { steps: 20 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  return [dx * k, dy * k];
}
async function tileZoom(page, target) {
  for (let i = 0; i < 25; i++) {
    const a = await tileCamera(page);
    if (Math.abs(a.zoom - target) < 0.55) return;
    const { canvas } = await canvasBox(page);
    await canvas.focus();
    await page.keyboard.press(a.zoom < target ? 'Equal' : 'Minus');
    await page.waitForTimeout(310);
    const b = await tileCamera(page);
    assert(Math.abs(b.zoom - a.zoom) > 0.05, 'public keyboard zoom must change camera');
  }
  throw Error('Could not reach target zoom');
}
async function tilePan(page, coordinate) {
  for (let i = 0; i < 20; i++) {
    const { box } = await canvasBox(page),
      cam = await tileCamera(page);
    const p = mercator(coordinate),
      c = mercator(cam.center),
      scale = 512 * 2 ** cam.zoom;
    const dx = (p[0] - c[0]) * scale,
      dy = (p[1] - c[1]) * scale;
    if (Math.hypot(dx, dy) < 4) return;
    await drag(page, -dx, -dy);
  }
  const { box } = await canvasBox(page),
    cam = await tileCamera(page),
    p = mercator(coordinate),
    c = mercator(cam.center),
    scale = 512 * 2 ** cam.zoom;
  // Browser pointer events use physical-pixel rounding. Exact centering is not
  // required: the final hit position is calculated from the observed camera.
  assert(
    Math.abs((p[0] - c[0]) * scale) < box.width * 0.3 &&
      Math.abs((p[1] - c[1]) * scale) < box.height * 0.3,
    'public drag must bring target into viewport',
  );
}
async function tileNavigate(page, coordinate, zoom) {
  await tileZoom(page, 4);
  await tilePan(page, coordinate);
  await tileZoom(page, zoom);
  await tilePan(page, coordinate);
  await page.waitForTimeout(500);
  const { box } = await canvasBox(page),
    cam = await tileCamera(page),
    p = mercator(coordinate),
    c = mercator(cam.center),
    scale = 512 * 2 ** cam.zoom;
  return {
    x: box.x + box.width / 2 + (p[0] - c[0]) * scale,
    y: box.y + box.height / 2 + (p[1] - c[1]) * scale,
    camera: cam,
  };
}
// Canvas has no public camera attributes. Reproduce only its documented initial
// viewport fit from the real fetched scene, then track real drags/toolbar zooms.
async function canvasNavigate(page, coordinate, scope, zoomFactor = 24) {
  const geo = await actualGeometry(scope),
    { box } = await canvasBox(page);
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (x) => {
    if (Array.isArray(x) && typeof x[0] === 'number') {
      const p = flatMercator(x);
      b[0] = Math.min(b[0], p[0]);
      b[1] = Math.min(b[1], p[1]);
      b[2] = Math.max(b[2], p[0]);
      b[3] = Math.max(b[3], p[1]);
    } else if (Array.isArray(x)) x.forEach(walk);
  };
  geo.features.forEach((f) => walk(f.geometry.coordinates));
  let scale = Math.min((box.width - 36) / (b[2] - b[0]), (box.height - 36) / (b[3] - b[1]));
  let tx = box.width / 2 - ((b[0] + b[2]) / 2) * scale,
    ty = box.height / 2 - ((b[1] + b[3]) / 2) * scale;
  const p = flatMercator(coordinate);
  for (let i = 0; i < 80; i++) {
    const dx = box.width / 2 - (p[0] * scale + tx),
      dy = box.height / 2 - (p[1] * scale + ty);
    if (Math.hypot(dx, dy) < 0.5) break;
    const [mx, my] = await drag(page, dx, dy);
    tx += mx;
    ty += my;
    if (i === 79) throw Error('Canvas target too far for public drag');
  }
  let factor = 1;
  while (factor * 1.2 <= zoomFactor) {
    await page.getByRole('button', { name: '放大', exact: true }).click();
    tx = box.width / 2 - (box.width / 2 - tx) * 1.2;
    ty = box.height / 2 - (box.height / 2 - ty) * 1.2;
    scale *= 1.2;
    factor *= 1.2;
  }
  const now = await canvasBox(page);
  return {
    x: now.box.x + p[0] * scale + tx,
    y: now.box.y + p[1] * scale + ty,
    camera: { source: 'real-geometry-fit-plus-public-drag-and-zoom', scale, zoomFactor: factor },
  };
}

function geometryBounds(geo, project = (p) => p) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      const p = project(c);
      b[0] = Math.min(b[0], p[0]);
      b[1] = Math.min(b[1], p[1]);
      b[2] = Math.max(b[2], p[0]);
      b[3] = Math.max(b[3], p[1]);
    } else c.forEach(visit);
  };
  geo.features.forEach((f) => visit(f.geometry.coordinates));
  return b;
}
function fit(geo, width, height) {
  const b = geometryBounds(geo, flatMercator);
  const scale = Math.min((width - 36) / (b[2] - b[0]), (height - 36) / (b[3] - b[1]));
  return (p) => {
    const q = flatMercator(p);
    return [
      width / 2 + (q[0] - (b[0] + b[2]) / 2) * scale,
      height / 2 + (q[1] - (b[1] + b[3]) / 2) * scale,
    ];
  };
}
async function publicBytes(path) {
  const response = await fetch(`${base}/${path}`);
  assert(response.ok, `${path}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const papuaPoints = [
  [91, [138.50902619567432, -2.727443948499962]],
  [92, [134.05226035793925, -2.4879696594999245]],
  [93, [139.9389373882486, -6.83689054499998]],
  [94, [136.6124560975365, -3.9489281]],
  [95, [139.46304207499998, -4.1855742]],
  [96, [131.962119954615, -1.30849815]],
].map(([code, coordinate]) => ({
  ...research.rows.find((r) => r.code === `IDN-KDPPUM-${code}`),
  coordinate,
  blocked: false,
}));
const seaPoints = [
  { nameEn: 'Java Sea', coordinate: [115, -5], blocked: true },
  { nameEn: 'Banda Sea', coordinate: [130, -5], blocked: true },
];
async function reset(page, mode) {
  await page.reload();
  await ready(page, mode);
  const points = page.getByRole('checkbox', { name: '显示点位', exact: true });
  if (await points.count()) await points.uncheck();
  await page.waitForTimeout(200);
}
async function exportPng(page, prefix) {
  await page.evaluate(() => {
    window.__mapDrawText = [];
  });
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  const download = await waiting;
  assert.equal(await download.failure(), null);
  const filename = `${prefix}-export.png`;
  await download.saveAs(resolve(output, filename));
  const drawn = await page.evaluate(() => window.__mapDrawText);
  const exportText = drawn.filter((x) => x.width >= 1500).map((x) => x.text);
  assert(
    exportText.some((t) => /OpenStreetMap|OSM/.test(t)),
    'PNG draws OSM attribution',
  );
  assert(
    exportText.some((t) => /Natural Earth/.test(t)),
    'PNG draws Natural Earth attribution',
  );
  return {
    filename,
    sha256: sha(await readFile(resolve(output, filename))),
    drawnExportText: exportText,
  };
}
async function probe(page, mode, size, test, prefix) {
  await reset(page, mode);
  const screen =
    mode === 'tiles'
      ? await tileNavigate(page, test.coordinate, 7)
      : await canvasNavigate(page, test.coordinate, 'indonesia', 8);
  const { canvas } = await canvasBox(page);
  assert(
    await canvas.evaluate((el, p) => document.elementFromPoint(p.x, p.y) === el, screen),
    'actual canvas receives pointer',
  );
  const before = await selected(page);
  await page.mouse.move(0, 0);
  if (!size.touch) {
    await page.mouse.move(screen.x, screen.y);
    await page.waitForTimeout(180);
  }
  const hover = await page.locator('.map-hover-card').allTextContents();
  if (size.touch) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(400);
  const after = await selected(page);
  if (test.blocked) {
    assert.equal(hover.length, 0);
    assert.equal(after.region, before.region);
  } else {
    assert.equal(after.region, test.regionId);
    if (!size.touch) assert(hover.length > 0);
  }
  const filename = `${prefix}-${test.code || test.nameEn.replaceAll(' ', '-')}.png`;
  await page.screenshot({ path: resolve(output, filename), fullPage: true });
  return {
    name: test.nameEn,
    code: test.code,
    coordinate: test.coordinate,
    blocked: test.blocked,
    screen,
    before,
    after,
    hover,
    screenshot: filename,
  };
}
try {
  const geo = await actualGeometry('indonesia');
  const ids = geo.features.map((f) => String(f.properties?.regionId || f.id));
  assert.equal(ids.length, 38);
  assert.deepEqual([...ids].sort(), [...expectedIds].sort());
  for (const p of seaPoints)
    assert(
      !geo.features.some((f) => inGeometry(p.coordinate, f.geometry)),
      `${p.nameEn} not administrative land`,
    );
  for (const p of papuaPoints)
    assert(
      geo.features.some(
        (f) =>
          String(f.properties?.regionId || f.id) === p.regionId &&
          inGeometry(p.coordinate, f.geometry),
      ),
      `${p.code} interior retained`,
    );
  result.publicGeometry = {
    featureCount: 38,
    sha256: sha(await publicBytes('maps/indonesia.json')),
    papuaInteriorPointsVerified: 6,
    seaPointsOutside: 2,
  };
  for (const size of [
    { name: 'desktop', width: 1440, height: 1000, touch: false },
    { name: 'mobile', width: 390, height: 844, touch: true },
  ])
    for (const mode of ['tiles', 'canvas']) {
      if (process.env.UI_MODE && process.env.UI_MODE !== mode) continue;
      if (process.env.UI_SIZE && process.env.UI_SIZE !== size.name) continue;
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        hasTouch: size.touch,
        isMobile: size.touch,
        deviceScaleFactor: 1,
        acceptDownloads: true,
      });
      await context.addInitScript(() => {
        sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' }));
        // Read-only instrumentation of actual Canvas text drawing; no geometry/data injection.
        window.__mapDrawText = [];
        const original = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
          window.__mapDrawText.push({
            text: String(text),
            width: this.canvas.width,
            height: this.canvas.height,
          });
          return original.call(this, text, ...args);
        };
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (e) => result.errors.push({ mode, size: size.name, error: String(e) }));
      if (mode === 'canvas') await page.route('**/map-manifest.json', (r) => r.abort());
      const prefix = `${size.name}-${mode}`,
        row = { mode, size: size.name, probes: [] };
      result.cases.push(row);
      try {
        await page.goto(`${base}/#/indonesia`);
        await reset(page, mode);
        const options = await page
          .getByRole('combobox', { name: '地区', exact: true })
          .locator('option')
          .evaluateAll((xs) => xs.map((x) => ({ value: x.value, label: x.textContent })));
        const actual = options.filter((x) => expectedIds.includes(x.value));
        assert.equal(actual.length, 38);
        row.regionOptions = actual;
        row.initialScreenshot = `${prefix}-initial.png`;
        await page.screenshot({ path: resolve(output, row.initialScreenshot), fullPage: true });
        row.initialCamera = mode === 'tiles' ? await tileCamera(page) : null;
        row.initialExport = await exportPng(page, `${prefix}-initial`);
        for (const test of [...papuaPoints, ...seaPoints])
          row.probes.push(await probe(page, mode, size, test, prefix));
        // Exercise a real local record write in the empty isolated context and read it back.
        const first = papuaPoints[0];
        await page
          .getByRole('combobox', { name: '地区', exact: true })
          .selectOption(first.regionId);
        const record = page.locator('.inspector .state-select select');
        await record.selectOption('arrived');
        assert.equal(await record.inputValue(), 'arrived');
        await page.getByRole('combobox', { name: '地区', exact: true }).selectOption('');
        await page
          .getByRole('combobox', { name: '地区', exact: true })
          .selectOption(first.regionId);
        assert.equal(await record.inputValue(), 'arrived');
        await record.selectOption('unvisited');
        row.recordRoundtrip = true;
        await page.getByRole('combobox', { name: '地区', exact: true }).selectOption('');
        await page.getByRole('button', { name: '全图', exact: true }).click();
        await page.waitForTimeout(600);
        row.returned = await selected(page);
        assert.equal(row.returned.region, null);
        row.returnedScreenshot = `${prefix}-returned.png`;
        await page.screenshot({ path: resolve(output, row.returnedScreenshot), fullPage: true });
        row.returnedExport = await exportPng(page, `${prefix}-returned`);
        row.passed = true;
        console.log('PASS', prefix);
      } catch (e) {
        row.passed = false;
        row.error = String(e);
        console.error('FAIL', prefix, row.error);
        await page
          .screenshot({ path: resolve(output, `${prefix}-failure.png`), fullPage: true })
          .catch(() => {});
      }
      await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
      await context.close();
    }
} catch (e) {
  result.errors.push({ stage: 'setup', error: String(e) });
  console.error(e);
} finally {
  result.passed =
    result.cases.length > 0 && result.cases.every((r) => r.passed) && !result.errors.length;
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      passed: result.passed,
      cases: result.cases.map((r) => ({
        mode: r.mode,
        size: r.size,
        passed: r.passed,
        error: r.error,
      })),
      errors: result.errors,
    },
    null,
    2,
  ),
);
if (!result.passed) process.exitCode = 1;
