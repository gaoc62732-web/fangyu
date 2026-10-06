from lib.china_gis import *
from shapely.geometry import box
from shapely.ops import transform
from pyproj import Transformer

sys.stdout.reconfigure(encoding="utf-8")
cache = ROOT / "data/tmp/china-boundary-review"
for name in ["spratly-coastlines.json", "paracel-coastlines.json", "strait-small-coastlines.json", "strait-coastlines.json"]:
    if not (cache / name).exists():
        continue
    try:
        ways, candidates = coastline_polygons(cache / name)
        print(json.dumps({"name": name, "ways": len(ways), "closedPolygons": len(candidates), "largest": sorted([{"area": p.area, "bounds": p.bounds} for p in candidates], key=lambda p: p["area"], reverse=True)[:8]}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"name": name, "error": str(error)}))
for name in ["statgis-coastline.shp", "nine-dash.shp", "statgis-nine-dash.shp", "statgis-official-outline.shp"]:
    if not (cache / name).exists():
        continue
    records = read_shapefile(cache / name)
    lines = [line for r in records for line in r["lines"]]
    print(json.dumps({"name": name, "records": len(records), "kinds": list({r["kind"] for r in records}), "parts": len(lines), "bounds": unary_union(lines).bounds, "closed": sum(l.is_ring for l in lines)}))
if (cache / "archipelago-members.json").exists():
    print(json.dumps({"members": [{"id": r["id"], "members": len(r.get("members", [])), "roles": list({m["role"] for m in r.get("members", [])})} for r in read_json(cache / "archipelago-members.json")["elements"]]}))
