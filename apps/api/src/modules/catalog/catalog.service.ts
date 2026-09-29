import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Catalog, GeometryFeature, Scope } from '@fangyu/contracts';
import { CatalogIndex } from '@fangyu/catalog';

@Injectable()
export class CatalogService {
  private pending: Promise<CatalogIndex> | undefined;
  private readonly directory = resolve(process.env.CATALOG_DIRECTORY || '../../data/catalog');

  async index(): Promise<CatalogIndex> {
    this.pending ??= readFile(resolve(this.directory, 'catalog.json'), 'utf8')
      .then((text) => new CatalogIndex(JSON.parse(text) as Catalog))
      .catch((error) => {
        this.pending = undefined;
        throw error;
      });
    return this.pending;
  }

  async geometry(scope: Scope): Promise<GeometryFeature[]> {
    const text = await readFile(resolve(this.directory, scope + '.geo.json'), 'utf8');
    return JSON.parse(text) as GeometryFeature[];
  }
}
