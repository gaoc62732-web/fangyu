import fs from 'node:fs/promises';
import osmtogeojson from 'osmtogeojson';
const base = new URL('../data/tmp/china-boundary-review/', import.meta.url);
const names = (await fs.readdir(base)).filter((name) =>
  /^(osm-full-\d+|hannan-streets|caidian-streets|suzhou-park-streets|wendeng-(north|middle|south)|disputed-geometries)\.json$/.test(
    name,
  ),
);
for (const name of names) {
  const raw = JSON.parse(await fs.readFile(new URL(name, base), 'utf8'));
  if (raw.remark) {
    console.log(`${name}: excluded incomplete response`);
    continue;
  }
  const ids = new Set(
    raw.elements.filter((e) => e.type === 'relation').map((e) => `relation/${e.id}`),
  );
  const collection = osmtogeojson(raw, { flatProperties: true });
  collection.features = collection.features.filter((f) => ids.has(f.id));
  for (const feature of collection.features) {
    if (
      feature.properties?.tainted ||
      !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
    )
      throw Error(`Incomplete relation ${feature.id} in ${name}`);
  }
  if (collection.features.length !== ids.size) throw Error(`Missing relations in ${name}`);
  await fs.writeFile(
    new URL(name.replace('.json', '.geojson'), base),
    JSON.stringify(collection) + '\n',
  );
  console.log(
    JSON.stringify({
      name,
      relations: collection.features.map((f) => ({
        id: f.id,
        name: f.properties['name:zh'] || f.properties.name,
      })),
    }),
  );
}
