"""Audit a reviewed China overlay, clip ocean, and optionally publish the result.

Run without --apply to produce draft.geo.json and a geometry audit. This is an
offline operation; patches and source hashes must match the prepared manifest.
"""
import argparse
import hashlib
import shutil
import sys
from datetime import datetime, timezone
from lib.china_gis import *
from shapely.geometry import Point, box
from shapely.ops import transform
from pyproj import Transformer
from shapely.prepared import prep
from shapely.strtree import STRtree
from lib.china_coast import CoastIndex, reconcile_weihai_parents
sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--reclip', action='store_true', help='Rebuild from the verified pre-coastal baseline, never the already clipped result')
parser.add_argument('--publish-draft', action='store_true', help='Publish the audited draft after rechecking all source and output hashes')
args = parser.parse_args()
if args.publish_draft and not args.apply:
    parser.error('--publish-draft requires --apply')
base = ROOT / 'data/boundaries/china-policy'
filename = ROOT / 'data/catalog/china.geo.json'
evidence = read_json(base / 'evidence.json')
prior_report = read_json(base / 'applied.json') if (base / 'applied.json').exists() else None
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
input_hash = sha(filename)
if prior_report and input_hash == prior_report['geometrySha256'] and not args.reclip:
    if sha(base / 'land-mask.geojson') != prior_report['landMaskSha256']:
        raise ValueError('Coastal mask changed; use --reclip with the preserved pre-coastal baseline')
    print('Reviewed China boundary policy is already applied.')
    sys.exit(0)
source_file = filename
if args.reclip:
    if not prior_report or input_hash != prior_report['geometrySha256']:
        raise ValueError('Reclip requires the exact previously reviewed dataset')
    source_file = base / 'references/pre-coastal-base.json'
if sha(source_file) != evidence['baseSha256']:
    raise ValueError('China source changed after review; rebase/review the overlay before applying')
for entry in evidence['sources'].values():
    if entry.get('localOnlyEvidence') and not (ROOT / entry['path']).exists():
        continue
    if sha(ROOT / entry['path']) != entry['sha256']:
        raise ValueError('Reviewed evidence changed: ' + entry['path'])
regions = {r['id']: r for r in read_json(ROOT / 'data/catalog/catalog.json')['regions'] if r['scope'] == 'china'}
patches = {p['regionId']: p for p in read_json(base / 'reviewed-patches.json')}
for name, key in [('reviewed-patches.json', 'patchesSha256'), ('south-china-sea-lines.geojson', 'maritimeLinesSha256')]:
    if evidence.get(key) and sha(base / name) != evidence[key]:
        raise ValueError('Reviewed policy artifact changed: ' + name)

def publish(output, report):
    if args.reclip:
        previous = base / 'references/coastal-previous-20261006.json'
        if not previous.exists():
            shutil.copyfile(filename, previous)
            write_json(base / 'references/coastal-previous-20261006.report.json', prior_report)
    protected = set(patches) | {r['regionId'] for r in report['clipping']}
    protected.update(r['regionId'] for r in report.get('coastalParentRepairs', []))
    write_json(base / 'published-overrides.json', [r for r in output if r['level'] == 'border' or r['regionId'] in protected])
    (base / 'draft.geo.json').replace(filename)
    report['applied'] = True
    report['rawOutlineSha256'] = sha(base / 'osm-land-outlines.geojson')
    write_json(base / 'applied.json', report)
    print('Applied reviewed China boundaries.', flush=True)

if args.publish_draft:
    draft = base / 'draft.geo.json'
    report = read_json(base / 'audit.json')
    expected = {'inputSha256': input_hash, 'sourceSha256': sha(source_file),
                'geometrySha256': sha(draft), 'landMaskSha256': sha(base / 'land-mask.geojson')}
    if any(report.get(key) != value for key, value in expected.items()):
        raise ValueError('Audited draft is stale; rebuild it before publishing')
    if report['applied'] or report['failures'] or report['hierarchyExceptions']:
        raise ValueError('Draft did not pass the required geometry audit')
    # A replaced review manifest must be audited again even if the land mask
    # and draft themselves were unchanged. Sources/patches are verified above.
    if (base / 'evidence.json').stat().st_mtime > draft.stat().st_mtime:
        raise ValueError('Review evidence changed after the draft was generated')
    output = read_json(draft)
    if len(output) != report['rows']:
        raise ValueError('Audited row count changed')
    publish(output, report)
    sys.exit(0)

