import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const base = process.env.UI_BASE_URL || 'http://localhost:5173';
const output = resolve(process.env.UI_OUTPUT || 'data/generated/china-boundary-toggle-checks');
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'msedge',
  headless: true,
});
const checks = [];
const groupForOption = {
  lianjiang: 0,
  jinmen: 0,
  tanggulaTibet: 1,
  suzhouPark: 2,
  huzhongXinlin: 3,
  jiagedaqi: 3,
  songling: 3,
  shenshan: 4,
};
const scenarios = [
  {
    key: 'tanggulaTibet',
    name: '唐古拉山镇西藏管理区',
    expectedProvinces: ['青海省', '西藏自治区'],
    center: [92.5, 33.5],
    zoom: 5,
  },
  {
    key: 'jiagedaqi',
    name: '加格达奇区',
    expectedProvinces: ['黑龙江省', '内蒙古自治区'],
    center: [124.2, 50.4],
    zoom: 6,
  },
  {
    key: 'songling',
    name: '松岭区',
    expectedProvinces: ['黑龙江省', '内蒙古自治区'],
    center: [124.4, 50.8],
    zoom: 6,
  },
  {
    key: 'lianjiang',
    name: '連江縣',
    expectedProvinces: ['福建省', '台湾省'],
    center: [119.8, 26.1],
    zoom: 7,
  },
  {
    key: 'jinmen',
    name: '金门縣',
    expectedProvinces: ['福建省', '台湾省'],
    center: [118.4, 24.4],
    zoom: 8,
  },
  { key: 'shenshan', name: '深汕特别合作区', center: [115.1, 22.8], zoom: 8 },
];

