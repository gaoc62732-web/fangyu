"""Offline geometry utilities for the reviewed China boundary pipeline."""
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data/tmp/china-gis-runtime"))
from shapely.geometry import LineString, Polygon, MultiPolygon, shape, mapping
from shapely.ops import polygonize, unary_union
from shapely import make_valid


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry] if not geometry.is_empty else []
    if geometry.geom_type in ["MultiPolygon", "GeometryCollection"]:
        return [p for child in geometry.geoms for p in polygons(child)]
    return []


def polygonal(geometry):
    return unary_union(polygons(make_valid(geometry)))


def read_shapefile(filename):
    """Read XY records without DBF-dependent names; all provenance is separate."""
    data = Path(filename).read_bytes()
    offset, result = 100, []
    while offset < len(data):
        _, words = struct.unpack_from(">2i", data, offset)
        offset += 8
        record = data[offset:offset + words * 2]
        offset += words * 2
        kind = struct.unpack_from("<i", record)[0]
        if kind == 0:
            continue
        if kind not in [3, 5, 13, 15, 23, 25]:
            raise ValueError(f"Unsupported shapefile record type {kind}")
        part_count, point_count = struct.unpack_from("<2i", record, 36)
        starts = list(struct.unpack_from(f"<{part_count}i", record, 44)) + [point_count]
        points = [struct.unpack_from("<2d", record, 44 + 4 * part_count + 16 * i) for i in range(point_count)]
        lines = [LineString(points[starts[i]:starts[i+1]]) for i in range(part_count)]
        result.append({"kind": kind, "lines": lines})
    return result


def osm_coastlines(filename):
    response = read_json(filename)
    if response.get("remark"):
        raise ValueError(f"Incomplete Overpass response: {filename}")
    ways = [e for e in response["elements"] if e["type"] == "way" and e.get("tags", {}).get("natural") == "coastline"]
    return ways, [LineString([(p["lon"], p["lat"]) for p in e["geometry"]]) for e in ways]


def coastline_polygons(filename):
    ways, lines = osm_coastlines(filename)
    # Exact shared nodes connect ways; no invented closing segment is added.
    candidates = list(polygonize(unary_union(lines)))
    return ways, candidates
