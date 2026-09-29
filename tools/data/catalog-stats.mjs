import { readFile } from 'node:fs/promises';

const directory = new URL('../../data/catalog/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('catalog.json', directory), 'utf8'));
const result = {
  version: catalog.version,
  regions: catalog.regions.length,
  entries: catalog.entries.length,
  categories: catalog.categories.length,
  achievementDefinitions: catalog.achievements.definitions.length,
  withCoordinates: catalog.entries.filter((entry) => entry.coordinates).length,
  withSubitems: catalog.entries.filter((entry) => entry.subitems.length).length,
};
console.log(JSON.stringify(result, null, 2));
