import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  publicDir: fileURLToPath(new URL('../../data/generated/web', import.meta.url)),
  base: process.env.VITE_PAGES_BASE || loadEnv(mode, process.cwd(), '').VITE_PAGES_BASE || '/',
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { sourcemap: true },
}));
