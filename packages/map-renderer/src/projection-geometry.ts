import { geoArea } from 'd3-geo';
// D3's spherical polygon winding is opposite to RFC 7946. Normalize a display
// copy only; source geometries used by spatial matching remain untouched.
export function projectionGeometry(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  const polygon = (coordinates: GeoJSON.Position[][]) =>
    geoArea({ type: 'Polygon', coordinates }) > 2 * Math.PI
      ? coordinates.map((ring) => [...ring].reverse())
      : coordinates;
  if (geometry.type === 'Polygon')
    return { ...geometry, coordinates: polygon(geometry.coordinates) };
  if (geometry.type === 'MultiPolygon')
    return { ...geometry, coordinates: geometry.coordinates.map(polygon) };
  if (geometry.type === 'GeometryCollection')
    return { ...geometry, geometries: geometry.geometries.map(projectionGeometry) };
  return geometry;
}
