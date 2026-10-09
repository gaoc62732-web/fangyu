import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
export function useResizablePanel(workspace: Ref<HTMLElement | undefined>) {
  const workspaceWidth = ref(window.innerWidth);
  const preferredWidth = ref(390);
  const maxWidth = computed(() => Math.max(320, Math.min(680, workspaceWidth.value - 320)));
  const width = computed(() => Math.min(maxWidth.value, preferredWidth.value));
  const resizing = ref(false);
  let start: { x: number; width: number } | undefined;
  let observer: ResizeObserver | undefined;
  const setWidth = (value: number) => {
    preferredWidth.value = Math.max(320, Math.min(maxWidth.value, value));
  };
  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    start = { x: event.clientX, width: width.value };
    resizing.value = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (start) setWidth(start.width + start.x - event.clientX);
  }
  function up() {
    start = undefined;
    resizing.value = false;
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') setWidth(width.value + 20);
    else if (event.key === 'ArrowRight') setWidth(width.value - 20);
    else if (event.key === 'Home') setWidth(320);
    else if (event.key === 'End') setWidth(maxWidth.value);
    else return;
    event.preventDefault();
  }
  onMounted(() => {
    observer = new ResizeObserver(() => {
      if (workspace.value) workspaceWidth.value = workspace.value.clientWidth;
    });
    if (workspace.value) observer.observe(workspace.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return { width, maxWidth, resizing, down, move, up, key };
}
