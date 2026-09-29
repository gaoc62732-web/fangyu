import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import vue from './apps/web/node_modules/@vitejs/plugin-vue/dist/index.mjs';
const webRequire = createRequire(new URL('./apps/web/package.json', import.meta.url));
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['apps/web/src/**/*.test.ts'],
    environment: 'happy-dom',
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
  },
  resolve: {
    alias: ['vue', 'pinia', 'vue-router'].map((name) => ({
      find: new RegExp('^' + name + '$'),
      replacement: webRequire.resolve(name),
    })),
  },
});
