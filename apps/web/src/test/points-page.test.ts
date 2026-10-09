import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { CatalogIndex } from '@fangyu/catalog';
import { HandbookSession } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import PointsPage from '../pages/PointsPage.vue';
import SettingsPage from '../pages/SettingsPage.vue';
import MapSurface from '../components/MapSurface.vue';
import { airport, station, dongcheng, beijing, catalog } from './fixtures.js';
import { navigationCatalog, franceEntry } from './navigation-fixtures.js';
vi.mock('../components/MapSurface.vue', () => ({
  default: {
    name: 'MapSurface',
    props: {
      scope: null,
      selected: null,
      level: null,
      category: null,
      points: null,
      initialCamera: null,
      previewRegions: null,
      pointMode: Boolean,
    },
    emits: ['point', 'cluster', 'select', 'level', 'settings'],
    template: '<div class="map-stub" />',
  },
}));
let wrapper: VueWrapper | undefined;
afterEach(() => wrapper?.unmount());
async function open(fixture = catalog, path = '/') {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(310);
  const store = useAppStore();
  await store.load();
  store.session = new HandbookSession(new CatalogIndex(fixture));
  store.category = 'airport';
  store.regionalMap = {
    scope: 'china',
    selected: dongcheng,
    level: 'city',
    camera: { center: [116.5, 39.8], zoom: 10 },
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: PointsPage },
      { path: '/settings', component: SettingsPage },
      { path: '/china', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  wrapper = mount(PointsPage, { global: { plugins: [router] } });
  return store;
}
function map() {
  return wrapper!.findComponent(MapSurface);
}
async function select(id = airport) {
  map().vm.$emit('point', id);
  await flushPromises();
}
describe('point page interactions', () => {
  it('opens a record location in its own scope and category when the requested scope is unrelated', async () => {
    const fixture = structuredClone(navigationCatalog);
    fixture.entries.find((entry) => entry.id === franceEntry)!.categoryId = 'railway-station';
    const store = await open(fixture, `/?entry=${franceEntry}&scope=china`);
    await flushPromises();
    expect(map().props()).toMatchObject({
      scope: 'france',
      category: 'railway-station',
      initialCamera: { center: [2.34, 48.86], zoom: 14 },
    });
    expect(wrapper!.find('.point-panel h3').text()).toBe('法国测试地点');
    expect(store.session!.snapshot().entries).toEqual({});
    expect(store.regionalMap!.scope).toBe('china');
  });
  it('opens record details without coordinates while preserving the same-scope camera', async () => {
    const fixture = structuredClone(catalog);
    fixture.entries.find((entry) => entry.id === station)!.coordinates = null;
    await open(fixture, `/?entry=${station}&scope=china`);
    await flushPromises();
    expect(map().props('category')).toBe('railway-station');
    expect(map().props('initialCamera')).toEqual({ center: [116.5, 39.8], zoom: 10 });
    expect(wrapper!.find('.point-panel h3').text()).toBe('测试车站');
    expect(map().props('points')?.[0]?.coordinates).toBeNull();
  });
  it('opens just one filter menu on hover and changes category without changing the inherited camera', async () => {
    await open();
    const camera = map().props('initialCamera');
    await wrapper!.find('.point-filters').trigger('pointerenter', { pointerType: 'mouse' });
    await wrapper!.find('.atlas-scope-select').trigger('pointerenter', { pointerType: 'mouse' });
    expect(wrapper!.findAll('[role="listbox"]')).toHaveLength(1);
    await wrapper!.find('.atlas-category-select').trigger('pointerenter', { pointerType: 'mouse' });
    expect(wrapper!.findAll('[role="listbox"]')).toHaveLength(1);
    const stationOption = wrapper!
      .findAll('[role="option"]')
      .find((option) => option.text() === '铁路车站')!;
    await stationOption.trigger('click');
    expect(map().props('category')).toBe('railway-station');
    expect(map().props('initialCamera')).toEqual(camera);
    expect(wrapper!.find('[role="listbox"]').exists()).toBe(false);
    await wrapper!.find('.point-filters').trigger('pointerleave', { pointerType: 'mouse' });
    expect(wrapper!.find('.atlas-filter-options').exists()).toBe(false);
    expect(wrapper!.find('[aria-label="地点目录"]').exists()).toBe(true);
  });
  it('adjusts the docked detail width by keyboard while preserving the inherited map camera', async () => {
    await open();
    await select();
    const before = map().props('initialCamera');
    const handle = wrapper!.find('[role="separator"]');
    const width = Number(handle.attributes('aria-valuenow'));
    await handle.trigger('keydown', { key: 'ArrowLeft' });
    expect(Number(handle.attributes('aria-valuenow'))).toBe(width + 20);
    await handle.trigger('keydown', { key: 'Home' });
    expect(Number(handle.attributes('aria-valuenow'))).toBe(320);
    expect(map().props('initialCamera')).toEqual(before);
  });
  it('inherits the regional camera and reopens details without changing camera or point focus', async () => {
    await open();
    expect(map().props()).toMatchObject({
      selected: dongcheng,
      level: 'city',
      initialCamera: { center: [116.5, 39.8], zoom: 10 },
      pointMode: true,
    });
    await select();
    expect(wrapper!.find('.point-primary-action').text()).toBe('点亮此地点');
    await wrapper!.find('[aria-label="收起资料栏"]').trigger('click');
    expect(wrapper!.find('.point-panel').exists()).toBe(false);
    await wrapper!.find('.restore-details').trigger('click');
    expect(wrapper!.find('.point-panel h3').text()).toBe('测试机场');
    expect(map().props('initialCamera')).toEqual({ center: [116.5, 39.8], zoom: 10 });
    expect(map().props('focus')).toBeUndefined();
  });
  it('previews a region and skipping only the association still saves the point', async () => {
    const store = await open();
    await select();
    expect(map().props('previewRegions')).toEqual([dongcheng]);
    expect(store.session!.snapshot().regions).toEqual({});
    await wrapper!.find('.point-primary-action').trigger('click');
    expect(map().props('previewRegions')).toEqual([dongcheng]);
    expect(wrapper!.find('.point-facts').exists()).toBe(false);
    expect(store.session!.view(store.session!.entry(airport)).visited).toBe(false);
    await wrapper!.findAll('.point-confirm-actions button')[1]!.trigger('click');
    await store.flush();
    expect(store.session!.view(store.session!.entry(airport)).visited).toBe(true);
    expect(store.session!.snapshot().regions).toEqual({});
    store.undo();
    expect(store.session!.view(store.session!.entry(airport)).visited).toBe(false);
  });
  it('requires an explicit region selection for a cross-region point even in automatic mode', async () => {
    const fixture = structuredClone(catalog);
    const otherProvince = '00000000-0000-4000-8000-000000000020';
    fixture.regions.push({
      ...fixture.regions[0]!,
      id: otherProvince,
      name: '另一省',
      code: '120000',
    });
    fixture.entries[0]!.regionIds = [dongcheng, otherProvince];
    const store = await open(fixture);
    store.commit((s) =>
      s.updatePreferences({
        pointCheckin: { children: 'ask', identities: 'ask', regions: 'auto' },
      }),
    );
    await select();
    expect(map().props('previewRegions')).toEqual([dongcheng, otherProvince]);
    await wrapper!.find('.point-primary-action').trigger('click');
    expect(wrapper!.findAll('.point-choice')).toHaveLength(2);
    expect(map().props('previewRegions')).toEqual([]);
    await wrapper!.findAll('.point-choice input')[0]!.setValue(true);
    await wrapper!.find('.point-confirm-actions .point-primary-action').trigger('click');
    expect(store.session!.arrived(dongcheng)).toBe(true);
    expect(store.session!.arrived(otherProvince)).toBe(false);
  });
  it('asks about reviewed other identities and saves them with the primary point in one undo', async () => {
    const fixture = structuredClone(catalog);
    fixture.entryRelations = [{ fromEntryId: airport, toEntryId: station, kind: 'same-place' }];
    const store = await open(fixture);
    store.commit((s) =>
      s.updatePreferences({
        pointCheckin: { children: 'ask', identities: 'ask', regions: 'never' },
      }),
    );
    await select();
    await wrapper!.find('.point-primary-action').trigger('click');
    expect(wrapper!.find('.point-confirmation h4').text()).toContain('其他身份');
    await wrapper!.find('.point-choice input').setValue(true);
    await wrapper!.find('.point-confirm-actions .point-primary-action').trigger('click');
    expect(store.session!.view(store.session!.entry(station)).checked).toBe(true);
    store.undo();
    expect(store.session!.view(store.session!.entry(station)).checked).toBe(false);
    expect(store.session!.view(store.session!.entry(airport)).checked).toBe(false);
  });
  it('leaves partially overlapping records untouched and lets coordinates be absent', async () => {
    const fixture = structuredClone(catalog);
    fixture.entries[0]!.coordinates = null;
    fixture.entryRelations = [{ fromEntryId: airport, toEntryId: station, kind: 'overlaps' }];
    const store = await open(fixture);
    await wrapper!.find('[aria-label="地点目录"]').trigger('click');
    expect(wrapper!.text()).toContain('暂无坐标');
    await wrapper!.find('.point-list-row').trigger('click');
    await wrapper!.find('.point-primary-action').trigger('click');
    expect(wrapper!.find('.point-confirmation h4').text()).toContain('行政区');
    await wrapper!.findAll('.point-confirm-actions button')[1]!.trigger('click');
    expect(store.session!.view(store.session!.entry(station)).visited).toBe(false);
  });
  it('allows selecting one child without lighting siblings or writing a total-project record', async () => {
    const fixture = structuredClone(catalog);
    const parent = '00000000-0000-4000-8000-000000000021';
    fixture.entries.push({ ...fixture.entries[0]!, id: parent, recordId: parent, name: '总项目' });
    fixture.heritageProjects = [
      {
        unescoId: '1',
        name: '总项目',
        sourceUrl: '',
        checkedAt: '',
        coverage: 'complete',
        expectedComponentCount: 2,
        legacyEntryIds: [parent],
        componentEntryIds: [airport, station],
      },
    ];
    const store = await open(fixture);
    store.commit((s) =>
      s.updatePreferences({
        pointCheckin: { children: 'ask', identities: 'ask', regions: 'never' },
      }),
    );
    await select(parent);
    await wrapper!.find('.point-primary-action').trigger('click');
    await wrapper!.findAll('.point-choice input')[0]!.setValue(true);
    await wrapper!.find('.point-confirm-actions .point-primary-action').trigger('click');
    expect(store.session!.view(store.session!.entry(airport)).checked).toBe(true);
    expect(store.session!.view(store.session!.entry(station)).checked).toBe(false);
    expect(store.session!.snapshot().entries[parent]).toBeUndefined();
    expect(wrapper!.find('.point-status').text()).toContain('部分到访');
  });
  it('uses the saved automatic child policy while keeping total state derived', async () => {
    const fixture = structuredClone(catalog);
    fixture.entries[0]!.subitems = [
      { id: beijing, name: 'A' },
      { id: station, name: 'B' },
    ];
    const store = await open(fixture);
    store.commit((s) =>
      s.updatePreferences({
        pointCheckin: { children: 'auto', identities: 'never', regions: 'never' },
      }),
    );
    await select();
    await wrapper!.find('.point-primary-action').trigger('click');
    expect(wrapper!.find('.point-confirmation').exists()).toBe(false);
    expect(store.session!.subitemVisited(airport, beijing)).toBe(true);
    expect(store.session!.subitemVisited(airport, station)).toBe(true);
    expect(store.session!.snapshot().entries[airport]!.visited).toBe(false);
    expect(store.session!.snapshot().regions).toEqual({});
  });
  it('shows old shared identities without allowing a point-page write', async () => {
    const fixture = structuredClone(catalog);
    fixture.entries[1]!.recordId = airport;
    await open(fixture);
    await select();
    expect(wrapper!.find('.point-primary-action').attributes('disabled')).toBeDefined();
    expect(wrapper!.text()).toContain('共用旧记录');
  });
  it('saves the confirmed primary point when leaving an association prompt', async () => {
    const store = await open();
    await select();
    await wrapper!.find('.point-primary-action').trigger('click');
    wrapper!.unmount();
    wrapper = undefined;
    await store.flush();
    expect(store.session!.view(store.session!.entry(airport)).checked).toBe(true);
    expect(store.session!.snapshot().regions).toEqual({});
  });
  it('persists each independent policy through the settings page', async () => {
    const store = await open();
    wrapper!.unmount();
    wrapper = mount(SettingsPage);
    await wrapper.find('[aria-label="总项目与组成地点"]').setValue('auto');
    await wrapper.find('[aria-label="同一地点的其他类别"]').setValue('never');
    await wrapper.find('[aria-label="所在行政区划"]').setValue('never');
    await store.flush();
    expect(store.session!.preferences.pointCheckin).toEqual({
      children: 'auto',
      identities: 'never',
      regions: 'never',
    });
  });
  it('lets the independent module edit preferences while retaining its map camera', async () => {
    const store = await open();
    const before = map().props('initialCamera');
    map().vm.$emit('settings');
    await flushPromises();
    await wrapper!.find('[aria-label="所在行政区"]').setValue('never');
    expect(store.session!.preferences.pointCheckin?.regions).toBe('never');
    expect(map().props('initialCamera')).toEqual(before);
    expect(wrapper!.find('.atlas-policy-field').exists()).toBe(true);
    expect(wrapper!.find('.point-panel').exists()).toBe(false);
    expect(wrapper!.find('.point-preferences-popover').exists()).toBe(true);
    expect(wrapper!.find('.atlas-header-actions button').exists()).toBe(false);
    await wrapper!.find('[aria-label="关闭记录偏好"]').trigger('click');
    await select();
    map().vm.$emit('settings');
    await flushPromises();
    expect(wrapper!.find('.point-panel h3').text()).toBe('测试机场');
    expect(wrapper!.find('.point-preferences-popover').exists()).toBe(true);
    expect(map().props('initialCamera')).toEqual(before);
  });
});
