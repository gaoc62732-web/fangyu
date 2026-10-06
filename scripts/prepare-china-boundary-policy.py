"""Build an offline, reviewable overlay from approved China boundary evidence.

This script never downloads data. It writes policy patches; apply them separately
with apply-china-boundary-policy.py after the geometry audit succeeds.
"""
import hashlib
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from lib.china_gis import *
from shapely.geometry import box

sys.stdout.reconfigure(encoding='utf-8')
BASE = ROOT / 'data/boundaries/china-policy'
CACHE = ROOT / 'data/tmp/china-boundary-review'
if (BASE / 'applied.json').exists():
    published = read_json(BASE / 'applied.json')
    if hashlib.sha256((ROOT / 'data/catalog/china.geo.json').read_bytes()).hexdigest() == published['geometrySha256']:
        print('Reviewed China policy is already applied; no rebase requested.')
        sys.exit(0)
SOURCES = BASE / 'sources'
SOURCES.mkdir(parents=True, exist_ok=True)
catalog = read_json(ROOT / 'data/catalog/catalog.json')
regions = {r['id']: r for r in catalog['regions'] if r['scope'] == 'china'}
by_code = {r.get('code'): r for r in regions.values() if not r['historical'] and r.get('code') != '710000'}
by_code['710000'] = next(r for r in regions.values() if r['name'] == '台湾省')
rows = read_json(ROOT / 'data/catalog/china.geo.json')
grouped = {}
for row in rows:
    if row['level'] != 'border':
        grouped.setdefault(row['regionId'], []).append(polygonal(shape(row['geometry'])))
original = {rid: polygonal(unary_union(gs)) for rid, gs in grouped.items()}
current = dict(original)
evidence = {}
changes = []
def source(name):
    destination = SOURCES / name
    if (CACHE / name).exists():
        shutil.copyfile(CACHE / name, destination)
    if not destination.exists():
        raise FileNotFoundError(f'Required evidence missing: {name}')
    metadata = CACHE / (name + '.source.json')
    value = read_json(metadata) if metadata.exists() else {}
    if not value.get('url'):
        for listing in BASE.glob('*downloads*.json'):
            for item in read_json(listing):
                if item.get('name') == name:
                    value['url'] = item['url']
    value['sha256'] = hashlib.sha256(destination.read_bytes()).hexdigest()
    value['path'] = destination.relative_to(ROOT).as_posix()
    if name.endswith('.html'):
        value['localOnlyEvidence'] = True
    evidence[name] = value
    return destination
def geo(name):
    return read_json(source(name))['features']
def region(code):
    return by_code[code]
def get(code):
    return current.get(region(code)['id'], Polygon())
def set_region(r, geometry, reason):
    geometry = polygonal(geometry)
    if geometry.is_empty:
        raise ValueError('Cannot remove whole region ' + r['name'])
    before = current.get(r['id'], Polygon())
    current[r['id']] = geometry
    changes.append({'regionId': r['id'], 'name': r['name'], 'code': r.get('code'), 'reason': reason,
                    'addedSquareDegrees': geometry.difference(before).area,
                    'removedSquareDegrees': before.difference(geometry).area})
    # Carry the exact local edit through parent levels, preserving other detail.
    removed, added = before.difference(geometry), geometry.difference(before)
    parent = r.get('parentId')
    while parent in regions:
        prior = current.get(parent, Polygon())
        current[parent] = polygonal(prior.difference(removed).union(added))
        parent = regions[parent].get('parentId')
def set_code(code, geometry, reason):
    set_region(region(code), geometry, reason)
def union_files(names):
    return polygonal(unary_union([shape(f['geometry']) for name in names for f in geo(name)]))
def official(name):
    return {f['properties']['gb'][3:]: polygonal(shape(f['geometry'])) for f in geo(name)
            if f['geometry']['type'] in ['Polygon', 'MultiPolygon']}

# Government explanations establish legal membership; OSM supplies detailed edges.
for name in ['hannan-government-division.html', 'hannan-government-history.html',
             'wendeng-government-division.html', 'wendeng-government-towns.html']:
    if (CACHE / name).exists() or (SOURCES / name).exists():
        source(name)
hannan = union_files(['osm-full-' + str(i) + '.geojson' for i in [8667530, 17345597, 17345598, 17345599]])
caidian = union_files(['caidian-streets.geojson'])
if len(polygons(hannan)) != 1 or hannan.intersection(caidian).area > 1e-10:
    raise ValueError('Hannan streets do not form an exclusive complete district')
