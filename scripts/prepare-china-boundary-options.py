"""Build reversible management boundaries and repair verified administrative defects.

Uses cached OSM street relations and TianDiTu county outlines; never downloads.
--apply publishes only after the selected switch state passes geometry checks.
"""
import argparse
import hashlib
import itertools
import shutil
import uuid
from datetime import datetime, timezone
from lib.china_gis import *
from shapely.geometry import MultiLineString, Point, Polygon
from shapely.ops import linemerge
from lib.china_coast import CoastIndex

sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--settings', help='JSON object selecting the one switch state to audit')
args = parser.parse_args()
current_settings = {
    'suzhouPark': True,
    'huzhongXinlin': True,
    'jiagedaqi': True,
    'songling': True,
    'shenshan': True,
    'lianjiang': False,
    'jinmen': False,
    'tanggulaTibet': False,
}
if args.settings:
    current_settings.update(json.loads(args.settings))
base = ROOT / 'data/boundaries/china-policy'
catalog_file = ROOT / 'data/catalog/catalog.json'
geometry_file = ROOT / 'data/catalog/china.geo.json'
baseline = base / 'references/admin-options-base.json'
baseline.parent.mkdir(parents=True, exist_ok=True)
if not baseline.exists():
    shutil.copyfile(geometry_file, baseline)
catalog = read_json(catalog_file)
regions = {r['id']: r for r in catalog['regions'] if r['scope'] == 'china'}
codes = {r['code']: r['id'] for r in regions.values() if not r['historical']}
names = {r['name']: r['id'] for r in regions.values() if not r['historical']}
rows = read_json(baseline)
shapes = {r['regionId']: polygonal(shape(r['geometry'])) for r in rows if r['level'] != 'border' and r['regionId'] in regions}
changed = set()
sources = {}

