import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useAppStore } from '../app/store.js';
import { storage } from './setup.js';
import { airport, beijing, dongcheng, station } from './fixtures.js';
import EntryList from '../components/EntryList.vue';
import MapSurface from '../components/MapSurface.vue';
import CatalogPage from '../pages/CatalogPage.vue';
import ImportsPage from '../pages/ImportsPage.vue';
import RecordsPage from '../pages/RecordsPage.vue';

vi.mock('../components/MapSurface.vue', () => ({
  default: {
    template: '<div />',
    props: { points: null, selected: null, scope: null, regionMode: Boolean },
    emits: ['select'],
  },
}));
let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});
const button = (text: string) => wrapper!.findAll('button').find((item) => item.text() === text)!;
async function openCatalog() {
  const store = useAppStore();
  await store.load();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/china', component: CatalogPage, props: { scope: 'china' } },
      { path: '/imports', component: ImportsPage },
    ],
  });
  await router.push('/china?region=' + beijing);
  await router.isReady();
  wrapper = mount(CatalogPage, { props: { scope: 'china' }, global: { plugins: [router] } });
  return store;
}

describe('regional and record UI', () => {
  it('locates a record in the point module without replacing the remembered region selection', async () => {
    const store = useAppStore();
    await store.load();
    store.selectedRegionId = dongcheng;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/records', component: RecordsPage },
        { path: '/points', component: { template: '<div />' } },
      ],
    });
    await router.push('/records');
    await router.isReady();
    wrapper = mount(RecordsPage, { global: { plugins: [router] } });
    wrapper
      .findComponent(EntryList)
      .vm.$emit('locate', store.session!.view(store.session!.entry(station)));
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/points');
    expect(router.currentRoute.value.query).toEqual({ entry: station, scope: 'china' });
    expect(store.category).toBe('railway-station');
    expect(store.selectedRegionId).toBe(dongcheng);
  });
  it('keeps region selection and recording separate from point operations', async () => {
    const store = await openCatalog();
    const map = wrapper!.findComponent(MapSurface);
    expect(map.props('points')).toEqual([]);
    expect(map.props('regionMode')).toBe(true);
    expect(wrapper!.findComponent(EntryList).exists()).toBe(false);
    map.vm.$emit('select', dongcheng);
    await flushPromises();
    await wrapper!.find('.state-select select').setValue('arrived');
    await store.flush();
    expect(store.session!.arrived(dongcheng)).toBe(true);
    expect(store.session!.view(store.session!.entry(airport)).visited).toBe(false);
    store.undo();
    expect(store.session!.arrived(dongcheng)).toBe(false);
  });

  it('finds administrative regions and reopens the selected details without a point focus', async () => {
    const store = await openCatalog();
    await wrapper!.find('[aria-label="搜索行政区"]').setValue('东城');
    expect(wrapper!.findAll('.region-row')).toHaveLength(1);
    await wrapper!.find('.region-row').trigger('click');
    expect(store.selectedRegionId).toBe(dongcheng);
    await wrapper!.find('[aria-label="收起地区资料栏"]').trigger('click');
    expect(wrapper!.find('.region-panel').exists()).toBe(false);
    await wrapper!.find('[aria-label="地区目录"]').trigger('click');
    expect(wrapper!.find('.region-panel h1').text()).toBe('东城区');
    expect(wrapper!.findComponent(MapSurface).props('selected')).toBe(dongcheng);
  });

  it('marks an entry and propagates the region in one reversible transaction', async () => {
    const store = useAppStore();
    await store.load();
    wrapper = mount(EntryList, { props: { rows: store.rows, selectedRegionId: dongcheng } });
    await wrapper.find('input[type=checkbox]').setValue(true);
    await store.flush();
    expect(store.session!.view(store.session!.entry(airport)).visited).toBe(true);
    expect(store.session!.arrived(dongcheng)).toBe(true);
    store.undo();
    await store.flush();
    expect(store.session!.view(store.session!.entry(airport)).visited).toBe(false);
    expect(store.session!.arrived(dongcheng)).toBe(false);
  });

  it('does not announce a completed import before persistence succeeds', async () => {
    const store = useAppStore();
    await store.load();
    let finishSave!: () => void;
    storage.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    wrapper = mount(ImportsPage);
    await wrapper.find('textarea[aria-label=名称清单]').setValue('测试车站');
    await button('生成预览').trigger('click');
    await flushPromises();
    await button('备份并确认应用').trigger('click');
    await flushPromises();
    expect(store.session!.view(store.session!.entry(station)).visited).toBe(true);
    expect(wrapper.text()).not.toContain('已应用，可通过撤销或存档恢复。');
    expect(storage.saveArchive).toHaveBeenCalledOnce();
    finishSave();
    await flushPromises();
    expect(wrapper.text()).toContain('已应用，可通过撤销或存档恢复。');
  });

  it('shows a failed import save and prevents applying that plan again', async () => {
    const store = useAppStore();
    await store.load();
    storage.write.mockRejectedValueOnce(Error('disk unavailable'));
    wrapper = mount(ImportsPage);
    await wrapper.find('textarea[aria-label=名称清单]').setValue('测试车站');
    await button('生成预览').trigger('click');
    await flushPromises();
    await button('备份并确认应用').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('disk unavailable');
    expect(wrapper.text()).not.toContain('已应用，可通过撤销或存档恢复。');
    expect(button('备份并确认应用').attributes('disabled')).toBeDefined();
  });
});
