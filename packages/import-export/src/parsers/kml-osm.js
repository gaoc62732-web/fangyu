// File-format decoding only. Matching and record updates live in separate modules.
const KML_MAX_VERTICES = 60000;
function parseCoordinates(value, separator = ',') {
  const result = [];
  for (const token of String(value || '')
    .trim()
    .split(/\s+/)) {
    if (!token) {
      continue;
    }
    const parts = token.split(separator);
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (
      parts.length >= 2 &&
      Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      Math.abs(lon) <= 180 &&
      Math.abs(lat) <= 90
    ) {
      result.push([lon, lat]);
    }
  }
  return result;
}
function parseKml(textValue) {
  if (/<!DOCTYPE/i.test(textValue)) {
    throw Error('不接受含 DOCTYPE 的 KML 文件');
  }
  const xml = new DOMParser().parseFromString(textValue, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length || xml.documentElement?.localName !== 'kml') {
    throw Error('KML XML 格式有误');
  }
  const placemarks = [...xml.getElementsByTagNameNS('*', 'Placemark')];
  const items = [];
  let vertices = 0;
  let unsupported = 0;
  if (placemarks.length > 5000) {
    throw Error('一次最多处理 5000 个地点，请拆分文件');
  }
  for (let i = 0; i < placemarks.length; i++) {
    const mark = placemarks[i];
    const name =
      [...mark.children].find((c) => c.localName === 'name')?.textContent?.trim() ||
      '未命名地点 ' + (i + 1);
    const points = [];
    const lines = [];
    for (const item of mark.getElementsByTagNameNS('*', 'Point')) {
      const raw = item.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent;
      const coords = parseCoordinates(raw);
      points.push(...coords);
      vertices += coords.length;
    }
    for (const item of mark.getElementsByTagNameNS('*', 'LineString')) {
      const raw = item.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent;
      const coords = parseCoordinates(raw);
      if (coords.length) {
        lines.push(coords);
      }
      vertices += coords.length;
    }
    for (const track of mark.getElementsByTagNameNS('*', 'Track')) {
      const coords = [];
      for (const coord of track.getElementsByTagNameNS('*', 'coord')) {
        const parts = coord.textContent.trim().split(/\s+/).map(Number);
        if (
          parts.length >= 2 &&
          Number.isFinite(parts[0]) &&
          Number.isFinite(parts[1]) &&
          Math.abs(parts[0]) <= 180 &&
          Math.abs(parts[1]) <= 90
        ) {
          coords.push([parts[0], parts[1]]);
        }
      }
      if (coords.length) {
        lines.push(coords);
      }
      vertices += coords.length;
    }
    if (mark.getElementsByTagNameNS('*', 'Polygon').length) {
      unsupported++;
    }
    if (vertices > KML_MAX_VERTICES) {
      throw Error('坐标点超过 60000 个，请拆分 KML 后导入');
    }
    if (points.length || lines.length) {
      items.push({ name, points, lines });
    }
  }
  if (!items.length) {
    throw Error('未找到可用的 Point、LineString 或 gx:Track；面状范围暂不自动导入');
  }
  return { items, vertices, unsupported, placemarks: placemarks.length };
}
// OSM XML is a map data format, not proof of travel. No OSM feature is selected
// automatically; the user chooses the ways, route relations, or tagged points.
function parseOsm(textValue) {
  if (/<!DOCTYPE/i.test(textValue)) {
    throw Error('不接受含 DOCTYPE 的 OSM 文件');
  }
  const xml = new DOMParser().parseFromString(textValue, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length || xml.documentElement?.localName !== 'osm') {
    throw Error('OSM XML 格式有误；二进制文件请选 .osm.pbf 格式');
  }
  const root = xml.documentElement;
  const children = [...root.children];
  const elements = (kind) => children.filter((e) => e.localName === kind);
  const rawNodes = elements('node');
  const rawWays = elements('way');
  const rawRelations = elements('relation');
  if (rawNodes.length > 200000 || rawWays.length > 30000 || rawRelations.length > 10000) {
    throw Error('OSM 要素过多，请裁剪地区或分割文件');
  }
  const tags = (element) =>
    Object.fromEntries(
      [...element.children]
        .filter((x) => x.localName === 'tag')
        .map((x) => [x.getAttribute('k'), x.getAttribute('v') || ''])
        .filter((x) => x[0]),
    );
  const validPoint = (lon, lat) =>
    Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
  const nodes = new Map();
  const features = [];
  const wayLines = new Map();
  let missingRefs = 0;
  let unsupported = 0;
  for (const element of rawNodes) {
    const id = element.getAttribute('id');
    const lon = Number(element.getAttribute('lon'));
    const lat = Number(element.getAttribute('lat'));
    if (
      !id ||
      !element.hasAttribute('lon') ||
      !element.hasAttribute('lat') ||
      !validPoint(lon, lat)
    ) {
      continue;
    }
    nodes.set(id, { point: [lon, lat], tags: tags(element) });
  }
  const describe = (kind, id, attrs) =>
    attrs.name || attrs.ref || attrs['name:zh'] || kind + ' ' + id;
  const summary = (attrs) =>
    Object.entries(attrs)
      .slice(0, 10)
      .map(([k, v]) => k + '=' + v)
      .join('；');
  for (const element of rawWays) {
    const id = element.getAttribute('id');
    if (!id) {
      continue;
    }
    const attrs = tags(element);
    const lines = [];
    const references = [...element.children].filter((x) => x.localName === 'nd');
    let segment = [];
    const finish = () => {
      if (segment.length >= 2) {
        lines.push(segment);
      }
      segment = [];
    };
    for (const nd of references) {
      const ref = nd.getAttribute('ref');
      const known = nodes.get(ref)?.point;
      const lon = Number(nd.getAttribute('lon'));
      const lat = Number(nd.getAttribute('lat'));
      const point =
        known ||
        (nd.hasAttribute('lon') && nd.hasAttribute('lat') && validPoint(lon, lat)
          ? [lon, lat]
          : null);
      if (point) {
        segment.push(point);
      } else {
        finish();
        missingRefs++;
      }
    }
    finish();
    if (!lines.length) {
      continue;
    }
    const closed =
      references.length > 2 &&
      references[0].getAttribute('ref') &&
      references[0].getAttribute('ref') === references.at(-1).getAttribute('ref');
    const kind =
      closed && !attrs.highway && !attrs.railway && !attrs.route && !attrs.waterway
        ? '闭合轮廓'
        : '路径';
    wayLines.set(id, lines);
    features.push({
      id: 'way/' + id,
      name: describe('way', id, attrs),
      kind,
      tagSummary: summary(attrs),
      points: [],
      lines,
      vertices: lines.reduce((n, x) => n + x.length, 0),
    });
  }
  for (const element of rawRelations) {
    const id = element.getAttribute('id');
    const attrs = tags(element);
    if (!id) {
      continue;
    }
    if (!['route', 'superroute'].includes(attrs.type) && !attrs.route) {
      if (attrs.type === 'multipolygon') {
        unsupported++;
      }
      continue;
    }
    const lines = [];
    for (const member of [...element.children].filter(
      (x) => x.localName === 'member' && x.getAttribute('type') === 'way',
    )) {
      for (const line of wayLines.get(member.getAttribute('ref')) || []) {
        lines.push(line);
      }
    }
    if (!lines.length) {
      continue;
    }
    features.push({
      id: 'relation/' + id,
      name: describe('relation', id, attrs),
      kind: '路线关系',
      tagSummary: summary(attrs),
      points: [],
      lines,
      vertices: lines.reduce((n, x) => n + x.length, 0),
    });
  }
  for (const [id, node] of nodes) {
    if (Object.keys(node.tags).length) {
      features.push({
        id: 'node/' + id,
        name: describe('node', id, node.tags),
        kind: '标注点',
        tagSummary: summary(node.tags),
        points: [node.point],
        lines: [],
        vertices: 1,
      });
    }
  }
  if (!features.length) {
    throw Error('OSM 中没有可选路径、路线关系或带标签的点位；请检查是否缺少 way 节点引用');
  }
  return {
    features,
    rawNodes: rawNodes.length,
    rawWays: rawWays.length,
    rawRelations: rawRelations.length,
    missingRefs,
    unsupported,
  };
}
export { parseKml, parseOsm };
