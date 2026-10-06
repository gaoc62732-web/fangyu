"""Restore already assigned Weihai county land in its published parent faces.

This incremental repair only unions existing county land into formal ancestors.
It does not reclip any region or infer a new county/island assignment.
"""
import hashlib
import shutil
import sys
from datetime import datetime, timezone
from lib.china_gis import *
from lib.china_coast import reconcile_weihai_parents

sys.stdout.reconfigure(encoding='utf-8')
base = ROOT / 'data/boundaries/china-policy'
filename = ROOT / 'data/catalog/china.geo.json'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
report = read_json(base / 'applied.json')
if sha(filename) != report['geometrySha256']:
    raise ValueError('Runtime changed after the coastal audit')
regions = {r['id']: r for r in read_json(ROOT / 'data/catalog/catalog.json')['regions'] if r['scope'] == 'china'}
rows = read_json(filename)
codes = {'371000', '370000', '371002', '371003', '371082', '371083'}
shapes = {r['regionId']: polygonal(shape(r['geometry'])) for r in rows
          if r['regionId'] in regions and regions[r['regionId']].get('code') in codes}
repairs = reconcile_weihai_parents(shapes, regions)
if not repairs:
    print('Weihai county land is already covered by both parent faces.')
    sys.exit(0)
for row in rows:
    if row['regionId'] in {r['regionId'] for r in repairs}:
        row['geometry'] = mapping(shapes[row['regionId']])
        if not shape(row['geometry']).is_valid:
            raise ValueError('Invalid repaired parent geometry')
for rid, g in shapes.items():
    parent = regions[rid].get('parentId')
    if parent in shapes and g.difference(shapes[parent]).area > 1e-7:
        raise ValueError('Parent containment failed after repair: ' + regions[rid]['name'])
backup = base / 'references/coastal-before-parent-repair.json'
if not backup.exists():
    shutil.copyfile(filename, backup)
    write_json(base / 'references/coastal-before-parent-repair.report.json', report)
draft = base / 'parent-repair.geo.json'
write_json(draft, rows)
report['coastalParentRepairs'] = repairs
report['geometrySha256'] = sha(draft)
report['parentRepairedAt'] = datetime.now(timezone.utc).isoformat()
protected = {r['regionId'] for r in read_json(base / 'published-overrides.json')}
protected.update(r['regionId'] for r in repairs)
write_json(base / 'published-overrides.json', [r for r in rows if r['level'] == 'border' or r['regionId'] in protected])
draft.replace(filename)
write_json(base / 'applied.json', report)
write_json(base / 'audit.json', report)
print(json.dumps(repairs, ensure_ascii=False), flush=True)
