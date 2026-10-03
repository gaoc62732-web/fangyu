import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Public UI only; no injected geometry, application handles or user Chrome profile.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const output = resolve(process.env.UI_OUTPUT || 'data/generated/vietnam-display-ui');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const maskPath = 'data/extensions/research/south-china-sea-interaction-mask.json';
const sourcePath = 'data/catalog/vietnam.geo.json';
const mask = await read(maskPath);
const allTests = (
  await read('data/extensions/research/south-china-sea-interaction-testpoints.json')
).tests;
const named = (await read('data/extensions/research/south-china-sea-named-island-tests.json'))
  .tests;
const excludedPoints = mask.polygons.map((p) => {
  const t = allTests.find(
    (t) => t.sourceRegionId === p.regionId && t.sourcePolygonIndex === p.polygonIndex,
  );
  assert(t);
  return t.coordinate;
});
const result = {
  base,
  startedAt: new Date().toISOString(),
  isolatedChrome: true,
  basemap: 'disabled',
  libraryReference:
    'Original Library image was not materialized on Windows; its pixels have not been seen. Screenshots and exports here come from the actual local UI.',
  sourceSha256Before: sha(await readFile(sourcePath)),
  maskSha256: sha(await readFile(maskPath)),
  artifacts: {},
  cases: [],
  errors: [],
  limitations: [],
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
async function verifyPublishedArtifacts() {
  const paths = ['map-manifest.json', 'maps/vietnam.json', 'geometry/vietnam.geo.json'];
  const tilePaths = (await readdir('data/generated/web/tiles/vietnam', { recursive: true }))
    .filter((p) => p.endsWith('.pbf'))
    .map((p) => 'tiles/vietnam/' + p.replaceAll('\\', '/'));
  assert.equal(tilePaths.length, 9, 'reviewed derived Vietnamese tile count');
  paths.push(...tilePaths);
  for (const path of paths) {
    const actual = await publicBytes(path),
      local = await readFile(`data/generated/web/${path}`);
    assert.equal(sha(actual), sha(local), `published ${path} matches reviewed derived artifact`);
    result.artifacts[path] = { bytes: actual.length, sha256: sha(actual) };
  }
  const artifactCheck = await read('data/generated/vietnam-display-verification.json');
  assert.equal(artifactCheck.status, 'PASS');
  assert.equal(artifactCheck.rawSha256, result.sourceSha256Before);
  assert.equal(artifactCheck.maskSha256, result.maskSha256);
  assert.equal(artifactCheck.removedComponents, 328);
  result.artifactVerification = artifactCheck;
  const manifest = JSON.parse((await publicBytes('map-manifest.json')).toString());
  const geo = await actualGeometry('vietnam');
  const polygons = geo.features.reduce(
    (n, f) => n + (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.length : 1),
    0,
  );
  assert.equal(geo.features.length, 34);
  assert.equal(polygons, 2375);
  assert.deepEqual(manifest.scopes.vietnam.bounds, artifactCheck.displayBounds);
  assert.deepEqual(geometryBounds(geo), artifactCheck.displayBounds);
  for (const p of excludedPoints)
    assert(
      !geo.features.some((f) => inGeometry(p, f.geometry)),
      'removed polygon interior absent from published display',
    );
  assert.equal(result.artifacts['geometry/vietnam.geo.json'].sha256, result.sourceSha256Before);
  result.display = {
    regions: geo.features.length,
    polygons,
    excludedInteriors: excludedPoints.length,
    bounds: manifest.scopes.vietnam.bounds,
  };
  return geo;
}
async function imagePixels(page, png, samplePoints, rectangle, sampleBounds) {
  return page.evaluate(
    async ({ encoded, points, rectangle, sampleBounds }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const isOcean = (a) => a[0] === 238 && a[1] === 244 && a[2] === 243 && a[3] === 255;
      const bounds = sampleBounds || [0, 0, c.width, c.height];
      const inside = (p) =>
        p[0] >= bounds[0] + 2 &&
        p[0] < bounds[2] - 2 &&
        p[1] >= bounds[1] + 2 &&
        p[1] < bounds[3] - 2;
      const samples = points.map((p) => {
        if (!inside(p)) return { pixel: p, outside: true };
        const x = Math.floor(p[0]),
          y = Math.floor(p[1]);
        const a = [...ctx.getImageData(x, y, 1, 1).data];
        return { pixel: p, rgba: a, ocean: isOcean(a) };
      });
      let crop;
      if (rectangle) {
        const [x, y, w, h] = rectangle.map(Math.floor),
          data = ctx.getImageData(x, y, w, h).data;
        let notOcean = 0;
        for (let i = 0; i < data.length; i += 4) if (!isOcean(data.slice(i, i + 4))) notOcean++;
        crop = { rectangle: [x, y, w, h], pixels: w * h, notOcean };
      }
      return { width: c.width, height: c.height, samples, crop };
    },
    { encoded: png.toString('base64'), points: samplePoints, rectangle, sampleBounds },
  );
}
async function viewEvidence(page, mode, geo, prefix) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  const { canvas, box } = await canvasBox(page),
    png = await canvas.screenshot();
  const camera = mode === 'tiles' ? await tileCamera(page) : null;
  const project =
    mode === 'canvas'
      ? fit(geo, box.width, box.height)
      : (p) => {
          const q = mercator(p),
            c = mercator(camera.center),
            scale = 512 * 2 ** camera.zoom;
          return [box.width / 2 + (q[0] - c[0]) * scale, box.height / 2 + (q[1] - c[1]) * scale];
        };
  const positions = excludedPoints.map(project);
  const pixels = await imagePixels(page, png, positions);
  // Locator screenshots include MapLibre attribution controls above the canvas.
  // Record those occlusions explicitly instead of mistaking their text for land.
  const controls = await page
    .locator('.map-surface .maplibregl-control-container')
    .evaluateAll((roots) =>
      roots.flatMap((root) =>
        [...root.querySelectorAll('.maplibregl-ctrl')].map((el) => {
          const b = el.getBoundingClientRect();
          return { className: el.className, x: b.x, y: b.y, width: b.width, height: b.height };
        }),
      ),
    );
  for (const sample of pixels.samples)
    sample.controlOcclusion =
      controls.find(
        (c) =>
          sample.pixel[0] + box.x >= c.x &&
          sample.pixel[0] + box.x < c.x + c.width &&
          sample.pixel[1] + box.y >= c.y &&
          sample.pixel[1] + box.y < c.y + c.height,
      ) || null;
  await writeFile(
    resolve(output, `${prefix}-pixel-audit.json`),
    JSON.stringify({ camera, pixels }, null, 2),
  );
  await writeFile(resolve(output, `${prefix}-map.png`), png);
  assert(
    pixels.samples.every((p) => p.outside || p.controlOcclusion || p.ocean),
    `${prefix}: unobscured excluded interiors display only ocean pixels`,
  );
  const region = await selected(page);
  await writeFile(resolve(output, `${prefix}-map.png`), png);
  await page.screenshot({ path: resolve(output, `${prefix}-page.png`), fullPage: true });
  return {
    camera,
    region,
    canvas: { width: box.width, height: box.height },
    visibleExcludedSamples: pixels.samples.filter((p) => !p.outside && !p.controlOcclusion).length,
    pixels,
    screenshot: `${prefix}-page.png`,
    mapScreenshot: `${prefix}-map.png`,
  };
}
async function exportEvidence(page, geo, prefix) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  const download = await waiting;
  assert.equal(await download.failure(), null);
  const filename = `${prefix}-export.png`;
  await download.saveAs(resolve(output, filename));
  const png = await readFile(resolve(output, filename)),
    project = fit(geo, 1600, 1000);
  const pixels = await imagePixels(
    page,
    png,
    excludedPoints.map((p) => {
      const xy = project(p);
      return [xy[0], xy[1] + 90];
    }),
    null,
    [0, 90, 1600, 1090],
  );
  assert.equal(pixels.width, 1600);
  assert.equal(pixels.height, 1160);
  assert(
    pixels.samples.filter((p) => !p.outside).length > 100,
    'PNG includes enough excluded sea positions for meaningful pixel verification',
  );
  assert(
    pixels.samples.every((p) => p.outside || p.ocean),
    'PNG removed interior positions are ocean',
  );
  return { filename, sha256: sha(png), pixels };
}
async function reset(page, mode) {
  await page.reload();
  await ready(page, mode);
  const points = page.getByRole('checkbox', { name: '显示点位', exact: true });
  if (await points.count()) await points.uncheck();
  await page.waitForTimeout(250);
}
async function probe(page, mode, size, geo, test, prefix) {
  await reset(page, mode);
  const coordinate = test.coordinate;
  const screen =
    mode === 'tiles'
      ? await tileNavigate(page, coordinate, 10)
      : await canvasNavigate(page, coordinate, 'vietnam');
  const { canvas, box } = await canvasBox(page);
  assert(
    await canvas.evaluate((el, p) => document.elementFromPoint(p.x, p.y) === el, screen),
    'target receives pointer on actual canvas',
  );
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const before = await selected(page);
  const image = await canvas.screenshot();
  const row = { name: test.name, coordinate, screen, before, blocked: test.blocked };
  if (test.blocked) {
    row.pixels = await imagePixels(
      page,
      image,
      [[screen.x - box.x, screen.y - box.y]],
      [screen.x - box.x - 70, screen.y - box.y - 70, 140, 140],
    );
    assert.equal(
      row.pixels.crop.notOcean,
      0,
      'sea viewport has no remaining administrative fill or outline',
    );
  }
  if (!size.touch) {
    await page.mouse.move(screen.x, screen.y);
    await page.waitForTimeout(150);
  }
  row.hover = await page.locator('.map-hover-card').allTextContents();
  if (size.touch) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(300);
  row.after = await selected(page);
  if (test.blocked) {
    assert.equal(row.hover.length, 0);
    assert.equal(row.after.region, row.before.region);
    assert.equal(
      sha(image),
      sha(await canvas.screenshot()),
      'removed sea remains visually unchanged after interaction',
    );
  } else {
    const hits = geo.features
      .filter((f) => inGeometry(coordinate, f.geometry))
      .map((f) => String(f.properties?.regionId || f.id));
    assert(hits.includes(row.after.region), 'real retained region selected');
    if (!size.touch) assert(row.hover.length > 0, 'retained land has administrative hover');
  }
  row.screenshot = `${prefix}.png`;
  await page.screenshot({ path: resolve(output, row.screenshot), fullPage: true });
  return row;
}
try {
  const geo = await verifyPublishedArtifacts();
  const sea = [
    named.find((t) => t.nameZh === '永兴岛'),
    named.find((t) => t.nameZh === '南威岛'),
  ].map((t) => ({ name: t.nameZh, coordinate: t.coordinate, blocked: true }));
  const land = ['Da Nang', 'Nha Trang'].map((id) => ({
    name: id,
    coordinate: allTests.find((t) => t.id === id).coordinate,
    blocked: false,
  }));
  for (const size of [
    { name: 'desktop', width: 1440, height: 1000, touch: false },
    { name: 'mobile', width: 390, height: 844, touch: true },
  ]) {
    for (const mode of ['tiles', 'canvas']) {
      if (process.env.UI_MODE && mode !== process.env.UI_MODE) continue;
      if (process.env.UI_SIZE && size.name !== process.env.UI_SIZE) continue;
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
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (e) => result.errors.push({ mode, size: size.name, error: String(e) }));
      if (mode === 'canvas') await page.route('**/map-manifest.json', (r) => r.abort());
      const row = { size: size.name, mode, probes: [] };
      result.cases.push(row);
      const prefix = `${size.name}-${mode}`;
      try {
        await page.goto(`${base}/#/vietnam`);
        await reset(page, mode);
        row.initial = await viewEvidence(page, mode, geo, `${prefix}-initial`);
        row.export = await exportEvidence(page, geo, `${prefix}-initial`);
        for (const [i, test] of [...sea, ...land].entries())
          row.probes.push(await probe(page, mode, size, geo, test, `${prefix}-probe-${i + 1}`));
        // Clear selection through the public select, move away and use the public
        // full-map action. Reload is not used to produce this return evidence.
        await page.getByRole('combobox', { name: '地区', exact: true }).selectOption('');
        await page.getByRole('button', { name: '放大', exact: true }).click();
        await drag(page, 100, 70);
        await page.getByRole('button', { name: '全图', exact: true }).click();
        await page.waitForTimeout(700);
        row.returned = await viewEvidence(page, mode, geo, `${prefix}-returned`);
        assert.equal(row.returned.region.region, null, 'full view has no stale selection');
        if (mode === 'tiles') {
          assert(
            Math.abs(row.initial.camera.zoom - row.returned.camera.zoom) < 0.01,
            'full view restores initial fit zoom',
          );
          assert(
            Math.hypot(
              ...row.initial.camera.center.map((v, i) => v - row.returned.camera.center[i]),
            ) < 0.01,
            'full view restores initial fit center',
          );
        } else
          assert.equal(
            sha(await readFile(resolve(output, row.initial.mapScreenshot))),
            sha(await readFile(resolve(output, row.returned.mapScreenshot))),
            'Canvas full view restores exact initial render',
          );
        row.returnedExport = await exportEvidence(page, geo, `${prefix}-returned`);
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
  }
} catch (e) {
  result.errors.push({ stage: 'artifact-or-harness', error: String(e) });
  console.error(e);
} finally {
  result.sourceSha256After = sha(await readFile(sourcePath));
  result.sourceUnchanged = result.sourceSha256After === result.sourceSha256Before;
  result.passed =
    result.cases.length > 0 &&
    result.cases.every((c) => c.passed) &&
    !result.errors.length &&
    result.sourceUnchanged;
  result.limitations.push(
    'PNG assertions use actual downloaded pixels at all removed component interior positions inside the exported map; positions outside the exported map are recorded separately. All published vector-tile byte hashes are matched to the independently decoded artifact verification. No original Library screenshot pixels were available.',
  );
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      passed: result.passed,
      cases: result.cases.map((c) => ({
        size: c.size,
        mode: c.mode,
        passed: c.passed,
        error: c.error,
      })),
      errors: result.errors,
    },
    null,
    2,
  ),
);
if (!result.passed) process.exitCode = 1;