rows = read_json(source_file)
mask = polygonal(unary_union([polygonal(shape(f['geometry'])) for f in read_json(base / 'land-mask.geojson')['features']]))
coast_report = read_json(base / 'coastal-mask-report.json')
coast_index = CoastIndex(mask, coast_report['nonCoastalClosure'])
write_json(base / 'osm-land-outlines.geojson', {'type': 'FeatureCollection', 'features': [{
    'type': 'Feature', 'properties': {
        'source': 'OpenStreetMap natural=coastline', 'license': 'ODbL-1.0',
        'landOnly': True, 'referenceCoastUsed': False,
        'purpose': 'Acquired raw land contours; administrative membership is separate',
    }, 'geometry': {'type': 'MultiLineString',
                    'coordinates': [list(line.coords) for line in coast_index.chunks]}
}]})
prepared_mask = prep(mask)
historical = {r['id'] for r in regions.values() if r['historical']}
output = []
seen = set()
empty = []
clipped = []
shapes = {}
for i, row in enumerate(rows):
    if row['level'] == 'border' or row['regionId'] in historical:
        continue
    patch = patches.get(row['regionId'])
    if patch and row['regionId'] in seen:
        continue
    seen.add(row['regionId'])
    raw = patch['geometry'] if patch else row['geometry']
    g = polygonal(shape(raw))
    # An inland feature wholly inside the mask can retain exact original points.
    result = polygonal(g.intersection(mask)) if not prepared_mask.covers(g) else g
    if result.is_empty:
        empty.append({'id': row['id'], 'regionId': row['regionId'], 'name': regions[row['regionId']]['name']})
        continue
    if not result.equals(g):
        if not regions.get(row['regionId'], {}).get('code', '').startswith(('11','12','13','21','31','32','33','35','37','44','45','46','71','81','82')):
            raise ValueError('Maritime mask unexpectedly clips inland region: ' + regions.get(row['regionId'], {}).get('name', row['id']))
        clipped.append({'regionId': row['regionId'], 'name': regions[row['regionId']]['name'],
                        'removedSquareDegrees': g.difference(result).area})
    output.append({**row, 'geometry': mapping(result)})
    shapes.setdefault(row['regionId'], []).append(result)
    if i % 250 == 0:
        print(json.dumps({'processed': i, 'total': len(rows)}), flush=True)
for rid, patch in patches.items():
    if rid in seen:
        continue
    g = polygonal(shape(patch['geometry']).intersection(mask))
    if g.is_empty:
        raise ValueError('New policy region has no land: ' + regions[rid]['name'])
    output.append({'id': 'policy-' + rid, **patch, 'geometry': mapping(g)})
    shapes[rid] = [g]
shapes = {rid: polygonal(unary_union(gs)) for rid, gs in shapes.items()}
parent_repairs = reconcile_weihai_parents(shapes, regions)
for row in output:
    if row['regionId'] in {r['regionId'] for r in parent_repairs}:
        row['geometry'] = mapping(shapes[row['regionId']])
national = polygonal(unary_union([shapes[row['regionId']] for row in output if row['level'] == 'province']))
# The international land border is one continuous route around the mainland.
# Remove the exact clipping coast, then retain the route through western and
# northeastern China. Other exterior pieces are islands or residual coast from
# an older administrative shoreline, and are already drawn as ordinary outlines.
mainland = max(polygons(national), key=lambda p: p.area)
print('Tracing land border against indexed original OSM coastline.', flush=True)
parts = coast_index.inland_runs(mainland.exterior)
land_border = max(parts, key=lambda line: line.length)
if not (land_border.bounds[0] < 75 and land_border.bounds[2] > 134 and land_border.bounds[3] > 53):
    raise ValueError('International land border was split or lost; refusing to thicken residual coast')
output.append({'id': 'china-reviewed-national', 'regionId': None, 'level': 'border',
               'boundaryKind': 'land',
               'geometry': {'type': 'MultiLineString', 'coordinates': [list(land_border.coords)]}})
dash = read_json(base / 'south-china-sea-lines.geojson')['features'][0]['geometry']
output.append({'id': 'china-official-south-china-sea-lines', 'regionId': None, 'level': 'border',
               'boundaryKind': 'maritime-dash', 'geometry': dash})
# Do not silently declare old administrative shoreline segments to be OSM.
# Keep unresolved exterior pieces as review evidence, never as thick borders.
pending_edges = [line for line in parts if line is not land_border and line.length > 1e-8]
write_json(base / 'coastal-pending-edges.geojson', {'type': 'FeatureCollection', 'features': [
    {'type': 'Feature', 'properties': {'status': 'needs-source-or-membership-review'},
     'geometry': mapping(line)} for line in pending_edges
]})
failures = []
previous_empty = {entry['regionId'] for entry in (prior_report or {}).get('emptyLandRows', [])}
new_empty = [entry for entry in empty if entry['regionId'] not in previous_empty]
if new_empty:
    failures.append('New coastline removed entire existing regions: ' + ', '.join(entry['name'] for entry in new_empty))
def geometry(code):
    r = next(r for r in regions.values() if r.get('code') == code and r['level'] == (0 if code.endswith('0000') else 2))
    return shapes[r['id']]
if geometry('420113').intersection(geometry('420114')).area > 1e-9:
    failures.append('Hannan/Caidian overlap')
if geometry('371003').intersection(geometry('371002')).area > 1e-9:
    failures.append('Wendeng/Huancui overlap')
if not geometry('371003').covers(Point(121.865, 36.97)):
    failures.append('Xiaoguan missing from Wendeng')
