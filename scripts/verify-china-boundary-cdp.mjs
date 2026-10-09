import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.UI_BASE_URL || 'http://localhost:5173';
const output = resolve('data/generated/china-boundary-toggle-checks');
const scenarios = [
  { key: 'tanggulaTibet', name: '唐古拉山镇西藏管理区', group: 1, provinces: ['青海省', '西藏自治区'], center: [92.5, 33.5], zoom: 5 },
  { key: 'jiagedaqi', name: '加格达奇区', group: 3, provinces: ['黑龙江省', '内蒙古自治区'], center: [124.2, 50.4], zoom: 6 },
  { key: 'songling', name: '松岭区', group: 3, provinces: ['黑龙江省', '内蒙古自治区'], center: [124.4, 50.8], zoom: 6 },
  { key: 'lianjiang', name: '連江縣', group: 0, provinces: ['福建省', '台湾省'], center: [119.8, 26.1], zoom: 7 },
  { key: 'jinmen', name: '金门縣', group: 0, provinces: ['福建省', '台湾省'], center: [118.4, 24.4], zoom: 8 },
  { key: 'shenshan', name: '深汕特别合作区', group: 4, provinces: [], center: [115.1, 22.8], zoom: 8 },
];
const targetResponse = await fetch(
  'http://127.0.0.1:9333/json/new?' +
    encodeURIComponent(base + '/?mapDebug=1#/regions/china'),
  { method: 'PUT' },
);
if (!targetResponse.ok) throw Error(`Edge CDP target failed: ${targetResponse.status}`);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(Error(message.error.message));
  else request.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveMessage, reject) => {
    pending.set(id, { resolve: resolveMessage, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function waitFor(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw Error(`Timed out waiting for: ${expression}`);
}
async function settleMap() {
  await waitFor(
    'window.__fangyuMap && __fangyuMap.isStyleLoaded() && __fangyuMap.areTilesLoaded() && !__fangyuMap.isMoving()',
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await waitFor('Boolean(window.__fangyuMap)');
  await waitFor("document.querySelector('.map-surface')?.dataset.mapMode === 'tiles'");
  await evaluate("Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === '省')?.click()");
  await evaluate("document.querySelector('.china-boundary-settings summary')?.click()");
  await waitFor("document.querySelectorAll('.china-boundary-settings input').length >= 8");
  const count = await evaluate("(await (await fetch('map-manifest.json')).json()).scopes.china.boundaryOptionGroups");
  assert.equal(count, 5);
  await evaluate(`(() => {
    const map = window.__fangyuMap;
    window.__chinaRenderOps = { setData: [], updateData: [], style: [], featureState: [], pending: [] };
    for (const id of Object.keys(map.getStyle().sources)) {
      const source = map.getSource(id);
      if (source?.setData) {
        const original = source.setData.bind(source);
        source.setData = (data) => {
          const result = original(data);
          window.__chinaRenderOps.setData.push(id);
          window.__chinaRenderOps.pending.push(result);
          return result;
        };
      }
      if (source?.updateData) {
        const original = source.updateData.bind(source);
        source.updateData = (diff) => {
          const result = original(diff);
          window.__chinaRenderOps.updateData.push({ id, diff });
          window.__chinaRenderOps.pending.push(result);
          return result;
        };
      }
    }
    for (const method of ['setLayoutProperty', 'setPaintProperty', 'setFilter']) {
      const original = map[method].bind(map);
      map[method] = (...args) => {
        window.__chinaRenderOps.style.push({ method, layer: args[0], property: args[1] });
        return original(...args);
      };
    }
    for (const method of ['setFeatureState', 'removeFeatureState']) {
      const original = map[method].bind(map);
      map[method] = (target, ...args) => {
        window.__chinaRenderOps.featureState.push({ method, source: target.source, id: target.id });
        return original(target, ...args);
      };
    }
    window.__chinaProvinceLayerIds = [
      'province-line',
      ...Array.from({ length: ${count} }, (_, index) => 'china-options-province-line-' + index),
    ].filter((id) => map.getLayer(id));
  })()`);

  const checks = [];
  for (const scenario of scenarios) {
    for (const checked of [false, true]) {
      await evaluate(`__fangyuMap.jumpTo({ center: ${JSON.stringify(scenario.center)}, zoom: ${scenario.zoom} })`);
      await settleMap();
      const before = await evaluate(`(() => [...new Set(__fangyuMap.queryRenderedFeatures(undefined, { layers: __chinaProvinceLayerIds }).map((feature) => String(feature.properties?.name || '')).filter(Boolean))].sort())()`);
      await evaluate(`(() => {
        window.__chinaRenderOps = { setData: [], updateData: [], style: [], featureState: [], pending: [] };
        const input = document.querySelector('input[aria-label="${scenario.name}"]');
        if (input.checked !== ${checked}) input.click();
      })()`);
      await waitFor(
        `__chinaRenderOps.updateData.some(({ id }) => id === 'china-options-${scenario.group}') || __chinaRenderOps.setData.includes('china-options-${scenario.group}')`,
        12000,
      );
      await evaluate('Promise.all(__chinaRenderOps.pending)');
      await settleMap();
      const result = await evaluate(`(() => {
        const ops = __chinaRenderOps;
        const provinceNames = [...new Set(__fangyuMap.queryRenderedFeatures(undefined, { layers: __chinaProvinceLayerIds }).map((feature) => String(feature.properties?.name || '')).filter(Boolean))].sort();
        return {
          setData: [...new Set(ops.setData)].sort(),
          updateData: [...new Set(ops.updateData.map(({ id }) => id))].sort(),
          style: ops.style.map(({ layer, property }) => layer + ':' + property).sort(),
          featureStateSources: [...new Set(ops.featureState.map(({ source }) => source))].sort(),
          provinceNames,
        };
      })()`);
      const expectedSources = [`china-options-${scenario.group}`];
      if (scenario.key === 'tanggulaTibet') expectedSources.push('china-options-lines');
      const changedSources = [...new Set([...result.setData, ...result.updateData])].sort();
      assert.deepEqual(changedSources, expectedSources.sort(), `${scenario.key} changed source set`);
      assert.deepEqual(result.featureStateSources, [`china-options-${scenario.group}`], `${scenario.key} feature-state source`);
      assert.deepEqual(
        result.style,
        scenario.key === 'tanggulaTibet' ? ['china-options-tanggula-nominal-line:visibility'] : [],
        `${scenario.key} style writes`,
      );
      assert.deepEqual(result.provinceNames, before, `${scenario.key} province boundary visibility`);
      for (const name of scenario.provinces)
        assert(result.provinceNames.includes(name), `${scenario.key} retains ${name}`);
      const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(resolve(output, `cdp-${scenario.key}-${checked ? 'on' : 'off'}.png`), Buffer.from(image.data, 'base64'));
      checks.push({ key: scenario.key, checked, changedSources, provinces: result.provinceNames });
      console.log('PASS', scenario.key, checked ? 'on' : 'off');
    }
  }
  console.log(JSON.stringify(checks, null, 2));
} finally {
  socket.close();
}
