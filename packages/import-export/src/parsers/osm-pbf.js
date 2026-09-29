// File-format decoding only. Matching and record updates live in separate modules.
function readProtobufFields(bytes) {
  const out = [];
  let pos = 0;
  const varint = () => {
    let value = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (pos >= bytes.length) {
        throw Error('PBF 变量长度字段截断');
      }
      const b = bytes[pos++];
      value |= BigInt(b & 127) << shift;
      if (!(b & 128)) {
        return value;
      }
      shift += 7n;
    }
    throw Error('PBF 变量长度字段无效');
  };
  while (pos < bytes.length) {
    const key = Number(varint());
    const number = key >>> 3;
    const wire = key & 7;
    if (!number) {
      throw Error('PBF 字段编号无效');
    }
    let value;
    if (wire === 0) {
      value = varint();
    } else if (wire === 2) {
      const size = Number(varint());
      if (!Number.isSafeInteger(size) || size < 0 || pos + size > bytes.length) {
        throw Error('PBF 字段长度无效');
      }
      value = bytes.subarray(pos, pos + size);
      pos += size;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (pos + size > bytes.length) {
        throw Error('PBF 定长字段截断');
      }
      value = bytes.subarray(pos, pos + size);
      pos += size;
    } else {
      throw Error('PBF 字段编码不受支持');
    }
    out.push({ number, wire, value });
  }
  return out;
}
function readNumericFields(fields, id, signed = false) {
  const values = [];
  for (const f of fields) {
    if (f.number === id) {
      if (f.wire === 0) {
        values.push(f.value);
      } else if (f.wire === 2) {
        let pos = 0;
        let b = f.value;
        while (pos < b.length) {
          let value = 0n;
          let shift = 0n;
          for (let i = 0; i < 10; i++) {
            if (pos >= b.length) {
              throw Error('PBF 列表截断');
            }
            const c = b[pos++];
            value |= BigInt(c & 127) << shift;
            if (!(c & 128)) {
              break;
            }
            shift += 7n;
          }
          values.push(value);
        }
      }
    }
  }
  return values.map((v) => Number(signed ? (v >> 1n) ^ -(v & 1n) : v));
}
function readNumericField(fields, id, fallback = 0, signed = false) {
  return readNumericFields(fields, id, signed)[0] ?? fallback;
}
function readSignedInt64(fields, id) {
  const raw = fields.find((f) => f.number === id && f.wire === 0)?.value;
  if (raw == null) {
    return 0;
  }
  return Number(raw >= 1n << 63n ? raw - (1n << 64n) : raw);
}
function readByteFields(fields, id) {
  return fields.filter((f) => f.number === id && f.wire === 2).map((f) => f.value);
}
function decodeProtobufString(bytes) {
  return new TextDecoder().decode(bytes || new Uint8Array());
}
function readTags(fields, strings) {
  const keys = readNumericFields(fields, 2);
  const vals = readNumericFields(fields, 3);
  const tags = {};
  for (let i = 0; i < Math.min(keys.length, vals.length); i++) {
    if (strings[keys[i]]) {
      tags[strings[keys[i]]] = strings[vals[i]] || '';
    }
  }
  return tags;
}
function decodeDeltaValues(values) {
  let n = 0;
  return values.map((v) => (n += v));
}
async function inflateZlibBlock(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw Error('当前浏览器不支持 PBF 的 zlib 解压，请使用新版 Edge 或 Chrome');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function parseOsmPbf(file) {
  if (file.size > 180 * 1024 * 1024) {
    throw Error('PBF 超过 180 MB，请裁剪地图范围后分批导入');
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const nodes = new Map();
  const rawWays = [];
  const rawRelations = [];
  const features = [];
  const wayLines = new Map();
  let offset = 0;
  let rawNodes = 0;
  let rawWayCount = 0;
  let rawRelationCount = 0;
  let missingRefs = 0;
  let unsupported = 0;
  const validPoint = (lon, lat) =>
    Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
  const addNode = (id, lon, lat, tags) => {
    rawNodes++;
    if (rawNodes > 2200000) {
      throw Error('PBF 含节点超过 220 万，请裁剪地图范围');
    }
    if (validPoint(lon, lat)) {
      nodes.set(String(id), [lon, lat]);
      if (Object.keys(tags).length) {
        features.push({
          id: 'node/' + id,
          name: tags.name || tags.ref || tags['name:zh'] || 'node ' + id,
          kind: '标注点',
          tagSummary: Object.entries(tags)
            .slice(0, 10)
            .map(([k, v]) => k + '=' + v)
            .join('；'),
          points: [[lon, lat]],
          lines: [],
          vertices: 1,
        });
      }
    }
  };
  while (offset < data.length) {
    if (offset + 4 > data.length) {
      throw Error('PBF 文件块头截断');
    }
    const headerSize = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0);
    offset += 4;
    if (headerSize < 1 || headerSize > 65536 || offset + headerSize > data.length) {
      throw Error('PBF 文件块头长度无效');
    }
    const header = readProtobufFields(data.subarray(offset, offset + headerSize));
    offset += headerSize;
    const type = decodeProtobufString(readByteFields(header, 1)[0]);
    const size = readNumericField(header, 3);
    if (size < 1 || size > 33 * 1024 * 1024 || offset + size > data.length) {
      throw Error('PBF 文件块长度无效');
    }
    const blob = readProtobufFields(data.subarray(offset, offset + size));
    offset += size;
    if (type !== 'OSMData') {
      continue;
    }
    let primitive = readByteFields(blob, 1)[0];
    if (!primitive) {
      const compressed = readByteFields(blob, 3)[0];
      if (!compressed) {
        throw Error('PBF 压缩算法暂不支持');
      }
      primitive = await inflateZlibBlock(compressed);
    }
    if (primitive.length > 33 * 1024 * 1024) {
      throw Error('PBF 解压块过大');
    }
    const block = readProtobufFields(primitive);
    const strings = readByteFields(
      readProtobufFields(readByteFields(block, 1)[0] || new Uint8Array()),
      1,
    ).map(decodeProtobufString);
    const gran = readNumericField(block, 17, 100);
    const latOff = readSignedInt64(block, 19);
    const lonOff = readSignedInt64(block, 20);
    const point = (lat, lon) => [(lonOff + gran * lon) / 1e9, (latOff + gran * lat) / 1e9];
    for (const groupBytes of readByteFields(block, 2)) {
      const group = readProtobufFields(groupBytes);
      for (const bytes of readByteFields(group, 1)) {
        const f = readProtobufFields(bytes);
        const id = readNumericField(f, 1, 0, true);
        const tags = readTags(f, strings);
        const [lon, lat] = point(readNumericField(f, 8, 0, true), readNumericField(f, 9, 0, true));
        addNode(id, lon, lat, tags);
      }
      for (const bytes of readByteFields(group, 2)) {
        const f = readProtobufFields(bytes);
        const ids = decodeDeltaValues(readNumericFields(f, 1, true));
        const lats = decodeDeltaValues(readNumericFields(f, 8, true));
        const lons = decodeDeltaValues(readNumericFields(f, 9, true));
        const kv = readNumericFields(f, 10);
        let k = 0;
        for (let i = 0; i < ids.length; i++) {
          const tags = {};
          while (k < kv.length && kv[k] !== 0) {
            const key = strings[kv[k++]];
            const value = strings[kv[k++]];
            if (key) {
              tags[key] = value || '';
            }
          }
          if (k < kv.length) {
            k++;
          }
          const [lon, lat] = point(lats[i], lons[i]);
          addNode(ids[i], lon, lat, tags);
        }
      }
      for (const bytes of readByteFields(group, 3)) {
        const f = readProtobufFields(bytes);
        const id = readNumericField(f, 1);
        const tags = readTags(f, strings);
        const refs = decodeDeltaValues(readNumericFields(f, 8, true));
        const lats = decodeDeltaValues(readNumericFields(f, 9, true));
        const lons = decodeDeltaValues(readNumericFields(f, 10, true));
        rawWays.push({
          id,
          tags,
          refs,
          locations:
            lats.length === refs.length && lons.length === refs.length
              ? lats.map((lat, i) => point(lat, lons[i]))
              : null,
        });
        rawWayCount++;
        if (rawWayCount > 140000) {
          throw Error('PBF 含路径超过 14 万，请裁剪地图范围');
        }
      }
      for (const bytes of readByteFields(group, 4)) {
        const f = readProtobufFields(bytes);
        const id = readNumericField(f, 1);
        const tags = readTags(f, strings);
        const members = decodeDeltaValues(readNumericFields(f, 9, true));
        const types = readNumericFields(f, 10);
        rawRelations.push({ id, tags, members, types });
        rawRelationCount++;
        if (rawRelationCount > 30000) {
          throw Error('PBF 含关系超过 3 万，请裁剪地图范围');
        }
      }
    }
  }
  for (const way of rawWays) {
    const lines = [];
    let segment = [];
    const finish = () => {
      if (segment.length >= 2) {
        lines.push(segment);
      }
      segment = [];
    };
    for (let i = 0; i < way.refs.length; i++) {
      const coord = way.locations?.[i] || nodes.get(String(way.refs[i]));
      if (coord) {
        segment.push(coord);
      } else {
        finish();
        missingRefs++;
      }
    }
    finish();
    if (!lines.length) {
      continue;
    }
    const closed = way.refs.length > 2 && way.refs[0] === way.refs.at(-1);
    const kind =
      closed && !way.tags.highway && !way.tags.railway && !way.tags.route && !way.tags.waterway
        ? '闭合轮廓'
        : '路径';
    wayLines.set(String(way.id), lines);
    features.push({
      id: 'way/' + way.id,
      name: way.tags.name || way.tags.ref || way.tags['name:zh'] || 'way ' + way.id,
      kind,
      tagSummary: Object.entries(way.tags)
        .slice(0, 10)
        .map(([k, v]) => k + '=' + v)
        .join('；'),
      points: [],
      lines,
      vertices: lines.reduce((n, x) => n + x.length, 0),
    });
  }
  for (const relation of rawRelations) {
    if (!['route', 'superroute'].includes(relation.tags.type) && !relation.tags.route) {
      if (relation.tags.type === 'multipolygon') {
        unsupported++;
      }
      continue;
    }
    const lines = [];
    for (let i = 0; i < relation.members.length; i++) {
      if (relation.types[i] === 1) {
        for (const line of wayLines.get(String(relation.members[i])) || []) {
          lines.push(line);
        }
      }
    }
    if (!lines.length) {
      continue;
    }
    features.push({
      id: 'relation/' + relation.id,
      name: relation.tags.name || relation.tags.ref || 'relation ' + relation.id,
      kind: '路线关系',
      tagSummary: Object.entries(relation.tags)
        .slice(0, 10)
        .map(([k, v]) => k + '=' + v)
        .join('；'),
      points: [],
      lines,
      vertices: lines.reduce((n, x) => n + x.length, 0),
    });
  }
  if (!features.length) {
    throw Error('PBF 中没有可选路径、路线关系或带标签的点位');
  }
  return {
    features,
    rawNodes,
    rawWays: rawWayCount,
    rawRelations: rawRelationCount,
    missingRefs,
    unsupported,
  };
}
export { parseOsmPbf };
