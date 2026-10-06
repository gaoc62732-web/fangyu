import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import PointSelect from '../components/PointSelect.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => wrapper?.unmount());
function open() {
  wrapper = mount(
    defineComponent({
      components: { PointSelect },
      setup() {
        return {
          selected: ref('a'),
          expanded: ref(false),
          options: [
            { value: 'a', label: '机场' },
            { value: 'b', label: '车站' },
          ],
        };
      },
      template:
        '<PointSelect v-model="selected" v-model:open="expanded" label="点位类别" :options="options" /><button class="outside">地图</button>',
    }),
    { attachTo: document.body },
  );
  return wrapper;
}
describe('point filter menus', () => {
  it('opens on mouse hover and closes on leave without changing the selected category', async () => {
    const w = open();
    await w.find('.point-select').trigger('pointerenter', { pointerType: 'mouse' });
    expect(w.find('[role="listbox"]').exists()).toBe(true);
    expect(w.find('[aria-label="点位类别"]').text()).toBe('机场');
    await w.find('.point-select').trigger('pointerleave', { pointerType: 'mouse' });
    expect(w.find('[role="listbox"]').exists()).toBe(false);
    expect(w.find('[aria-label="点位类别"]').text()).toBe('机场');
  });
  it('allows keyboard selection and restores focus on Escape', async () => {
    const w = open();
    const trigger = w.find<HTMLButtonElement>('.point-select-trigger');
    trigger.element.focus();
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    const choices = w.findAll('[role="option"]');
    expect(document.activeElement).toBe(choices[0]!.element);
    await choices[0]!.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(choices[1]!.element);
    await choices[1]!.trigger('click');
    expect(trigger.text()).toBe('车站');
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    await w.find('[role="listbox"]').trigger('keydown', { key: 'Escape' });
    expect(w.find('[role="listbox"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });
  it('supports touch taps and closes on a tap outside the menu', async () => {
    const w = open();
    await w.find('.point-select').trigger('pointerenter', { pointerType: 'touch' });
    expect(w.find('[role="listbox"]').exists()).toBe(false);
    await w.find('.point-select-trigger').trigger('click');
    await w.find('.point-select').trigger('pointerleave', { pointerType: 'touch' });
    expect(w.find('[role="listbox"]').exists()).toBe(true);
    await w.find('.outside').trigger('pointerdown');
    expect(w.find('[role="listbox"]').exists()).toBe(false);
  });
});
