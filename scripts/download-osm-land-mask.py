"""Download complete (unsimplified) OSM coast polygons and extract the China window."""
import hashlib
import json
import struct
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from lib.china_gis import ROOT, write_json, polygonal, mapping, unary_union
from shapely.geometry import Polygon, box

sys.stdout.reconfigure(encoding='utf-8')
source_url = 'https://osmdata.openstreetmap.de/download/land-polygons-complete-4326.zip'
cache = ROOT / 'data/tmp/china-boundary-review'
archive = cache / 'land-polygons-complete-4326.zip'
cache.mkdir(parents=True, exist_ok=True)
if not archive.exists():
    temporary = archive.with_suffix('.zip.part')
    digest = hashlib.sha256()
    request = urllib.request.Request(source_url, headers={'User-Agent': 'FangyuBoundaryReview/1.0'})
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as output:
        size, last_report = 0, 0
        headers = dict(response.headers)
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
            size += len(chunk)
            if size - last_report >= 64 * 1024 * 1024:
                print(json.dumps({'downloadedMiB': round(size / 1024**2)}), flush=True)
                last_report = size
    temporary.replace(archive)
    write_json(archive.with_name(archive.name + '.source.json'), {
        'url': source_url, 'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'sha256': digest.hexdigest(), 'bytes': size,
        'lastModified': headers.get('Last-Modified'), 'license': 'ODbL-1.0',
    })
window = box(73, 3, 136, 54)
parts = []
records = 0
with zipfile.ZipFile(archive) as bundle:
    name = next(n for n in bundle.namelist() if n.endswith('.shp'))
    with bundle.open(name) as stream:
        stream.read(100)
        while header := stream.read(8):
            _, words = struct.unpack('>2i', header)
            record = stream.read(words * 2)
            records += 1
            kind = struct.unpack_from('<i', record)[0]
            if kind == 0:
                continue
            if kind not in [5, 15, 25]:
                raise ValueError(f'Expected polygon shapefile, got {kind}')
            xmin, ymin, xmax, ymax = struct.unpack_from('<4d', record, 4)
            if xmax < 73 or xmin > 136 or ymax < 3 or ymin > 54:
                continue
            count, points = struct.unpack_from('<2i', record, 36)
            starts = list(struct.unpack_from(f'<{count}i', record, 44)) + [points]
            xy = [struct.unpack_from('<2d', record, 44 + count * 4 + i * 16) for i in range(points)]
            # Coast polygons contain only maritime holes. Keep inland waters in
            # administrative geometry; exclude hole rings using their SHP winding.
            shells, holes = [], []
            for i in range(count):
                ring = xy[starts[i]:starts[i+1]]
                signed = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))
                (shells if signed < 0 else holes).append(ring)
            for shell in shells:
                outer = Polygon(shell)
                owned = [h for h in holes if outer.covers(Polygon(h).representative_point())]
                clipped = polygonal(Polygon(shell, owned).intersection(window))
                if not clipped.is_empty:
                    parts.append(clipped)
            print(json.dumps({'record': records, 'selectedParts': len(parts)}), flush=True)
land = polygonal(unary_union(parts))
destination = ROOT / 'data/boundaries/china-policy/land-mask.geojson'
write_json(destination, {'type': 'FeatureCollection', 'features': [{
    'type': 'Feature', 'properties': {'source': source_url, 'license': 'ODbL-1.0'},
    'geometry': mapping(land),
}]})
print(json.dumps({'mask': str(destination), 'records': records, 'bounds': land.bounds}), flush=True)
