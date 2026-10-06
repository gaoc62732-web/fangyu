"""Build a maritime land mask from directed OSM high-water coastlines.

OSM coastline directions put land on the left. Polygonizing the connected graph
also handles coastlines that meet at a node; ocean/lagoon faces are rejected by
their direction. Open fragments are never closed into invented islands. The
only artificial closure is inland, outside China's administrative extent.
This script is offline. Acquisition and publication are separate operations.
"""
import hashlib
import math
import re
import shutil
import sys
from datetime import datetime, timezone
from urllib.parse import unquote
from lib.china_gis import *
from shapely.geometry import Point
from shapely.ops import linemerge

sys.stdout.reconfigure(encoding='utf-8')
base = ROOT / 'data/boundaries/china-policy'
cache = ROOT / 'data/tmp/china-boundary-review'
destination = base / 'land-mask.geojson'
report_file = base / 'coastal-mask-report.json'

paths = [p for p in sorted(cache.glob('coast-*.json')) if not p.name.endswith('.source.json')]
if not paths and destination.exists() and report_file.exists():
    frozen = read_json(report_file)
    if hashlib.sha256(destination.read_bytes()).hexdigest() != frozen['sha256']:
        raise ValueError('Frozen coastal mask hash changed')
    print('Using verified frozen mask; original acquisition cache unavailable.')
    sys.exit(0)

offshore_names = ['spratly-coastlines.json', 'paracel-coastlines.json',
                  'spratly-missing-coastlines.json', 'islands-mazu.json',
                  'islands-wuqiu.json', 'islands-dongding.json',
                  'islands-pratas.json', 'islands-diaoyu.json']
paths += [cache / name for name in offshore_names if (cache / name).exists()]
responses = []
rejected = []
for path in paths:
    value = read_json(path)
    if value.get('remark'):
        rejected.append(path.name)
        continue
    responses.append((value.get('osm3s', {}).get('timestamp_osm_base', ''), path, value))

# Reconcile coordinates through OSM node IDs, using the newest acquired snapshot.
# Rounding or joining nearby points could invent a coast across a genuine gap.
ways, node_coordinates = {}, {}
sources = []
superseded_ways = []
for _, path, value in sorted(responses, key=lambda item: (item[0], item[1].name)):
    metadata_file = path.with_name(path.name + '.source.json')
    metadata = read_json(metadata_file) if metadata_file.exists() else {}
    current_ways = {e['id'] for e in value.get('elements', [])
                    if e['type'] == 'way' and e.get('tags', {}).get('natural') == 'coastline'}
    bbox_match = re.search(r'way\["natural"="coastline"\]\(([\d., -]+)\)', unquote(metadata.get('url', '')))
    if bbox_match:
        south_y, west_x, north_y, east_x = map(float, bbox_match[1].split(','))
        # A newer complete bbox query supersedes earlier ways within that bbox,
        # including deleted/split ways absent from its response. Keeping those
        # old IDs can produce two conflicting coastlines at the same location.
        retired = [wid for wid, element in ways.items() if wid not in current_ways and
                   any(west_x <= p['lon'] <= east_x and south_y <= p['lat'] <= north_y
                       for p in element['geometry'])]
        for wid in retired:
            del ways[wid]
            superseded_ways.append({'wayId': wid, 'supersededBy': path.name})
    for element in value.get('elements', []):
        if element['type'] != 'way' or element.get('tags', {}).get('natural') != 'coastline':
            continue
        if len(element.get('geometry', [])) < 2:
            raise ValueError('Missing OSM coastline geometry: ' + str(element['id']))
        ways[element['id']] = element
        for node, coordinate in zip(element['nodes'], element['geometry'], strict=True):
            node_coordinates[node] = (coordinate['lon'], coordinate['lat'])
    data_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    if metadata.get('sha256') and metadata['sha256'] != data_hash:
        raise ValueError('Coast acquisition hash changed: ' + path.name)
    shutil.copyfile(path, base / 'sources' / path.name)
    sources.append({**metadata, 'path': 'data/boundaries/china-policy/sources/' + path.name,
                    'sha256': data_hash, 'osmBase': value.get('osm3s', {}).get('timestamp_osm_base')})

lines = [LineString([node_coordinates[node] for node in element['nodes']]) for element in ways.values()]
merged = linemerge(lines, directed=True)
chains = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
opened = [line for line in chains if not line.is_closed]
south = min((tuple(line.coords[0]) for line in opened if line.bounds[1] < 22 and line.bounds[0] < 108),
            key=lambda p: abs(p[0] - 107.5) + abs(p[1] - 21.3))
north = max((tuple(line.coords[-1]) for line in opened if line.bounds[3] > 39 and line.bounds[2] > 124.35),
            key=lambda p: p[0])
