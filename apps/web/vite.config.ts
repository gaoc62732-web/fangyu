import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync } from 'node:fs';

const localRecords = fileURLToPath(new URL('../../.local-records/record.json', import.meta.url));

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'local-records-bootstrap',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/local-records.json', (request, response, next) => {
          if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.localAddress || '')) {
            return next();
          }
          if (!existsSync(localRecords)) return next();
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          createReadStream(localRecords).pipe(response);
        });
      },
    },
  ],
  publicDir: fileURLToPath(new URL('../../data/catalog', import.meta.url)),
  base: process.env.VITE_PAGES_BASE || '/',
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { sourcemap: true },
});
