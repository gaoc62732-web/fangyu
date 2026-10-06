import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    environment: 'happy-dom',
    testTimeout: 20000,
    hookTimeout: 20000,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
