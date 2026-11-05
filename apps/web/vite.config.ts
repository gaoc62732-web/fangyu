import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';

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

interface LocalAdminService {
  process?: ChildProcess;
  starting?: Promise<void>;
  users: Set<symbol>;
}

// Vite creates the new server before closing the old one on a config reload.
// Share ownership across those two plugin instances so the old server cannot
// kill the API that the new server has just reused.
const localAdminServices = ((globalThis as typeof globalThis & {
  __fangyuLocalAdminServices?: Map<string, LocalAdminService>;
}).__fangyuLocalAdminServices ||= new Map<string, LocalAdminService>());

function adminApiPlugin(target: string) {
  const endpoint = new URL(target);
  const local = endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
  const owner = Symbol('vite-admin-api');
  let service: LocalAdminService | undefined;

  async function stopApi(current: LocalAdminService) {
    const child = current.process;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
    });
  }

  async function ensureApi() {
    const current = service!;
    if (current.starting) return current.starting;
    const isReady = async () => {
      try {
        // An open TCP port alone does not establish that the admin routes work.
        const response = await fetch(target + '/api/v1/admin/china/visitor-catalog/revision', {
          signal: AbortSignal.timeout(2000),
        });
        return response.ok && Number.isInteger((await response.json()).revision);
      } catch {
        return false;
      }
    };
    current.starting = (async () => {
      if (await isReady()) return;
      let startError: Error | undefined;
      if (
        !current.process ||
        current.process.exitCode !== null ||
        current.process.signalCode !== null
      ) {
        console.info(`[fangyu] Starting local admin API at ${target}`);
        const child = spawn(process.execPath, ['--import', 'tsx', 'src/admin-main.ts'], {
          cwd: fileURLToPath(new URL('../api', import.meta.url)),
          env: { ...process.env, ADMIN_PORT: endpoint.port || '80' },
          stdio: ['ignore', 'inherit', 'inherit'],
          windowsHide: true,
        });
        current.process = child;
        child.once('error', (error) => {
          startError = error;
        });
        const stopOnExit = () => {
          child.kill();
        };
        process.once('exit', stopOnExit);
        child.once('close', () => process.removeListener('exit', stopOnExit));
        child.once('exit', (code) => {
          process.removeListener('exit', stopOnExit);
          if (!child.killed)
            console.error(
              `[fangyu] Local admin API exited (${code}); the next request will restart it.`,
            );
        });
      }
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (startError) throw startError;
        if (current.process?.exitCode !== null || current.process?.signalCode !== null) break;
        if (await isReady()) {
          console.info(`[fangyu] Local admin API ready at ${target}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await stopApi(current);
      throw new Error(`Local admin API is unavailable at ${target}. See the backend output above.`);
    })();
    try {
      await current.starting;
    } finally {
      delete current.starting;
    }
  }

  return {
    name: 'fangyu-local-admin-api',
    apply: 'serve' as const,
    async configureServer(server: import('vite').ViteDevServer) {
      if (!local) return;
      service = localAdminServices.get(target) || { users: new Set() };
      localAdminServices.set(target, service);
      service.users.add(owner);
      await ensureApi();
      server.middlewares.use('/api/v1/admin', (_request, response, next) => {
        void ensureApi().then(
          () => next(),
          (error: Error) => {
            server.config.logger.error(error.message);
            response.statusCode = 503;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(
              JSON.stringify({ message: '本机管理服务启动失败，请查看启动终端的后端日志。' }),
            );
          },
        );
      });
    },
    async closeBundle() {
      if (!service) return;
      service.users.delete(owner);
      if (service.users.size) return;
      await service.starting?.catch(() => {});
      if (service.users.size) return;
      await stopApi(service);
      localAdminServices.delete(target);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000';
  const adminEndpoint = new URL(env.VITE_ADMIN_API_PROXY_TARGET || 'http://127.0.0.1:3001');
  if (adminEndpoint.hostname === 'localhost') adminEndpoint.hostname = '127.0.0.1';
  const adminApiTarget = adminEndpoint.href.replace(/\/$/, '');
  return {
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
      adminApiPlugin(adminApiTarget),
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
            if (!existsSync(localRecords)) {
              response.statusCode = 404;
              response.end();
              return;
            }
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store');
            createReadStream(localRecords).pipe(response);
          });
        },
      },
    ],
    publicDir: fileURLToPath(new URL('../../data/generated/web', import.meta.url)),
    base: env.VITE_PAGES_BASE || '/',
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/v1/admin': adminApiTarget,
        '/api': apiTarget,
      },
    },
    build: { sourcemap: false, manifest: true },
  };
});
