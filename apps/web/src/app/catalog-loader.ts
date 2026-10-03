import type { Catalog } from '@fangyu/contracts';
export async function loadWebCatalog(baseUrl: string): Promise<Catalog> {
  const manifestResponse = await fetch(baseUrl + 'catalog-manifest.json', { cache: 'no-cache' });
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
  return decodeCatalogResponse(response);
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
