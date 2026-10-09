import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { CatalogIndex } from '@fangyu/catalog';
import { HandbookSession } from '@fangyu/domain';
import { useAppStore } from '../app/store.js';
import CatalogPage from '../pages/CatalogPage.vue';
import MapSurface from '../components/MapSurface.vue';
import { beijing } from './fixtures.js';
import {
  navigationCatalog,
  ileDeFrance,
  paris,
  arrondissement,
  reunion,
  franceEntry,
} from './navigation-fixtures.js';

vi.mock('../components/MapSurface.vue', () => ({
  default: { template: '<div />', props: ['scope', 'points', 'level', 'selected', 'focus'] },
}));
let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

async function open(region = arrondissement) {
  const store = useAppStore();
  await store.load();
  store.session = new HandbookSession(new CatalogIndex(navigationCatalog));
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:scope', component: CatalogPage }],
  });
  await router.push({ path: '/france', query: { region, from: 'achievements' } });
  await router.isReady();
  wrapper = mount(CatalogPage, { props: { scope: 'france' }, global: { plugins: [router] } });
  return { store, router };
}
const map = () => wrapper!.findComponent(MapSurface);
const back = () => wrapper!.findAll('button').find((button) => button.text() === '返回上一级')!;

describe('country navigation', () => {
  it('opens France deep links, preserves grouping and follows the map level while going back', async () => {
    const { store, router } = await open();
    await wrapper!.find('.region-explorer').trigger('pointerenter', { pointerType: 'mouse' });
    expect(store.selectedRegionId).toBe(arrondissement);
    expect(wrapper!.find<HTMLSelectElement>('select[aria-label=地区]').element.value).toBe(
      ileDeFrance,
    );
    expect(
      wrapper!.find<HTMLSelectElement>('select[aria-label=法兰西岛省级单位]').element.value,
    ).toBe(paris);
    expect(map().props('level')).toBe('county');
    expect(wrapper!.findAll('optgroup').map((group) => group.attributes('label'))).toEqual([
      '法国本土（13）',
      '海外地区层级（5）',
    ]);
    await back().trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ region: paris, from: 'achievements' });
    await back().trigger('click');
    await flushPromises();
    expect(store.selectedRegionId).toBe(ileDeFrance);
    expect(map().props('level')).toBe('city');
    await wrapper!.find('select[aria-label=地区]').setValue(reunion);
    await flushPromises();
    expect(map().props('level')).toBe('province');
    expect(wrapper!.find('select[aria-label=法兰西岛省级单位]').exists()).toBe(false);
  });

  it('keeps point operations out of regions and rejects a deep link from another scope', async () => {
    const { store, router } = await open();
    expect(map().props('points')).toEqual([]);
    expect(map().props('focus')).toBeUndefined();
    await back().trigger('click');
    await flushPromises();
    expect(map().props('focus')).toBeUndefined();
    await router.push({ query: { region: beijing } });
    await flushPromises();
    expect(store.selectedRegionId).toBe('');
    expect(map().props('level')).toBe('province');
  });

  it('resets query/category/selection when changing country', async () => {
    const { store } = await open();
    await wrapper!.find('input[aria-label=搜索行政区]').setValue('巴黎');
    store.category = 'airport';
    await wrapper!.setProps({ scope: 'china' });
    expect(store.selectedRegionId).toBe('');
    expect(store.category).toBe('');
    await wrapper!.find('[aria-label="地区目录"]').trigger('click');
    expect((wrapper!.find('input[aria-label=搜索行政区]').element as HTMLInputElement).value).toBe(
      '',
    );
    expect(map().props('scope')).toBe('china');
  });

  it('keeps French ancestor counts and records through undo and compatible snapshot restoration', async () => {
    const { store } = await open();
    const session = store.session!;
    store.commit((current) => current.markEntry(franceEntry, true));
    await store.flush();
    expect([arrondissement, paris, ileDeFrance].every((id) => session.arrived(id))).toBe(true);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot()));
    snapshot.catalogVersion = 'test-previous';
    const restored = new HandbookSession(session.index, snapshot);
    expect(restored.snapshot().catalogVersion).toBe(navigationCatalog.version);
    expect(restored.view(restored.entry(franceEntry)).visited).toBe(true);
    expect([arrondissement, paris, ileDeFrance].every((id) => restored.arrived(id))).toBe(true);
    store.undo();
    await store.flush();
    expect([arrondissement, paris, ileDeFrance].every((id) => !session.arrived(id))).toBe(true);
  });
});
