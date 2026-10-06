"""Locate acquired OSM land omitted by administrative faces; never assign it.

Windows only delimit this diagnostic. They are not used to cut or publish any
administrative geometry. Directly administered counties supplement city level.
"""
from datetime import datetime, timezone
from lib.china_gis import *
from shapely.geometry import box
from shapely.strtree import STRtree
from shapely.ops import transform
from pyproj import Transformer
import sys

sys.stdout.reconfigure(encoding='utf-8')
base = ROOT / 'data/boundaries/china-policy'
regions = {r['id']: r for r in read_json(ROOT / 'data/catalog/catalog.json')['regions']}
rows = [r for r in read_json(ROOT / 'data/catalog/china.geo.json') if r['level'] != 'border']
geometries = [shape(r['geometry']) for r in rows]
tree = STRtree(geometries)
pending_file = base / 'coastal-pending-edges.geojson'
pending = read_json(pending_file)
kept = []
for feature in pending['features']:
    line = shape(feature['geometry'])
    midpoint = line.interpolate(.5, normalized=True)
    # Parent repairs can turn a former exterior chord into an interior line.
    inside = any(rows[int(i)]['level'] == 'province' and
                 geometries[int(i)].contains(midpoint) and
                 geometries[int(i)].boundary.distance(midpoint) > 1e-8
                 for i in tree.query(midpoint))
    if not inside:
        kept.append(feature)
pending['features'] = kept
write_json(pending_file, pending)
for name in ['applied.json', 'audit.json']:
    report = read_json(base / name)
    report['pendingExteriorEdges'] = {'count': len(kept),
        'lengthDegrees': sum(shape(f['geometry']).length for f in kept),
        'file': 'data/boundaries/china-policy/coastal-pending-edges.geojson'}
    write_json(base / name, report)
land = shape(read_json(base / 'land-mask.geojson')['features'][0]['geometry'])
projection = Transformer.from_crs(4326, 6933, always_xy=True).transform
features = []
samples = []
windows = [('fujian', (119.3, 25.8, 120, 26.5)),
           ('taiwan-northeast', (121.7, 24.95, 122.1, 25.25)),
           ('wendeng', (122.1, 36.9, 122.3, 37.1)),
           ('dandong-estuary', (124.25, 39.93, 124.37, 40.01))]
for name, bounds in windows:
    window = box(*bounds)
    local = [(rows[int(i)], geometries[int(i)].intersection(window)) for i in tree.query(window)]
    for level in ['province', 'city', 'county']:
        selected = [g for r, g in local if r['level'] == level or
                    (level == 'city' and r['level'] == 'county' and
                     regions.get(regions[r['regionId']].get('parentId'), {}).get('level') == 0)]
        covered = unary_union(selected)
        missing = land.intersection(window).difference(covered)
        area = transform(projection, missing).area / 1e6
        pieces = [p for p in polygons(missing) if transform(projection, p).area > 1]
        samples.append({'name': name, 'level': level, 'missingKm2': area,
                        'piecesLargerThanOneSquareMetre': len(pieces)})
        for p in pieces:
            near = tree.query(p, predicate='dwithin', distance=.02)
            candidates = sorted({regions[rows[int(i)]['regionId']]['name'] for i in near
                                 if rows[int(i)]['level'] == level})
            point = p.representative_point()
            properties = {'window': name, 'level': level,
                          'areaKm2': transform(projection, p).area / 1e6,
                          'representativePoint': [point.x, point.y],
                          'nearbyNamesForReviewOnly': candidates,
                          'status': 'unassigned; proximity is not administrative evidence'}
            features.append({'type': 'Feature', 'properties': properties, 'geometry': mapping(p)})
write_json(base / 'coastal-unassigned-land.geojson', {'type': 'FeatureCollection', 'features': features})
write_json(base / 'coastal-coverage-review.json', {
    'createdAt': datetime.now(timezone.utc).isoformat(), 'samples': samples,
    'note': 'City level includes directly administered counties. Diagnostic windows do not alter geometry.',
    'unassignedLandFile': 'data/boundaries/china-policy/coastal-unassigned-land.geojson',
    'pieces': [f['properties'] for f in sorted(features, key=lambda f: -f['properties']['areaKm2'])],
})
print(json.dumps(samples, ensure_ascii=False), flush=True)
