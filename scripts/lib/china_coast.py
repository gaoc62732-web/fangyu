"""Exact coastline indexing without buffering a million-vertex shoreline.

The tolerance only accommodates intersection roundoff (about a millimetre),
never shoreline simplification or proximity-based administrative assignment.
"""
from .china_gis import LineString, polygons, polygonal, unary_union
from shapely.strtree import STRtree


class CoastIndex:
    def __init__(self, land, closure=()):
        self.edges = set()
        self.chunks = []
        artificial = {self.edge(a, b) for a, b in zip(closure, closure[1:])}
        for polygon in polygons(land):
            for ring in [polygon.exterior, *polygon.interiors]:
                coordinates = list(ring.coords)
                run = []
                for a, b in zip(coordinates, coordinates[1:]):
                    if self.edge(a, b) in artificial:
                        if len(run) > 1:
                            self.chunks.append(LineString(run))
                        run = []
                        continue
                    self.edges.add(self.edge(a, b))
                    if not run:
                        run.append(a)
                    run.append(b)
                    if len(run) == 129:
                        self.chunks.append(LineString(run))
                        run = [b]
                if len(run) > 1:
                    self.chunks.append(LineString(run))
        self.tree = STRtree(self.chunks)

    @staticmethod
    def edge(a, b):
        a, b = tuple(a), tuple(b)
        return (a, b) if a <= b else (b, a)

    def is_coast(self, a, b):
        if self.edge(a, b) in self.edges:
            return True
        # Newly intersected endpoints may lie inside an original OSM segment.
        # Check the entire segment against only nearby original shoreline pieces.
        line = LineString([a, b])
        indices = self.tree.query(line, predicate='dwithin', distance=1e-8)
        if len(indices) == 0:
            return False
        from shapely.ops import unary_union
        nearby = unary_union([self.chunks[int(i)] for i in indices])
        return all(nearby.distance(line.interpolate(t, normalized=True)) <= 1e-8
                   for t in [0, .25, .5, .75, 1])

    def inland_runs(self, ring):
        """Return cyclic consecutive non-coastal runs with original coordinates."""
        coordinates = list(ring.coords)
        coastal = [self.is_coast(a, b) for a, b in zip(coordinates, coordinates[1:])]
        if not any(coastal):
            raise ValueError('No original OSM coastline found on the mainland exterior')
        start = coastal.index(True)
        runs, current = [], []
        for offset in range(1, len(coastal) + 1):
            i = (start + offset) % len(coastal)
            if coastal[i]:
                if len(current) > 1:
                    runs.append(LineString(current))
                current = []
            else:
                if not current:
                    current.append(coordinates[i])
                current.append(coordinates[i + 1])
        return runs


def reconcile_weihai_parents(shapes, regions):
    """Preserve county land already attributed to Weihai at both parent levels.

    The reviewed Wendeng replacement removed small parts of neighbouring county
    land from the city/province, while retaining those counties' own geometry.
    This only restores established membership; it never changes a county face.
    """
    by_code = {r.get('code'): r for r in regions.values() if not r.get('historical')}
    city = by_code['371000']
    children = [r for r in regions.values() if r.get('parentId') == city['id'] and r['id'] in shapes]
    county_land = polygonal(unary_union([shapes[r['id']] for r in children]))
    repairs = []
    for r in [city, regions[city['parentId']]]:
        prior = shapes[r['id']]
        missing = county_land.difference(prior)
        if missing.area <= 1e-12:
            continue
        if missing.area > .002:
            raise ValueError('Unexpectedly large Weihai parent omission requires another review')
        shapes[r['id']] = polygonal(prior.union(missing))
        repairs.append({'regionId': r['id'], 'name': r['name'],
                        'addedSquareDegrees': missing.area,
                        'basis': 'Existing formal county membership; county geometries unchanged'})
    return repairs