closure = LineString([north, (136, north[1]), (136, 56), (70, 56), (70, 0), (south[0], 0), south])

directed = set()
for line in lines:
    coordinates = list(line.coords)
    directed.update((a, b) for a, b in zip(coordinates, coordinates[1:]) if a != b)

def direction_votes(polygon):
    """Positive length has land on the face's inside; negative length has ocean."""
    ring = polygon.exterior
    sign = 1 if ring.is_ccw else -1
    land, ocean = 0.0, 0.0
    coordinates = list(ring.coords)
    for a, b in zip(coordinates, coordinates[1:]):
        orientation = 1 if (a, b) in directed else -1 if (b, a) in directed else 0
        distance = math.hypot(b[0] - a[0], b[1] - a[1])
        if orientation * sign > 0:
            land += distance
        elif orientation * sign < 0:
            ocean += distance
    return land, ocean

print(json.dumps({'ways': len(ways), 'points': sum(len(line.coords) for line in lines),
                  'openChains': len(opened), 'closureEndpoints': [south, north]}), flush=True)
land_faces, rejected_ocean, ambiguous = [], 0, []
for face in polygonize(unary_union([*lines, closure])):
    land_length, ocean_length = direction_votes(face)
    total = land_length + ocean_length
    if total == 0:
        continue
    fraction = land_length / total
    if 0.01 < fraction < 0.99:
        ambiguous.append({'bounds': face.bounds, 'landDirectionFraction': fraction})
    if fraction > 0.99:
        land_faces.append(face)
    else:
        rejected_ocean += 1

land = polygonal(unary_union(land_faces))
write_json(cache / 'coastal-graph-audit.json', {
    'landFaces': len(land_faces), 'rejectedOceanFaces': rejected_ocean,
    'ambiguous': ambiguous,
    'openChains': [{'start': list(line.coords[0]), 'end': list(line.coords[-1]),
                    'bounds': line.bounds, 'vertices': len(line.coords)} for line in opened],
})
for point in [(116.4, 39.9), (121.47, 31.23), (113.26, 23.13), (100.45, 21.96), (90, 32), (135.05, 48.4)]:
    if not land.covers(Point(*point)):
        raise ValueError('OSM mainland coast is still disconnected; missing land witness ' + str(point))
for point in [(122, 25), (118, 20), (123, 36)]:
    if land.covers(Point(*point)):
        raise ValueError('Unexpected ocean face included: ' + str(point))
for point in [(110.33, 20.02), (121.56, 25.04), (119.568, 23.567), (121.489, 22.660), (122.079, 25.628)]:
    if not land.covers(Point(*point)):
        raise ValueError('OSM Hainan/Taiwan coastline is incomplete: ' + str(point))
if ambiguous:
    raise ValueError('Mixed OSM coastline directions require review: ' + json.dumps(ambiguous[:20]))

write_json(destination, {'type': 'FeatureCollection', 'features': [{
    'type': 'Feature', 'properties': {
        'source': 'OpenStreetMap directed high-water coastline', 'license': 'ODbL-1.0',
        'landOnly': True, 'reefOrTidalFlatSymbols': False, 'referenceCoastUsed': False,
    }, 'geometry': mapping(land)}]})
expected = read_json(base / 'coastal-region-queries.json')
missing_broad_queries = [job['name'] for job in expected if not (cache / job['name']).exists()]
write_json(report_file, {
    'createdAt': datetime.now(timezone.utc).isoformat(), 'sources': sources,
    'referenceCoastUsed': False, 'referenceCurrency': 'not applicable; OSM replaces reference mask',
    'completeOsmQueries': [path.name for _, path, _ in responses], 'rejectedIncomplete': rejected,
    'broadQueriesReplacedBySlices': missing_broad_queries,
    'pendingCompleteOsmQueries': [],
    'osmWays': len(ways), 'osmVertices': sum(len(line.coords) for line in lines),
    'supersededWays': superseded_ways,
    'landFaces': len(land_faces), 'rejectedOceanFaces': rejected_ocean,
    'ambiguousDirectionFaces': ambiguous,
    'unclosedFragments': [{'start': list(line.coords[0]), 'end': list(line.coords[-1]),
                          'bounds': line.bounds, 'vertices': len(line.coords)} for line in opened],
    'mainlandClosureEndpoints': [south, north],
    'nonCoastalClosure': list(closure.coords),
    'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
    'limitation': 'OSM high-water coastline is not a cadastral survey. Open fragments do not create land; no reefs, tidal flats or underwater terrain queried.',
})
print(json.dumps({'mask': str(destination), 'landFaces': len(land_faces), 'oceanFaces': rejected_ocean,
                  'bounds': land.bounds}), flush=True)
