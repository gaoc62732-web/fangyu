import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useAppStore } from '../app/store.js';
import { routes } from '../app/router.js';
import AppHeader from '../components/AppHeader.vue';
import { dongcheng } from './fixtures.js';
vi.mock('../components/MapSurface.vue', () => ({ default: { template: '<div />' } }));
let wrapper: VueWrapper | undefined;
afterEach(() => wrapper?.unmount());
describe('module navigation', () => {
  it('shows four primary entries and keeps secondary functions in more', async () => {
    const store = useAppStore();
    await store.load();
    store.regionalMap = { scope: 'china', selected: dongcheng, level: 'county' };
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/points');
    wrapper = mount(AppHeader, { global: { plugins: [router] } });
    expect(wrapper.findAll('nav a').map((a) => a.text())).toEqual([
      '区域点卯',
      '点位点卯',
      '成就',
      '导入导出',
    ]);
    expect(wrapper.find('nav [aria-current="page"]').text()).toBe('点位点卯');
    const destination = wrapper.findAll('nav a')[0]!;
    expect(destination.attributes('href')).toContain('/regions/china?region=' + dongcheng);
    await wrapper.find('summary').trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.find('details').attributes('open')).toBeDefined();
    expect(wrapper.findAll('.module-more-menu a').map((a) => a.text())).toEqual([
      '记录',
      '卯分',
      '存档与外观',
      '使用说明',
    ]);
    await router.push('/regions/china');
    await flushPromises();
    expect(wrapper.find('details').attributes('open')).toBeUndefined();
    expect(wrapper.find('nav [aria-current="page"]').text()).toBe('区域点卯');
  });
  it('preserves legacy country deep links and the selected member of the old collection', async () => {
    await useAppStore().load();
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/france?region=example&from=achievements');
    expect(router.currentRoute.value.path).toBe('/regions/france');
    expect(router.currentRoute.value.query).toEqual({ region: 'example', from: 'achievements' });
    await router.push('/malay-region?country=singapore');
    expect(router.currentRoute.value.path).toBe('/regions/singapore');
    await router.push('/regions/not-a-topic');
    expect(router.currentRoute.value.path).toBe('/regions/china');
  });
});