def evidence(path):
    path = Path(path)
    if '/data/tmp/' in path.as_posix():
        destination=base/'sources'/path.name
        shutil.copyfile(path,destination)
        path=destination
    sources[path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return read_json(path)

def put(rid, geometry):
    shapes[rid] = polygonal(geometry)
    if shapes[rid].is_empty:
        raise ValueError('Empty region: ' + regions[rid]['name'])
    changed.add(rid)

def management(name, parent_code):
    rid = str(uuid.uuid5(uuid.NAMESPACE_URL, 'fangyu:china:management:' + name))
    if rid not in regions:
        r = dict(id=rid, parentId=codes[parent_code], scope='china', level=2, name=name,
                 code='', historical=False, aliases=[], kind='management-area')
        regions[rid] = r
        catalog['regions'].append(r)
    return rid

park = management('苏州工业园区', '320500')
shenshan = management('深汕特别合作区', '440300')
lianjiang = management('連江縣', '710000')
jinmen = management('金门縣', '710000')
for rid in [lianjiang, jinmen]:
    regions[rid]['parentId'] = next(r['id'] for r in regions.values()
                                     if r['scope'] == 'china' and r['level'] == 0 and r['code'] == '710000')
streets_path = base/'sources/suzhou-park-streets.geojson'
for filename in ['suzhou-park-streets.geojson','suzhou-park-streets.json','suzhou-park-streets.json.source.json','tdt-counties-540100.geojson','tdt-counties-540100.bin','tdt-counties-540100.bin.source.json','tdt-counties-540300.geojson','tdt-counties-540300.bin','tdt-counties-540300.bin.source.json']:
    if (ROOT/'data/tmp/china-boundary-review'/filename).exists(): shutil.copyfile(ROOT/'data/tmp/china-boundary-review'/filename,base/'sources'/filename)
streets = evidence(streets_path)['features']
expected_streets = {'娄葑街道','斜塘街道','唯亭街道','胜浦街道','金鸡湖街道'}
assert {f['properties']['name'] for f in streets} == expected_streets
street_shapes = [polygonal(shape(f['geometry'])) for f in streets]
park_shape = polygonal(unary_union(street_shapes))
assert len(polygons(park_shape)) == 1
assert sum(g.area for g in street_shapes) - park_shape.area < 1e-10
evidence(streets_path.with_name('suzhou-park-streets.json.source.json'))
put(park, park_shape)
for code in ['320505', '320506', '320508']:
    put(codes[code], shapes[codes[code]].difference(park_shape))

raw_guangdong = evidence(ROOT / 'data/boundaries/china-osm/440000.geojson')
ss = polygonal(shape(next(f['geometry'] for f in raw_guangdong['features'] if f['id'] == 'relation/9223823')))
# Retain the reviewed acquired coastline, including open water exclusion.
land_mask = polygonal(unary_union([shape(f['geometry']) for f in evidence(base / 'land-mask.geojson')['features']]))
ss = polygonal(ss.intersection(land_mask))
put(shenshan, ss)
put(codes['441521'], shapes[codes['441521']].difference(ss))
put(codes['440300'], shapes[codes['440300']].union(ss))
put(codes['441500'], shapes[codes['441500']].difference(ss))

# Both old county codes now identify county-level cities. Use the complete
# official mosaic, rather than assigning the unowned south by proximity.
official = {}
for filename in ['tdt-shannan-counties-retry.geojson', 'tdt-counties-540400.geojson']:
    for f in evidence(base / 'sources' / filename)['features']:
        code = f['properties']['gb'][3:]
        code = {'540530':'540581','540422':'540481'}.get(code, code)
        official[codes[code]] = polygonal(shape(f['geometry']))
old_cities = unary_union([shapes[codes[c]] for c in ['540500','540400']])
for rid, g in official.items():
    put(rid, g)
for code in ['540500','540400']:
    put(codes[code], unary_union([shapes[rid] for rid in official if regions[rid]['parentId'] == codes[code]]))
new_cities = unary_union([shapes[codes[c]] for c in ['540500','540400']])
# Reconcile the seams with neighboring counties using the same official mosaic.
# A narrow margin joins the old detailed geometry outside the affected cities.
zone = polygonal(old_cities.union(new_cities).buffer(0.005))
neighbor_official = {}
for directory, filename in [(base/'sources','tdt-counties-540100.geojson'),
                             (base/'sources','tdt-counties-540300.geojson'),
                             (base/'sources','tdt-counties-540200.geojson'),
                             (base/'sources','tdt-counties-540600.geojson')]:
    for f in evidence(directory/filename)['features']:
        code=f['properties']['gb'][3:]
        if code in codes:
            g=polygonal(shape(f['geometry']))
            if g.intersects(zone): neighbor_official[codes[code]]=g
for rid,g in neighbor_official.items():
    put(rid, shapes[rid].difference(zone).union(g.intersection(zone)))
affected_cities = {regions[r]['parentId'] for r in neighbor_official}
for rid in affected_cities:
    children=[g for cid,g in shapes.items() if regions[cid]['parentId']==rid and regions[cid]['level']==2]
    put(rid, shapes[rid].difference(zone).union(unary_union(children).intersection(zone)))
city_parts=[g for rid,g in shapes.items() if regions[rid]['parentId']==codes['540000'] and regions[rid]['level']==1]
put(codes['540000'], shapes[codes['540000']].difference(zone).union(unary_union(city_parts).intersection(zone)))

hx = ['1a54e6b6-4807-533c-ab87-a2aafbc60fb1','2032ab7d-e59a-5117-a8c8-29774fa9778e']
jg = '1f120ca5-1aa7-54f2-ac79-2a9b1e114305'
sl = '6f431f37-f107-574a-ae3d-8b35f18f37cf'
for rid in hx+[jg,sl]: regions[rid]['kind'] = 'management-area'
cross = unary_union([shapes[jg], shapes[sl]])
put(codes['150723'], shapes[codes['150723']].difference(cross))
put(codes['232721'], shapes[codes['232721']].difference(unary_union([shapes[r] for r in hx])))
for code in ['150000','150700']:
    put(codes[code], shapes[codes[code]].difference(cross))
for code in ['230000','232700']:
    put(codes[code], shapes[codes[code]].union(cross))

geometry_bank = {}
def feature(rid, g):
    g = polygonal(g)
    assert g.is_valid and not g.is_empty
    geom = mapping(g)
    key = hashlib.sha256(json.dumps(geom, separators=(',',':')).encode()).hexdigest()[:24]
    geometry_bank[key] = geom
    r = regions[rid]
    return dict(regionId=rid, level=['province','city','county'][r['level']], name=r['name'], geometry=key, bounds=list(g.bounds))

groups = []
line_groups = []
def variants(keys, ids, create):
    result = {}
    for values in itertools.product([False,True], repeat=len(keys)):
        state = dict(zip(keys,values))
        geoms = create(state)
        # Audit only the selected state; other variants are materialized for the toggles.
        if all(current_settings[key] == value for key, value in state.items()):
            counties = [g for rid,g in geoms.items() if regions[rid]['level']==2]
            union = unary_union(counties)
            assert sum(g.area for g in counties)-union.area < 1e-8, (keys,state,'overlap')
        result[''.join('1' if v else '0' for v in values)] = [feature(rid,g) for rid,g in geoms.items()]
    groups.append(dict(keys=keys, regionIds=ids, variants=result))

def line_variants(keys, create):
    result = {}
    for values in itertools.product([False, True], repeat=len(keys)):
        state = dict(zip(keys, values))
        result[''.join('1' if v else '0' for v in values)] = create(state)
    line_groups.append(dict(keys=keys, variants=result))

def line_parts(geometry):
    if geometry.geom_type == 'LineString':
        return [geometry]
    if geometry.geom_type in ('MultiLineString', 'GeometryCollection'):
        return [line for part in geometry.geoms for line in line_parts(part)]
    return []

def clean_linework(geometry, minimum_length=0.02):
    parts = line_parts(geometry)
    if not parts:
        return None
    merged = unary_union(parts)
    if merged.geom_type == 'MultiLineString':
        merged = linemerge(merged)
    parts = [line for line in line_parts(merged) if line.length >= minimum_length]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else MultiLineString(parts)

def line_feature(rid, g, display_at, name=None):
    geometry = mapping(g.boundary if g.geom_type in ('Polygon', 'MultiPolygon') else g)
    key = hashlib.sha256(json.dumps(geometry, separators=(',', ':')).encode()).hexdigest()[:24]
    geometry_bank[key] = geometry
    return dict(regionId=rid, level='border', name=name or regions[rid]['name'], geometry=key,
                boundaryKind='tanggula-nominal', displayAt=display_at)

def osm_land(filename, extent_path=None):
    evidence(base / 'sources' / filename)
    if extent_path:
        evidence(base / 'sources' / extent_path)
    ways, candidates = coastline_polygons(str(base / 'sources' / filename))
    extent = None
    if extent_path:
        extent = shape(read_json(base / 'sources' / extent_path)['features'][0]['geometry'])
    accepted = [p for p in candidates if extent is None or extent.covers(p.representative_point())]
    if not accepted:
        raise ValueError('No closed island coastline in ' + filename)
    return polygonal(unary_union(accepted))

# These cached coastlines are the same OSM evidence used by the policy review.
# The mainland parts of the old Fujian counties remain in place; only the
# island pieces move when the management switches are enabled.
mazu = osm_land('islands-mazu.json', 'mazu-geographic-extent.geojson')
wuqiu = osm_land('islands-wuqiu.json')
dongding = osm_land('islands-dongding.json')
old_lian, old_jin, old_xiuyu, old_longhai = [codes[c] for c in ['350122', '350527', '350305', '350604']]
fuzhou, fujian, putian, quanzhou, zhangzhou = [codes[c] for c in ['350100', '350000', '350300', '350500', '350600']]
taiwan = next(r['id'] for r in regions.values()
              if r['scope'] == 'china' and r['level'] == 0 and r['code'] == '710000')
island_ids = [lianjiang, jinmen, old_lian, old_jin, old_xiuyu, old_longhai,
              fuzhou, fujian, putian, quanzhou, zhangzhou, taiwan]
island_original = {rid: shapes.get(rid, Polygon()) for rid in island_ids}
island_pieces = mazu.union(wuqiu).union(dongding)

def island_variant(s):
    result = {rid: island_original[rid] for rid in island_ids}
    if s['lianjiang']:
        result[old_lian] = polygonal(island_original[old_lian].difference(mazu))
        result[lianjiang] = mazu
        result[fuzhou] = polygonal(island_original[fuzhou].difference(mazu))
        result[fujian] = polygonal(island_original[fujian].difference(mazu))
    else:
        result.pop(lianjiang)
    if s['jinmen']:
        result.pop(old_jin)
        result[jinmen] = polygonal(island_original[old_jin].union(wuqiu).union(dongding))
        result[old_xiuyu] = polygonal(island_original[old_xiuyu].difference(wuqiu))
        result[old_longhai] = polygonal(island_original[old_longhai].difference(dongding))
        result[putian] = polygonal(island_original[putian].difference(wuqiu))
        result[quanzhou] = polygonal(island_original[quanzhou].difference(island_original[old_jin]))
        result[zhangzhou] = polygonal(island_original[zhangzhou].difference(dongding))
    else:
        result.pop(jinmen)
    moved = (mazu if s['lianjiang'] else Polygon()).union(
        island_original[old_jin].union(wuqiu).union(dongding) if s['jinmen'] else Polygon())
    transferred_fujian = (mazu if s['lianjiang'] else Polygon()).union(
        island_original[old_jin].union(wuqiu).union(dongding) if s['jinmen'] else Polygon())
    result[fujian] = polygonal(island_original[fujian].difference(transferred_fujian))
    result[taiwan] = polygonal(island_original[taiwan].union(moved))
    return result

variants(['lianjiang', 'jinmen'], island_ids, island_variant)

# OSM relation geometry is explicitly the user's requested source for the
# three Tibetan counties and their affected Qinghai neighbors. All seven
# relations come from one freshly acquired Overpass response so adjacent
# county seams use the same OSM snapshot.
fresh_raw = evidence(ROOT / 'data/tmp/china-boundary-review/tanggula-latest-refresh.json')
fresh_geo = evidence(ROOT / 'data/tmp/osm-china-python/tanggula-latest-refresh.geojson')
raw_tibet = {
    codes[code]: polygonal(shape(next(f['geometry'] for f in fresh_geo['features']
                                  if f['id'] == relation)))
    for code, relation in [('540623', 'relation/2745052'),
                           ('540624', 'relation/2745047'),
                           ('540628', 'relation/2745048')]
}
raw_qinghai = {
    codes[code]: polygonal(shape(next(f['geometry'] for f in fresh_geo['features']
                                      if f['id'] == relation)))
    for code, relation in [('632724', 'relation/4538486'),
                           ('632801', 'relation/2708757'),
                           ('632722', 'relation/4492690')]
}
raw_qinghai[codes['632726']] = polygonal(shape(next(
    f['geometry'] for f in fresh_geo['features'] if f['id'] == 'relation/4525617')))
raw_union = unary_union(list(raw_tibet.values()))
# Keep the replacement mosaic limited to the four Qinghai counties whose
# boundaries are part of this management-area seam.  Deriving this list from
# every nominal county that happens to intersect the Tibetan geometry also
# pulls unrelated counties into the generated switch variant.
qinghai_counties = [codes[code] for code in ['632724', '632801', '632722', '632726']]
qinghai_cities = [codes['632700'], codes['632800']]
qinghai_province = codes['630000']
tibet_city = codes['540600']
tibet_province = codes['540000']
tanggula_ids = list(dict.fromkeys(list(raw_tibet) + qinghai_counties + qinghai_cities +
                                   [qinghai_province, tibet_city, tibet_province]))
tanggula_nominal = {rid: shapes[rid] for rid in tanggula_ids}

def tanggula_variant(s):
    result = dict(tanggula_nominal)
    if not s['tanggulaTibet']:
        return result
    for rid, g in raw_tibet.items():
        result[rid] = g
    for rid in qinghai_counties:
        result[rid] = polygonal(raw_qinghai.get(rid, result[rid]).difference(raw_union))
    for rid in qinghai_cities + [qinghai_province]:
        result[rid] = polygonal(result[rid].difference(raw_union))
    # Reconcile Qinghai aggregates against the newly acquired county mosaic
    # only around the affected seams, preserving the existing detail outside.
    seam_zone = polygonal(unary_union([raw_union, *raw_qinghai.values(),
                                      *(shapes[rid] for rid in qinghai_counties)]).buffer(0.005))
    affected_cities = {regions[rid]['parentId'] for rid in qinghai_counties}
    for city_id in affected_cities:
        children = [result.get(rid, geometry) for rid, geometry in shapes.items()
                    if regions[rid]['parentId'] == city_id and regions[rid]['level'] == 2]
        result[city_id] = polygonal(result[city_id].difference(seam_zone)
                                    .union(unary_union(children).intersection(seam_zone)))
    qinghai_city_geometries = [result.get(rid, geometry) for rid, geometry in shapes.items()
                               if regions[rid]['parentId'] == qinghai_province and regions[rid]['level'] == 1]
    result[qinghai_province] = polygonal(result[qinghai_province].difference(seam_zone)
                                         .union(unary_union(qinghai_city_geometries).intersection(seam_zone)))
    result[tibet_city] = polygonal(result[tibet_city].union(raw_union))
    result[tibet_province] = polygonal(result[tibet_province].union(raw_union))
    return result

variants(['tanggulaTibet'], tanggula_ids, tanggula_variant)

def tanggula_lines(s):
    if not s['tanggulaTibet']:
        return []
    nominal_province_border = shapes[qinghai_province].boundary.intersection(
        shapes[tibet_province].boundary)
    if nominal_province_border.is_empty:
        raise ValueError('The nominal Qinghai-Tibet provincial border is missing')
    active = tanggula_variant(s)
    county_extent = unary_union([tanggula_nominal[rid] for rid in raw_tibet]).envelope.buffer(0.02)
    actual_county_edges = unary_union([
        active[rid].boundary for rid in list(raw_tibet) + qinghai_counties
        if active[rid].intersects(county_extent)
    ])
    disputed_province_border = clean_linework(
        nominal_province_border.intersection(raw_union.buffer(0.0005))
        .difference(actual_county_edges.buffer(0.0005)))
    if disputed_province_border is None:
        raise ValueError('The disputed Qinghai-Tibet border segment is missing')
    return [
        line_feature(qinghai_province, disputed_province_border,
                     display_at, '青海省／西藏自治区')
        for display_at in ('county', 'province-city')
    ]

line_variants(['tanggulaTibet'], tanggula_lines)

def sip_variant(s):
    result = {rid:shapes[rid] for rid in [codes['320505'],codes['320506'],codes['320508']]}
    if s['suzhouPark']: result[park] = shapes[park]
    else: result[codes['320505']] = polygonal(result[codes['320505']].union(shapes[park]))
    return result
variants(['suzhouPark'], [park,codes['320505'],codes['320506'],codes['320508']], sip_variant)

north_ids = hx+[jg,sl]+[codes[c] for c in ['232721','150723','232700','150700','230000','150000']]
def north_variant(s):
    result = {rid:shapes[rid] for rid in north_ids}
    for key, members, target in [('huzhongXinlin',hx,codes['232721']),('jiagedaqi',[jg],codes['150723']),('songling',[sl],codes['150723'])]:
        if s[key]: continue
        pieces = unary_union([shapes[rid] for rid in members])
        result[target] = polygonal(result[target].union(pieces))
        for rid in members: del result[rid]
        if key != 'huzhongXinlin':
            for code in ['230000','232700']: result[codes[code]] = polygonal(result[codes[code]].difference(pieces))
            for code in ['150000','150700']: result[codes[code]] = polygonal(result[codes[code]].union(pieces))
    return result
variants(['huzhongXinlin','jiagedaqi','songling'], north_ids, north_variant)

ss_ids = [shenshan]+[codes[c] for c in ['441521','440300','441500']]
def ss_variant(s):
    result = {rid:shapes[rid] for rid in ss_ids}
    if not s['shenshan']:
        del result[shenshan]
        result[codes['441521']] = polygonal(result[codes['441521']].union(ss))
        result[codes['440300']] = polygonal(result[codes['440300']].difference(ss))
        result[codes['441500']] = polygonal(result[codes['441500']].union(ss))
    return result
variants(['shenshan'], ss_ids, ss_variant)

failures=[]
for i,(rid,g) in enumerate(official.items()):
    for other,h in list(official.items())[i+1:]+[(r,shapes[r]) for r in neighbor_official]:
        area=g.intersection(h).area
        if area>1e-10: failures.append(dict(a=regions[rid]['name'],b=regions[other]['name'],overlap=area))
for code in ['540500','540400']:
    children=[g for rid,g in official.items() if regions[rid]['parentId']==codes[code]]
    assert shapes[codes[code]].symmetric_difference(unary_union(children)).area<1e-12
for rid in [codes['540500'], codes['540400']]:
    for other in affected_cities:
        assert shapes[rid].intersection(shapes[other]).area < 1e-10, (regions[rid]['name'],regions[other]['name'])

# Drop anonymous obsolete administrative faces and mismatched county layers.
# Direct municipalities and Hong Kong/Macao retain their intentional aggregates.
result=[]
for row in rows:
    rid=row['regionId'];r=regions.get(rid)
    if row['level']!='border' and not r: continue
    if row['level']=='county' and r['level']!=2 and r.get('code') not in ['810000','820000']: continue
    if rid in changed: row={**row,'geometry':mapping(shapes[rid])}
    result.append(row)
for rid in [park,shenshan]:
    result.append(dict(id='management-'+rid,regionId=rid,level='county',geometry=mapping(shapes[rid])))
# Trace the same continuous mainland land border as the coastal policy.
national=polygonal(unary_union([g for rid,g in shapes.items() if regions[rid]['level']==0]))
mainland=max(polygons(national),key=lambda p:p.area)
coast_report=evidence(base/'coastal-mask-report.json')
coast_index=CoastIndex(land_mask,coast_report['nonCoastalClosure'])
land_border=max(coast_index.inland_runs(mainland.exterior),key=lambda line:line.length)
assert land_border.bounds[0]<75 and land_border.bounds[2]>134 and land_border.bounds[3]>53
for row in result:
    if row.get('boundaryKind') == 'land':
        row['geometry'] = {'type':'MultiLineString','coordinates':[list(land_border.coords)]}
audit=dict(createdAt=datetime.now(timezone.utc).isoformat(),sources=sources,failures=failures,
           streetRelations=[f['id'] for f in streets],rows=len(result),
           variants=sum(len(g['variants']) for g in groups), lineVariants=len(line_groups),
           repairedRegions=[regions[r]['name'] for r in sorted(changed)])
write_json(base/'admin-options-audit.json',audit)
if failures:
    raise ValueError('Official county mosaic has overlaps: '+str(failures))
write_json(base/'admin-options-draft.json',result)
write_json(base/'admin-options-draft-catalog.json',catalog)
write_json(base/'admin-options-draft-options.json',dict(geometries=geometry_bank,groups=groups,
                                                        lineGroups=line_groups))
audit['geometrySha256']=hashlib.sha256((base/'admin-options-draft.json').read_bytes()).hexdigest()
audit['optionsSha256']=hashlib.sha256((base/'admin-options-draft-options.json').read_bytes()).hexdigest()
write_json(base/'admin-options-audit.json',audit)
print(json.dumps(audit,ensure_ascii=False),flush=True)
if args.apply:
    shutil.copyfile(base/'admin-options-draft.json',geometry_file)
    shutil.copyfile(base/'admin-options-draft-catalog.json',catalog_file)
    shutil.copyfile(base/'admin-options-draft-options.json',ROOT/'data/catalog/china-boundary-options.json')
    published=read_json(base/'published-overrides.json')
    protected=changed|{r['regionId'] for r in published if r['regionId']}
    write_json(base/'published-overrides.json',[r for r in result if r['level']=='border' or r['regionId'] in protected])
    report=read_json(base/'applied.json')
    report['geometrySha256']=hashlib.sha256(geometry_file.read_bytes()).hexdigest()
    report['adminOptionsAudit']='data/boundaries/china-policy/admin-options-audit.json'
    report['adminOptionsAppliedAt']=audit['createdAt']
    write_json(base/'applied.json',report)
    manifest_file=ROOT/'data/catalog/manifest.json'
    manifest=read_json(manifest_file)
    manifest['regions']=len(catalog['regions'])
    if 'china-boundary-options.json' not in manifest['files']: manifest['files'].append('china-boundary-options.json')
    write_json(manifest_file,manifest)
    print(f'Published administrative repairs and {audit["variants"]} local boundary variants.',flush=True)