set_code('420113', hannan, 'Four formal Hannan streets; development-zone management excluded')
set_code('420114', get('420114').union(caidian).difference(hannan), 'Restore three formally Caidian streets managed by the development zone')
wendeng = union_files(['wendeng-north.geojson', 'wendeng-middle.geojson'] +
                      ['osm-full-' + str(i) + '.geojson' for i in [17544813, 17544814, 17544815, 17544816, 17544819]])
set_code('371003', wendeng, 'Three streets and twelve towns; Xiaoguan retained; Wangtuan and Manshan excluded under 2014 division')
set_code('371002', get('371002').difference(wendeng), 'Formal Huancui/Wendeng separation')

provinces = official('tdt-provinces.geojson')
source('tdt-provinces.bin')
western_counties = {}
for name in ['tdt-counties-653100.geojson', 'tdt-hotan-counties-retry.geojson']:
    western_counties.update(official(name))
    source(name.replace('.geojson', '.bin'))
western_audit = []
for name, window in [('Aksai Chin', box(77.5, 34.1, 80.9, 36.6)), ('Shaksgam', box(76.0, 35.4, 78.4, 37.1))]:
    official_piece = provinces['650000'].intersection(window)
    old_piece = get('650000').intersection(window)
    western_audit.append({'name': name, 'countyCodes': [c for c,g in western_counties.items() if g.intersection(window).area > 0.01],
                          'officialAddedSquareDegrees': official_piece.difference(old_piece).area,
                          'officialRemovedSquareDegrees': old_piece.difference(official_piece).area,
                          'status': 'Compared available visualization outlines; no precision national-line replacement without further evidence'})
tibet_counties = {}
for name in ['tdt-counties-540200.geojson', 'tdt-counties-540400.geojson',
             'tdt-shannan-counties-retry.geojson', 'tdt-counties-540600.geojson',
             'tdt-counties-542500.geojson']:
    tibet_counties.update(official(name))
    source(name.replace('.geojson', '.bin'))
tibet_cities = official('tdt-tibet-cities.geojson')
source('tdt-tibet-cities.bin')
disputes = geo('disputed-geometries.geojson')
source('disputed-geometries.json')
# OSM disputed areas locate the review windows only. Official geometry controls
# every replacement, including where claimed_by geometries disagree with it.
review_windows = []
dispute_audit = []
for feature in disputes:
    g = polygonal(shape(feature['geometry']))
    window = box(*g.bounds).buffer(0.05, join_style=2)
    review_windows.append(window)
    official_part = provinces['540000'].intersection(window)
    dispute_audit.append({'relation': feature['id'],
                          'name': feature['properties'].get('name:zh', feature['properties'].get('name')),
                          'osmReferenceArea': g.area,
                          'outsideOfficialArea': g.difference(provinces['540000']).area,
                          'countyCodes': [c for c, p in tibet_counties.items() if p.intersection(g).area > 1e-8]})
# Chumar and Doklam are approved review locations with no complete OSM dispute
# polygon in the downloaded reference set. Do not invent a claimed-area polygon.
review_windows.extend([box(78.9, 32.35, 79.35, 32.8), box(88.85, 27.1, 89.3, 27.55)])
dispute_zone = polygonal(unary_union(review_windows))
for code, official_shape in tibet_counties.items():
    if code not in by_code:
        continue
    old = get(code)
    if not old.intersects(dispute_zone) and not official_shape.intersects(dispute_zone):
        continue
    set_code(code, old.difference(dispute_zone).union(official_shape.intersection(dispute_zone)),
             'Approved India/Bhutan review windows; official TianDiTu county edges')
for code, official_shape in tibet_cities.items():
    if not get(code).intersects(dispute_zone) and not official_shape.intersects(dispute_zone):
        continue
    set_code(code, get(code).difference(dispute_zone).union(official_shape.intersection(dispute_zone)),
             'Official parent boundary in approved India/Bhutan review windows')
set_code('540000', get('540000').difference(dispute_zone).union(provinces['540000'].intersection(dispute_zone)),
         'Official national outline in approved India/Bhutan review windows')

# TangguLa: preserve references for every affected county, not only Anduo/Golmud.
qinghai_counties = {}
for name in ['tdt-haixi-counties-retry.geojson', 'tdt-yushu-counties.geojson']:
    qinghai_counties.update(official(name))
    source(name.replace('.geojson', '.bin'))
