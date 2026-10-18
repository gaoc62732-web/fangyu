import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Catalog, GeometryFeature, Scope } from '@fangyu/contracts';
import { CatalogIndex } from '@fangyu/catalog';
import { assembleCatalog } from '../../../../../scripts/lib/assemble-manual-china.mjs';

function findProjectRoot(): string {
  let directory = resolve(process.cwd());
  while (true) {
    if (existsSync(resolve(directory, 'data/manual/china/manifest.json'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw Error('无法定位中国人工维护目录。');
}

@Injectable()
export class CatalogService {
  private pending: Promise<CatalogIndex> | undefined;
  private pendingRevision: number | undefined;
  private readonly root = findProjectRoot();
  private readonly configuredDirectory = process.env.CATALOG_DIRECTORY
    ? resolve(process.env.CATALOG_DIRECTORY)
    : undefined;
  private readonly directory = this.configuredDirectory && existsSync(resolve(this.configuredDirectory, 'catalog.json'))
    ? this.configuredDirectory
    : resolve(this.root, 'data/catalog');

  async revision(): Promise<number> {
    const manifest = JSON.parse(
      await readFile(resolve(this.root, 'data/manual/china/manifest.json'), 'utf8'),
    ) as { adminRevision?: number };
    return Number(manifest.adminRevision || 0);
  }

  async index(): Promise<CatalogIndex> {
    const revision = await this.revision();
    if (!this.pending || this.pendingRevision !== revision) {
      this.pendingRevision = revision;
      this.pending = assembleCatalog(this.root)
        .then((catalog) => new CatalogIndex(catalog as Catalog))
        .catch((error) => {
          if (this.pendingRevision === revision) {
            this.pending = undefined;
            this.pendingRevision = undefined;
          }
          throw error;
        });
    }
    return this.pending;
  }

  async geometry(scope: Scope): Promise<GeometryFeature[]> {
    const text = await readFile(resolve(this.directory, scope + '.geo.json'), 'utf8');
    return JSON.parse(text) as GeometryFeature[];
  }
}
