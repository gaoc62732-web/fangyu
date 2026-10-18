"""Clip newly imported administrative faces using the shared OSM land mask."""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.china_gis import ROOT, read_json, polygonal, shape, mapping, unary_union

rows = json.load(sys.stdin)
mask_path = ROOT / 'data/boundaries/china-policy/land-mask.geojson'
extent = unary_union([shape(row['geometry']) for row in rows]).envelope
mask = polygonal(unary_union([
    shape(feature['geometry']) for feature in read_json(mask_path)['features']
])).intersection(extent)
cache = {}
for row in rows:
    key = json.dumps(row['geometry'], separators=(',', ':'))
    if key not in cache:
        result = polygonal(shape(row['geometry']).intersection(mask))
        if result.is_empty:
            raise ValueError('Administrative face contains no land: ' + row['regionId'])
        cache[key] = mapping(result)
    row['geometry'] = cache[key]
json.dump({'rows': rows, 'provenance': {
    'source': mask_path.relative_to(ROOT).as_posix(),
    'sha256': hashlib.sha256(mask_path.read_bytes()).hexdigest(),
    'operation': 'OSM administrative polygon intersected with shared OSM coastline land mask',
}}, sys.stdout, ensure_ascii=False, separators=(',', ':'))