try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() =>
    sessionStorage.setItem('fangyu-private-basemap-v1', JSON.stringify({ mode: 'disabled' })),
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => checks.push({ error: String(error) }));
  await page.goto(base + '/?mapDebug=1#/regions/china');
  console.log('opened map');
  await page.waitForFunction(() => Boolean(globalThis.__fangyuMap));
  await page.waitForFunction(
    () => document.querySelector('.map-surface')?.dataset.mapMode === 'tiles',
  );
  console.log('map ready');
  await page.getByRole('button', { name: '省', exact: true }).click();
  await page.locator('.china-boundary-settings summary').click();
  await page.waitForFunction(
    () => document.querySelectorAll('.china-boundary-settings input').length >= 8,
  );
  const groupCount = await page.evaluate(async () => {
    const response = await fetch('map-manifest.json');
    return (await response.json()).scopes.china.boundaryOptionGroups;
  });
  assert.equal(groupCount, 5, 'generated manifest declares each isolated rule group');
  await page.evaluate((count) => {
    const map = globalThis.__fangyuMap;
    globalThis.__chinaRenderOps = {
      setData: [],
      updateData: [],
      style: [],
      featureState: [],
      pending: [],
    };
    for (const id of Object.keys(map.getStyle().sources)) {
      const source = map.getSource(id);
      if (source?.setData) {
        const setData = source.setData.bind(source);
        source.setData = (data) => {
          const pending = setData(data);
          globalThis.__chinaRenderOps.setData.push(id);
          globalThis.__chinaRenderOps.pending.push(pending);
          return pending;
        };
      }
      if (source?.updateData) {
        const updateData = source.updateData.bind(source);
        source.updateData = (diff) => {
          const pending = updateData(diff);
          globalThis.__chinaRenderOps.updateData.push({ id, diff });
          globalThis.__chinaRenderOps.pending.push(pending);
          return pending;
        };
      }
    }
    for (const method of ['setLayoutProperty', 'setPaintProperty', 'setFilter']) {
      const original = map[method].bind(map);
      map[method] = (...args) => {
        globalThis.__chinaRenderOps.style.push({ method, layer: args[0], property: args[1] });
        return original(...args);
      };
    }
    for (const method of ['setFeatureState', 'removeFeatureState']) {
      const original = map[method].bind(map);
      map[method] = (target, ...args) => {
        globalThis.__chinaRenderOps.featureState.push({
          method,
          source: target.source,
          id: target.id,
        });
        return original(target, ...args);
      };
    }
    globalThis.__chinaProvinceLayerIds = [
      'province-line',
      ...Array.from({ length: count }, (_, index) => `china-options-province-line-${index}`),
    ].filter((id) => map.getLayer(id));
  }, groupCount);

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const input = page.locator(`input[aria-label="${scenario.name}"]`);
    await input.scrollIntoViewIfNeeded();
    const initial = await input.isChecked();
    const groupIndex = groupForOption[scenario.key];
    assert(Number.isInteger(groupIndex));
    for (const checked of [!initial, initial]) {
      await page.evaluate(
        ({ center, zoom }) => globalThis.__fangyuMap.jumpTo({ center, zoom }),
        scenario,
      );
      await page.waitForFunction(() => {
        const map = globalThis.__fangyuMap;
        return map.isStyleLoaded() && map.areTilesLoaded() && !map.isMoving();
      });
      const provinceNamesBefore = await page.evaluate(() => {
        const map = globalThis.__fangyuMap;
        return [
          ...new Set(
            map
              .queryRenderedFeatures(undefined, { layers: globalThis.__chinaProvinceLayerIds })
              .map((feature) => String(feature.properties?.name || ''))
              .filter(Boolean),
          ),
        ].sort();
      });
      await page.evaluate(() => {
        globalThis.__chinaRenderOps = {
          setData: [],
          updateData: [],
          style: [],
          featureState: [],
          pending: [],
        };
      });
      const started = performance.now();
      await input.setChecked(checked);
      await page.waitForFunction(
        ({ groupIndex }) => {
          const operations = globalThis.__chinaRenderOps;
          return (
            operations.updateData.some(({ id }) => id === `china-options-${groupIndex}`) ||
            operations.setData.includes(`china-options-${groupIndex}`)
          );
        },
        { groupIndex },
        { timeout: 12000 },
      );
      await page.evaluate(async () => Promise.all(globalThis.__chinaRenderOps.pending));
      await page.waitForFunction(() => {
        const map = globalThis.__fangyuMap;
        return map.isStyleLoaded() && map.areTilesLoaded() && !map.isMoving();
      });
      await page.waitForTimeout(120);
      const result = await page.evaluate(() => {
        const map = globalThis.__fangyuMap;
        const ops = globalThis.__chinaRenderOps;
        const names = [
          ...new Set(
            map
              .queryRenderedFeatures(undefined, { layers: globalThis.__chinaProvinceLayerIds })
              .map((feature) => String(feature.properties?.name || ''))
              .filter(Boolean),
          ),
        ].sort();
        return {
          setData: [...new Set(ops.setData)].sort(),
          updateData: [...new Set(ops.updateData.map(({ id }) => id))].sort(),
          updateDiffs: ops.updateData.map(({ id, diff }) => ({
            id,
            changed: [
              ...(diff.remove || []),
              ...(diff.add || []).map((feature) => feature.id),
              ...(diff.update || []).map((feature) => feature.id),
            ]
              .map(String)
              .sort(),
          })),
          style: ops.style,
          featureStateSources: [...new Set(ops.featureState.map(({ source }) => source))].sort(),
          provinceNames: names,
        };
      });
      const expectedSources = [`china-options-${groupIndex}`];
      if (scenario.key === 'tanggulaTibet') expectedSources.push('china-options-lines');
      const changedSources = [...new Set([...result.setData, ...result.updateData])].sort();
      assert.deepEqual(
        changedSources,
        expectedSources.sort(),
        `${scenario.key} updates only its boundary data sources`,
      );
      assert.deepEqual(
        result.featureStateSources,
        [`china-options-${groupIndex}`],
        `${scenario.key} updates feature state only in its own source`,
      );
      assert.deepEqual(
        result.style.map(({ layer, property }) => `${layer}:${property}`).sort(),
        scenario.key === 'tanggulaTibet' ? ['china-options-tanggula-nominal-line:visibility'] : [],
        `${scenario.key} does not reconfigure unrelated map layers`,
      );
      assert.deepEqual(
        result.provinceNames,
        provinceNamesBefore,
        `${scenario.key} preserves the province boundaries visible before the toggle`,
      );
      for (const name of scenario.expectedProvinces || [])
        assert(result.provinceNames.includes(name), `${scenario.key} keeps ${name} rendered`);
      await page.screenshot({
        path: resolve(
          output,
          `${String(scenarioIndex + 1).padStart(2, '0')}-${scenario.key}-${checked ? 'on' : 'off'}.png`,
        ),
      });
      checks.push({
        key: scenario.key,
        checked,
        groupIndex,
        changedSources,
        changedFeatures: result.updateDiffs,
        retainedProvinces: result.provinceNames,
        updateMs: Math.round(performance.now() - started),
      });
      console.log('PASS', scenario.key, checked ? 'on' : 'off', `group ${groupIndex}`);
    }
  }
  const errors = checks.filter((check) => check.error);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(checks, null, 2));
  await context.close();
} finally {
  await browser.close();
}
