import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useAppStore } from '../app/store.js';
import { storage } from './setup.js';
import { airport, beijing, dongcheng, station } from './fixtures.js';
import CategoryEntryList from '../components/CategoryEntryList.vue';
import EntryList from '../components/EntryList.vue';
import CatalogPage from '../pages/CatalogPage.vue';
import ImportsPage from '../pages/ImportsPage.vue';

vi.mock('../components/MapSurface.vue', () => ({
  default: { template: '<div />', props: ['points'] },
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

describe('current handbook UI', () => {
  it('filters descendant entries and marks them through the current category list', async () => {
    const store = await openCatalog();
    expect(
      wrapper!
        .findComponent(CategoryEntryList)
        .props('rows')
        .map((row: { id: string }) => row.id),
    ).toEqual([airport, station]);
    await wrapper!
      .findAll('.category-trigger')
      .find((item) => item.text().includes('机场'))!
      .trigger('click');
    expect(wrapper!.findComponent(EntryList).props('rows')).toHaveLength(1);
    await wrapper!.findComponent(EntryList).find('input[type=checkbox]').setValue(true);
    await store.flush();
    expect(store.session!.view(store.session!.entry(airport)).visited).toBe(true);
  });

  it('refreshes cached search text after editing a name and accepts unaccented queries', async () => {
    const store = await openCatalog();
    const search = wrapper!.find('input[aria-label=搜索目录]');
    await search.setValue('不存在的名称');
    expect(wrapper!.findComponent(CategoryEntryList).props('rows')).toHaveLength(0);
    store.commit((session) => session.editEntry(airport, 'Sân bay Đà Nẵng', ''));
    await store.flush();
    await search.setValue('da nang');
    expect(
      wrapper!
        .findComponent(CategoryEntryList)
        .props('rows')
        .map((row: { id: string }) => row.id),
    ).toEqual([airport]);
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
