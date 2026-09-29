import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory, RouterView } from 'vue-router';
import { h, defineComponent } from 'vue';
import {
  HandbookSession,
  achievementProgress,
  quantityProgress,
  maofenProgress,
} from '@fangyu/domain';
import { CatalogIndex } from '@fangyu/catalog';
import { CatalogSearch } from '../features/catalog/query.js';
import { catalog, beijing, dongcheng } from './fixtures.js';
const io = vi.hoisted(() => ({
  write: vi.fn(async () => {}),
  archives: vi.fn(async () => []),
  saveArchive: vi.fn(async () => {}),
  queryGate: undefined as undefined | ((payload: any) => Promise<void>),
}));
vi.mock('../app/data-access.js', () => ({
  createAppDataAccess: () => ({
    read: async () => undefined,
    write: io.write,
    archives: io.archives,
    saveArchive: io.saveArchive,
    deleteArchive: async () => {},
  }),
}));
vi.mock('../app/catalog-loader.js', () => ({ loadWebCatalog: async () => catalog }));
vi.mock('../features/catalog/client.js', () => ({
  CatalogWorker: class {
    session: HandbookSession;
    search: CatalogSearch;
    constructor(c: any, s: any) {
      this.session = new HandbookSession(new CatalogIndex(c), s);
      this.search = new CatalogSearch(this.session);
    }
    async request(type: string, payload: any) {
      if (type === 'sync') {
        this.session = new HandbookSession(this.session.index, payload);
        this.search = this.search.update(this.session);
        return null;
      }
      if (type === 'query') {
        const result = this.search.query(payload);
        await io.queryGate?.(payload);
        return result;
      }
      if (type === 'achievements')
        return {
          badges: achievementProgress(this.session).map(({ targets, ...b }) => ({
            ...b,
            regionIds: [...new Set(targets.flatMap((t) => t.regionIds))],
          })),
          quantity: quantityProgress(this.session),
          score: maofenProgress(this.session),
        };
      if (type === 'achievement')
        return achievementProgress(this.session).find((b) => b.id === payload);
      return null;
    }
    destroy() {}
  },
}));
vi.mock('../components/MapSurface.vue', () => ({
  default: defineComponent({
    name: 'MapSurface',
    props: ['scope', 'state', 'selected', 'focused', 'points'],
    emits: ['select', 'point', 'candidates', 'camera', 'search'],
    setup(_, ctx) {
      ctx.expose({ fitRegion: vi.fn(), fitPoints: vi.fn(), locate: vi.fn() });
      return () => null;
    },
  }),
}));
vi.mock('../components/FootprintExport.vue', () => ({
  default: defineComponent({
    name: 'FootprintExport',
    setup() {
      return () => null;
    },
  }),
}));
import { useAppStore } from '../app/store.js';
import { useWorkspace } from '../app/workspace.js';
import CatalogPage from '../pages/CatalogPage.vue';
import CatalogList from '../components/CatalogList.vue';
import MapSurface from '../components/MapSurface.vue';
import EntryDetails from '../components/EntryDetails.vue';
import AchievementsPage from '../pages/AchievementsPage.vue';
import ImportsPage from '../pages/ImportsPage.vue';
let mounted: any[] = [];
beforeEach(() => {
  localStorage.clear();
  io.write.mockReset();
  io.write.mockResolvedValue(undefined);
  io.saveArchive.mockClear();
  io.queryGate = undefined;
  setActivePinia(createPinia());
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900,
  });
  HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 900,
    bottom: 600,
    width: 900,
    height: 600,
    toJSON() {},
  });
  if (!HTMLDialogElement.prototype.showModal)
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  for (const wrapper of mounted) wrapper.unmount();
  mounted = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup(component: any, path = '/map') {
  const store = useAppStore();
  await store.load();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/map', component: CatalogPage },
      { path: '/achievements', component: AchievementsPage },
      { path: '/manage', component: ImportsPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const root = mount(defineComponent({ setup: () => () => h(RouterView) }), {
    attachTo: document.body,
    global: { plugins: [router] },
  });
  mounted.push(root);
  await flushPromises();
  const wrapper = root.findComponent(component);
  return { wrapper, store, router, workspace: useWorkspace() };
}
describe('handbook interaction regression', () => {
  it('keeps regional context and the directory alive when inspecting and marking a point', async () => {
    const { wrapper, store, workspace } = await setup(CatalogPage);
    const w = workspace.state.scopes.china;
    w.selectedRegion = dongcheng;
    await flushPromises();
    w.scroll = 160;
    await flushPromises();
    const original = wrapper.findComponent(CatalogList).props('result').ids;
    const id = original[0]!;
    wrapper.findComponent(MapSurface).vm.$emit('point', id);
    await flushPromises();
    expect(w.selectedRegion).toBe(dongcheng);
    expect(w.query).toBe('');
    expect(wrapper.findComponent(CatalogList).props('result').ids).toEqual(original);
    wrapper.findComponent(EntryDetails).vm.$emit('mark', id, true, dongcheng);
    await flushPromises();
    await store.flush();
    expect(store.session!.view(store.session!.entry(id)).checked).toBe(true);
    expect(store.session!.arrived(dongcheng)).toBe(true);
    wrapper.findComponent(EntryDetails).vm.$emit('back');
    await flushPromises();
    expect(w.detail).toBe('');
    expect(w.scroll).toBe(160);
    store.undo();
    await flushPromises();
    expect(store.session!.view(store.session!.entry(id)).checked).toBe(false);
  });
  it('makes a selected district boundary visible when entering its handbook', async () => {
    const { router, workspace } = await setup(CatalogPage);
    await router.replace({ path: '/map', query: { region: dongcheng } });
    await flushPromises();
    expect(workspace.state.scopes.china.selectedRegion).toBe(dongcheng);
    expect(workspace.state.scopes.china.map.level).toBe('county');
  });
  it('opens a global category without changing camera or color semantics', async () => {
    const { wrapper, workspace } = await setup(CatalogPage);
    const w = workspace.state.scopes.china;
    w.selectedRegion = dongcheng;
    w.map.camera = { center: [116.4, 39.9], zoom: 10 };
    await flushPromises();
    wrapper.findComponent(CatalogList).vm.$emit('explore', 'world-heritage');
    await flushPromises();
    expect(w.mode).toBe('theme');
    expect(w.restrictTheme).toBe(false);
    expect(w.map.camera.zoom).toBe(10);
    expect(w.map.colorCategory).toBe('');
    expect(wrapper.findComponent(CatalogList).props('result').ids.length).toBe(245);
    w.view = 'list';
    await flushPromises();
    expect(wrapper.findComponent(CatalogList).props('result').ids.length).toBe(245);
    wrapper.findComponent(MapSurface).vm.$emit('select', beijing);
    await flushPromises();
    expect(wrapper.text()).toContain('地区预览');
    expect(wrapper.findComponent(CatalogList).props('result').ids.length).toBe(245);
  });
  it('restores category expansion and scroll when returning to a browsing context', async () => {
    const { wrapper, workspace } = await setup(CatalogPage);
    const w = workspace.state.scopes.china;
    w.selectedRegion = dongcheng;
    await flushPromises();
    w.expanded['world-heritage'] = true;
    w.expanded['entry:example'] = true;
    w.scroll = 160;
    await flushPromises();
    wrapper.findComponent(CatalogList).vm.$emit('explore', 'world-heritage');
    await flushPromises();
    expect(w.scroll).toBe(0);
    expect(w.expanded['entry:example']).toBeUndefined();
    w.mode = 'region';
    w.categories = [];
    await flushPromises();
    expect(w.scroll).toBe(160);
    expect(w.expanded['entry:example']).toBe(true);
  });
  it('restores a viewport result to the administrative directory', async () => {
    const { wrapper, workspace } = await setup(CatalogPage);
    workspace.state.scope = 'world';
    await flushPromises();
    const w = workspace.state.scopes.world;
    const before = wrapper.findComponent(CatalogList).props('result').ids.length;
    wrapper.findComponent(MapSurface).vm.$emit('search', [100, 20, 130, 50]);
    await flushPromises();
    const result = wrapper.findComponent(CatalogList).props('result');
    expect(result.ids.length).toBeLessThan(before);
    expect(result.ids.length).toBe(result.coordinateCount);
    w.bounds = null;
    await flushPromises();
    expect(wrapper.findComponent(CatalogList).props('result').ids.length).toBe(before);
  });
  it('requires an explicit region for a project with multiple owners', async () => {
    const { store } = await setup(CatalogPage);
    const entry = catalog.entries.find((e) => e.scope === 'japan' && e.regionIds.length > 1)!;
    const wrapper = mount(EntryDetails, {
      props: { id: entry.id, scope: 'japan', contextRegion: dongcheng },
    });
    mounted.push(wrapper);
    expect(wrapper.find('.visit-toggle input').attributes('disabled')).toBeDefined();
    await wrapper.find('select').setValue(entry.regionIds[1]);
    await wrapper.find('.visit-toggle input').setValue(true);
    expect(wrapper.emitted('mark')?.[0]?.[2]).toBe(entry.regionIds[1]);
    expect(store.session!.view(entry).visited).toBe(false);
  });
  it('preserves series and lazily opens targets instead of mounting every target', async () => {
    const { wrapper } = await setup(AchievementsPage, '/achievements');
    expect(wrapper.findAll('.series-nav button')).toHaveLength(9);
    expect(wrapper.text()).toContain('初涉阡陌');
    const button = wrapper.findAll('.series-nav button').find((x: any) => x.text() === '行遍')!;
    await button.trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.achievement-target')).toHaveLength(0);
    expect(wrapper.findAll('.achievement-card').length).toBeGreaterThan(0);
    await wrapper.find('.achievement-card').trigger('click');
    await flushPromises();
    expect(document.querySelector('input[placeholder="搜索目标"]')).not.toBeNull();
    expect(document.querySelectorAll('.achievement-target').length).toBeGreaterThan(0);
  });
  it('ignores superseded query results and limits rendered directory rows', async () => {
    const { wrapper, workspace } = await setup(CatalogPage);
    const w = workspace.state.scopes.china;
    w.selectedRegion = beijing;
    await flushPromises();
    w.expanded['cultural-monument'] = true;
    await flushPromises();
    expect(wrapper.findAll('.catalog-entry').length).toBeGreaterThan(0);
    expect(wrapper.findAll('.catalog-entry').length).toBeLessThan(35);
    let release!: () => void;
    io.queryGate = (payload) =>
      payload.text === '故宫' ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    w.query = '故宫';
    await flushPromises();
    w.query = '长城';
    await flushPromises();
    const latest = wrapper.findComponent(CatalogList).props('result').ids;
    release();
    await flushPromises();
    expect(wrapper.findComponent(CatalogList).props('result').ids).toEqual(latest);
  });
  it('cancels a pending import without losing its input or writing records', async () => {
    const { wrapper } = await setup(ImportsPage, '/manage');
    await wrapper.get('textarea').setValue('北京站 | 北京市');
    await wrapper
      .findAll('button')
      .find((b: any) => b.text() === '生成核对清单')!
      .trigger('click');
    await wrapper
      .findAll('button')
      .find((b: any) => b.text() === '取消任务')!
      .trigger('click');
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
    expect(wrapper.text()).toContain('已取消');
    expect(wrapper.get('textarea').element.value).toBe('北京站 | 北京市');
    expect(io.write).not.toHaveBeenCalled();
  });
  it('waits for persistence before reporting import success', async () => {
    const { wrapper, store } = await setup(ImportsPage, '/manage');
    await wrapper.get('textarea').setValue('北京站 | 北京市');
    await wrapper
      .findAll('button')
      .find((b: any) => b.text() === '生成核对清单')!
      .trigger('click');
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b: any) => b.text() === '核对变更摘要')!
      .trigger('click');
    await flushPromises();
    let release!: () => void;
    io.write.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const apply = [...document.querySelectorAll('dialog button')].find(
      (b) => b.textContent === '备份并确认应用',
    ) as HTMLButtonElement;
    apply.click();
    await flushPromises();
    expect(document.body.textContent).toContain('等待保存完成');
    expect(document.body.textContent).not.toContain('已保存，可通过撤销');
    release();
    await flushPromises();
    await store.flush();
    expect(document.body.textContent).toContain('已保存，可通过撤销');
  });
  it('surfaces persistence failure without falsely reporting completion or applying twice', async () => {
    const { wrapper } = await setup(ImportsPage, '/manage');
    io.write.mockRejectedValueOnce(Error('模拟保存冲突'));
    await wrapper.get('textarea').setValue('北京站 | 北京市');
    await wrapper
      .findAll('button')
      .find((b: any) => b.text() === '生成核对清单')!
      .trigger('click');
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b: any) => b.text() === '核对变更摘要')!
      .trigger('click');
    await flushPromises();
    (
      [...document.querySelectorAll('dialog button')].find(
        (b) => b.textContent === '备份并确认应用',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(document.body.textContent).toContain('模拟保存冲突');
    expect(document.body.textContent).not.toContain('已保存，可通过撤销');
    expect(io.write).toHaveBeenCalledTimes(1);
  });
});
