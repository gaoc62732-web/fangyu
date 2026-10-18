import json
import sys
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
config = json.loads((ROOT / 'data/manual/china/rules/boundary-overrides.json').read_text(encoding='utf-8'))
rows = json.load(sys.stdin)

for assignment in config.get('assignments', []):
    geometry = shape(assignment['geometry'])
    targets = set(assignment.get('targetRegionIds', []))
    for row in rows:
        if row.get('regionId') in targets:
            row['geometry'] = mapping(unary_union([shape(row['geometry']), geometry]))

for exclusion in config.get('exclusions', []):
    geometry = shape(exclusion['geometry'])
    sources = set(exclusion.get('sourceRegionIds', []))
    targets = set(exclusion.get('targetRegionIds', []))
    for row in rows:
        if row.get('regionId') in sources:
            result = shape(row['geometry']).difference(geometry)
            if result.is_empty:
                raise RuntimeError(f'Boundary override removed an entire region: {row["regionId"]}')
            row['geometry'] = mapping(result)
    for row in rows:
        if row.get('regionId') in targets:
            row['geometry'] = mapping(unary_union([shape(row['geometry']), geometry]))

json.dump({
    'rows': rows,
    'provenance': {
        'source': 'data/manual/china/rules/boundary-overrides.json',
        'assignments': [item['id'] for item in config.get('assignments', [])],
        'exclusions': [item['id'] for item in config.get('exclusions', [])],
    },
}, sys.stdout, ensure_ascii=False, separators=(',', ':'))