tanggula_zone = box(88.8, 31.9, 94.8, 35.1)
for code, g in {**qinghai_counties, **tibet_counties}.items():
    if code not in by_code or not (code.startswith('63') or code.startswith('5406')):
        continue
    if not get(code).intersects(tanggula_zone) and not g.intersects(tanggula_zone):
        continue
    set_code(code, get(code).difference(tanggula_zone).union(g.intersection(tanggula_zone)),
             'TangguLa formal county boundary; retain original management geometry as reference')
for code in ['630000', '540000']:
    set_code(code, get(code).difference(tanggula_zone).union(provinces[code].intersection(tanggula_zone)),
             'TangguLa official Qinghai/Tibet province boundary')
for code, county_codes in [('632700', [c for c in qinghai_counties if c.startswith('6327')]),
                           ('632800', [c for c in qinghai_counties if c.startswith('6328')])]:
    city_piece = polygonal(unary_union([qinghai_counties[c] for c in county_codes])).intersection(tanggula_zone)
    set_code(code, get(code).difference(tanggula_zone).union(city_piece), 'TangguLa formal prefecture boundary from official constituent counties')
set_code('540600', get('540600').difference(tanggula_zone).union(tibet_cities['540600'].intersection(tanggula_zone)),
         'TangguLa official Nagqu boundary')

# Heixiazi: the official shape reaches the Amur/Ussuri junction along midstream.
heixiazi_zone = box(134.35, 48.14, 135.2, 48.52)
fuyuan = official('tdt-fuyuan-counties.geojson')['230883']
source('tdt-fuyuan-counties.bin')
source('heixiazi-rivers.json')
set_code('230883', get('230883').difference(heixiazi_zone).union(fuyuan.intersection(heixiazi_zone)),
         'Approved Amur/Ussuri midstream depiction from official county outline')
set_code('230000', get('230000').difference(heixiazi_zone).union(provinces['230000'].intersection(heixiazi_zone)),
         'Heixiazi official province/national outline at river junction')

archipelago_members = read_json(source('archipelago-members.json'))['elements']
member_bounds = {e['id']: e for e in read_json(source('archipelago-member-bounds.json'))['elements']}
island_audit = {}
def group_land(name, group_id=None, inclusion_boxes=None, extent=None, additional=None):
    ways, candidates = coastline_polygons(source(name))
    if additional:
        extra_ways, extra_candidates = coastline_polygons(source(additional))
        ways += extra_ways
        candidates += extra_candidates
    membership = []
    if group_id:
        group = next(g for g in archipelago_members if g['id'] == group_id)
        for member in group['members']:
            b = member_bounds.get(member['ref'], {}).get('bounds') if member['type'] == 'way' else None
            if b:
                membership.append(box(b['minlon'], b['minlat'], b['maxlon'], b['maxlat']).buffer(0.003))
    membership.extend(box(*b) for b in inclusion_boxes or [])
    accepted = [p for p in candidates if (not membership or any(b.covers(p.representative_point()) for b in membership))
                and (extent is None or extent.covers(p.representative_point()))]
    island_audit[name] = {'ways': len(ways), 'closedLandPolygons': len(candidates),
                        'accepted': len(accepted), 'excludedBounds': [p.bounds for p in candidates if p not in accepted]}
    if not accepted:
        raise ValueError('No complete island coast found: ' + name)
    return polygonal(unary_union(accepted))