points = [
    ('350122', (119.936, 26.151), 'Matsu'), ('350305', (119.452, 24.991), 'Wuqiu'),
    ('350604', (118.234, 24.162), 'Dongding'), ('441581', (116.724, 20.705), 'Pratas'),
    ('460302', (112.338, 16.834), 'Yongxing'), ('460303', (114.37, 10.378), 'Taiping'),
]
for code, coordinate, name in points:
    if not geometry(code).covers(Point(*coordinate)):
        failures.append('Missing approved island: ' + name)
if not geometry('230883').covers(Point(135.05, 48.40)) or geometry('230883').bounds[2] < 135.08:
    failures.append('Heixiazi eastern land missing')
yilan = next(r for r in regions.values() if r['name'] == '宜兰县')
if not shapes[yilan['id']].covers(Point(123.475, 25.744)):
    failures.append('Diaoyu missing from Yilan')
if shapes[yilan['id']].intersection(geometry('350122')).area > 1e-9:
    failures.append('Yilan/Lianjiang overlap')
# The policy must keep every new island at all ancestor levels and preserve the
# official shared provincial line around TangguLa.
hierarchy = []
for rid in patches:
    parent = regions[rid].get('parentId')
    if parent not in regions or parent not in shapes or rid not in shapes:
        continue
    outside = shapes[rid].difference(shapes[parent]).area
    if outside > 1e-7:
        hierarchy.append({'name': regions[rid]['name'], 'parent': regions[parent]['name'], 'outsideSquareDegrees': outside})
invalid = [row['id'] for row in output if row['level'] != 'border' and not shape(row['geometry']).is_valid]
if invalid:
    failures.append('Invalid output geometries: ' + ', '.join(invalid[:20]))
if any(row['regionId'] in historical for row in output):
    failures.append('Historical geometry survived')
equal_area = Transformer.from_crs('EPSG:4326', 'EPSG:6933', always_xy=True).transform
areas = {code: round(transform(equal_area, geometry(code)).area / 1e6, 3) for code in ['420113', '420114', '371003', '460302', '460303']}

print('Checking exact coastal coverage at province, city and county levels.', flush=True)
samples = [
    ('ningbo-ordinary-coast', (121.8, 29.7, 122.15, 29.95)),
    ('hainan-northeast', (110.4, 19.8, 110.7, 20.12)),
    ('taiwan-northeast', (121.7, 24.95, 122.1, 25.25)),
    ('shandong-east', (122.3, 36.8, 122.6, 37.2)),
    ('fujian-review', (119.3, 25.8, 120, 26.5)),
]
coastal_samples = []
for level in ['province', 'city', 'county']:
    candidates = [shape(row['geometry']) for row in output if row['level'] == level]
    index = STRtree(candidates)
    for name, bounds in samples:
        window = box(*bounds)
        shoreline = unary_union([coast_index.chunks[int(i)] for i in coast_index.tree.query(window)]).intersection(window)
        covered = unary_union([candidates[int(i)].intersection(window) for i in index.query(window)])
        # Local millimetre allowance for floating-point overlay operations only.
        missing = shoreline.difference(covered.buffer(1e-8, quad_segs=1))
        coastal_samples.append({'name': name, 'level': level, 'bounds': bounds,
                                'osmCoastLengthDegrees': shoreline.length,
                                'missingLengthDegrees': missing.length,
                                'coveredFraction': 1 - missing.length / shoreline.length if shoreline.length else None})
draft = base / 'draft.geo.json'
write_json(draft, output)
report = {'createdAt': datetime.now(timezone.utc).isoformat(), 'inputSha256': input_hash,
          'sourceSha256': sha(source_file), 'sourceFile': str(source_file.relative_to(ROOT)),
          'geometrySha256': sha(draft), 'landMaskSha256': sha(base / 'land-mask.geojson'),
          'rawOutlineSha256': sha(base / 'osm-land-outlines.geojson'),
          'rows': len(output), 'patchedRegions': len(patches), 'clippedRows': len(clipped),
          'clipping': clipped, 'emptyLandRows': empty, 'areasKm2': areas,
          'hierarchyExceptions': hierarchy, 'failures': failures, 'applied': False,
          'landBorder': {'vertices': len(land_border.coords), 'bounds': land_border.bounds,
                         'endpoints': [land_border.coords[0], land_border.coords[-1]],
                         'excludedCoastalFragments': len(parts) - 1},
          'coastalSamples': coastal_samples,
          'pendingExteriorEdges': {'count': len(pending_edges),
                                   'lengthDegrees': sum(line.length for line in pending_edges),
                                   'file': 'data/boundaries/china-policy/coastal-pending-edges.geojson'},
          'pendingEstuaryRules': ['珠江口', '杭州湾', 'Other large estuaries require individual review'],
          'coastalParentRepairs': parent_repairs,
          'coastlineReport': 'data/boundaries/china-policy/coastal-mask-report.json'}
write_json(base / 'audit.json', report)
print(json.dumps({k: report[k] for k in ['rows','patchedRegions','clippedRows','emptyLandRows','areasKm2','hierarchyExceptions','failures']}, ensure_ascii=False), flush=True)
if failures:
    raise ValueError('Policy geometry validation failed; catalog was not changed')
if args.apply:
    publish(output, report)
