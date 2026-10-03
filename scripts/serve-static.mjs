import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve(process.argv[2] || 'public');
const port = Number(process.argv[3] || 5192);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port.');
if (!existsSync(path.join(directory, 'index.html'))) throw Error('Missing public/index.html.');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
  let requested;
  try {
    requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    return response.writeHead(400).end();
  }
  const file = path.resolve(directory, '.' + (requested === '/' ? '/index.html' : requested));
  if (!file.startsWith(directory + path.sep)) return response.writeHead(403).end();
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return response.writeHead(404).end('Not found');
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  if (request.method === 'HEAD') return response.end();
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`方舆本地预览：http://127.0.0.1:${port}/#/china\n按 Ctrl+C 关闭。仅绑定本机地址。`),
);
