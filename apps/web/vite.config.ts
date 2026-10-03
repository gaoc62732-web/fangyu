import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const buildId = new Date()
  .toISOString()
  .replace(/[-:.]/g, '')
  .replace(/\d{3}Z$/, 'Z');
let buildCommit = 'unknown',
  buildDirty = true;
try {
  buildCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  buildDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
} catch {
  /* Build metadata never includes environment variables or configuration contents. */
}
const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  .version as string;
const buildInfo = {
  version: packageVersion,
  id: buildId,
  commit: buildCommit,
  dirty: buildDirty,
  stage: packageVersion.includes('-dev') ? 'development' : 'release',
};

const localRecords = fileURLToPath(new URL('../../.local-records/record.json', import.meta.url));

export default defineConfig({
  define: { __FANGYU_BUILD__: JSON.stringify(buildInfo) },
  plugins: [
    {
      name: 'fangyu-build-identity',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify(buildInfo),
        });
      },
    },
    vue(),
    {
      name: 'local-records-bootstrap',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/local-records.json', (request, response, next) => {
          if (
            !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.localAddress || '')
          ) {
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
  publicDir: fileURLToPath(new URL('../../data/generated/web', import.meta.url)),
  base: process.env.VITE_PAGES_BASE || '/',
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { sourcemap: false },
});
