import type { Catalog } from '@fangyu/contracts';
const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
const serverMode = import.meta.env.VITE_APP_MODE === 'server';
// The Windows launcher starts the local JSON admin service alongside Vite.
// Keep browserStorage/demo mode for records, while reading the editable
// catalogue from that service so another tab sees point edits immediately.
const loopbackHost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const localJsonMode =
  import.meta.env.VITE_LOCAL_JSON === '1' || (import.meta.env.DEV && !serverMode && loopbackHost);

export async function webCatalogRevision(): Promise<number | null> {
  if (!serverMode && !localJsonMode) return null;
  try {
    const url = localJsonMode
      ? apiBase + '/admin/china/visitor-catalog/revision'
      : apiBase + '/catalog/revision';
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const result = (await response.json()) as { revision?: number };
    return Number.isInteger(result.revision) ? Number(result.revision) : null;
  } catch {
    return null;
  }
}

export async function loadWebCatalogSnapshot(_baseUrl: string): Promise<{
  catalog: Catalog;
  revision: number | null;
}> {
  if (localJsonMode) {
    try {
      const response = await fetch(apiBase + '/admin/china/visitor-catalog', {
        cache: 'no-store',
      });
      if (response.ok) {
        const result = (await response.json()) as { catalog?: Catalog; revision?: number };
        if (result.catalog) {
          return {
            catalog: result.catalog,
            revision: Number.isInteger(result.revision) ? Number(result.revision) : null,
          };
        }
      }
    } catch {
      // Fall back to the generated snapshot when the optional local service is absent.
    }
  }
  if (!serverMode) {
    const baseUrl = _baseUrl;
    const manifestResponse = await fetch(baseUrl + 'catalog-manifest.json', {
      cache: 'no-cache',
    });
    if (!manifestResponse.ok) throw Error('无法加载目录索引：' + manifestResponse.status);
    const manifest = (await manifestResponse.json()) as { version: string; file: string };
    const url = baseUrl + manifest.file + '?v=' + encodeURIComponent(manifest.version);
    const cache =
      typeof caches !== 'undefined'
        ? await caches.open('fangyu-catalog-v1').catch(() => undefined)
        : undefined;
    let response = await cache?.match(url).catch(() => undefined);
    if (!response) {
      response = await fetch(url);
      if (!response.ok) throw Error('无法加载目录：' + response.status);
      await cache?.put(url, response.clone()).catch(() => {});
    }
    return { catalog: await decodeCatalogResponse(response), revision: null };
  }
  let response: Response;
  try {
    response = await fetch(apiBase + '/catalog', { cache: 'no-store' });
  } catch {
    throw Error('本机 JSON 服务不可用，无法读取最新目录数据。');
  }
  if (!response.ok) throw Error(`目录读取失败（${response.status}）`);
  const result = (await response.json()) as Catalog | { catalog: Catalog; revision?: number };
  if ('catalog' in result && result.catalog) {
    return {
      catalog: result.catalog,
      revision: Number.isInteger(result.revision) ? Number(result.revision) : null,
    };
  }
  return { catalog: result as Catalog, revision: await webCatalogRevision() };
}

export async function loadWebCatalog(baseUrl: string): Promise<Catalog> {
  return (await loadWebCatalogSnapshot(baseUrl)).catalog;
}

export async function decodeCatalogResponse(response: Response): Promise<Catalog> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw Error('目录内容为空');
  // Some static hosts serve .gz with Content-Encoding; fetch has already decoded it.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b)
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).json() as Promise<Catalog>;
  return JSON.parse(new TextDecoder().decode(bytes)) as Catalog;
}