# Core geographic extent also captures new reclamation outside stale reef member
# boxes. Sabah coastal islands and the Philippines' Paz/Ramos are outside it.
spratly = group_land('spratly-coastlines.json', 4856843, [(109, 7, 116.5, 12.5)], additional='spratly-missing-coastlines.json')
paracel = group_land('paracel-coastlines.json', 2417005, [(117.6, 15, 118.2, 15.3)])
set_code('460302', paracel, 'All Paracel and Zhongsha actual OSM land; Zhongsha administered by Xisha')
set_code('460303', spratly, 'All Spratly actual OSM land, independent of controlling party')
set_code('460300', spratly.union(paracel), 'Sansha aggregate of actual island land')
island_groups = [
    ('islands-mazu.json', '350122', 'Matsu to Lianjiang', None),
    ('islands-wuqiu.json', '350305', 'Wuqiu to Xiuyu', None),
    ('islands-dongding.json', '350604', 'Dongding to Longhai', None),
    ('islands-pratas.json', '441581', 'Pratas to Lufeng', None),
    ('islands-diaoyu.json', None, 'Diaoyu and associated islands to Yilan', [(123.4, 25.65, 123.75, 26), (124.5, 25.85, 124.65, 26)]),
]
for filename, code, reason, bounds in island_groups:
    extent = None
    if filename == 'islands-mazu.json':
        mazu_source = read_json(ROOT / 'data/boundaries/china-osm/710000.geojson')
        extent = polygonal(shape(next(f['geometry'] for f in mazu_source['features'] if f['id'] == 'relation/3777249')))
        write_json(SOURCES / 'mazu-geographic-extent.geojson', {'type': 'FeatureCollection', 'features': [{
            'type': 'Feature', 'properties': {'osmRelation': 3777249}, 'geometry': mapping(extent)}]})
    land = group_land(filename, inclusion_boxes=bounds, extent=extent)
    target = region(code) if code else next(r for r in regions.values() if r['name'] == '宜兰县')
    ancestors = {target['id']}
    parent = target.get('parentId')
    while parent in regions:
        ancestors.add(parent)
        parent = regions[parent].get('parentId')
    # Exact land subtraction transfers whole islands while preserving unrelated
    # mainland and sea allocations until the common coastal clipping step.
    for rid, g in list(current.items()):
        if rid not in ancestors and g.intersects(land):
            result = polygonal(g.difference(land))
            if result.is_empty:
                raise ValueError('Island transfer unexpectedly removes region ' + regions[rid]['name'])
            current[rid] = result
    set_region(target, current.get(target['id'], Polygon()).union(land), reason)

dash = next(f for f in geo('tdt-provinces.geojson') if f['properties'].get('gb') == '156990000')
if dash['geometry']['type'] != 'MultiLineString' or len(dash['geometry']['coordinates']) != 10:
    raise ValueError('Expected official ten-segment maritime line')
write_json(BASE / 'south-china-sea-lines.geojson', {'type': 'FeatureCollection', 'features': [dash]})
# Existing parent relations omit parts of formally assigned Kinmen and the
# restored Caidian streets. Aggregate these supported child areas explicitly.
for code in ['350527', '420114']:
    child = region(code)
    g = get(code)
    parent = child.get('parentId')
    while parent in regions:
        current[parent] = polygonal(current.get(parent, Polygon()).union(g))
        parent = regions[parent].get('parentId')
# Keep Changdu within the approved provincial outline; no county attribution is
# inferred for the tiny pre-existing overshoot of its parent visualization.
current[region('540300')['id']] = polygonal(get('540300').intersection(get('540000')))
patches = []
for rid, g in current.items():
    if g.equals(original.get(rid, Polygon())):
        continue
    if rid not in regions:
        continue
    patches.append({'regionId': rid, 'level': ['province', 'city', 'county'][regions[rid]['level']],
                    'geometry': mapping(g)})
referenced = {p['regionId'] for p in patches}
reference_path = BASE / 'references/policy-before-20261006.json'
if not reference_path.exists():
    write_json(reference_path, [r for r in rows if r['regionId'] in referenced])
else:
    preserved = read_json(reference_path)
    preserved_ids = {r['id'] for r in preserved}
    write_json(reference_path, preserved + [r for r in rows if r['regionId'] in referenced and r['id'] not in preserved_ids])
write_json(BASE / 'reviewed-patches.json', patches)
write_json(BASE / 'evidence.json', {'preparedAt': datetime.now(timezone.utc).isoformat(),
                                 'sources': evidence, 'changes': changes,
                                 'disputes': dispute_audit, 'islands': island_audit,
                                 'westernReview': western_audit,
                                 'baseSha256': hashlib.sha256((ROOT / 'data/catalog/china.geo.json').read_bytes()).hexdigest(),
                                 'patchesSha256': hashlib.sha256((BASE / 'reviewed-patches.json').read_bytes()).hexdigest(),
                                 'maritimeLinesSha256': hashlib.sha256((BASE / 'south-china-sea-lines.geojson').read_bytes()).hexdigest(),
                                 'reference': reference_path.relative_to(ROOT).as_posix(),
                                 'patchCount': len(patches)})
print(json.dumps({'patches': len(patches), 'changes': len(changes), 'islands': island_audit}, ensure_ascii=False), flush=True)
