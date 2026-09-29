const PHOTO_MAX_BYTES = 80 * 1024 * 1024;
function readAscii(bytes, start, length) {
  let value = '';
  for (let i = 0; i < length && start + i < bytes.length; i++) {
    const c = bytes[start + i];
    if (!c) {
      break;
    }
    value += String.fromCharCode(c);
  }
  return value;
}
function parseTiffMetadata(bytes, base = 0) {
  if (base < 0 || base + 8 > bytes.length) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = readAscii(bytes, base, 2);
  const le = order === 'II';
  if (!le && order !== 'MM') {
    return null;
  }
  const u16 = (p) => (p >= 0 && p + 2 <= bytes.length ? view.getUint16(p, le) : null);
  const u32 = (p) => (p >= 0 && p + 4 <= bytes.length ? view.getUint32(p, le) : null);
  if (u16(base + 2) !== 42) {
    return null;
  }
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  function entries(relative) {
    const first = base + relative;
    const count = u16(first);
    const found = new Map();
    if (count === null || count > 512 || first + 2 + count * 12 > bytes.length) {
      return found;
    }
    for (let i = 0; i < count; i++) {
      const p = first + 2 + i * 12;
      const tag = u16(p);
      const type = u16(p + 2);
      const n = u32(p + 4);
      const unit = sizes[type];
      if (!unit || !n || n > 1000000 || n * unit > PHOTO_MAX_BYTES) {
        continue;
      }
      const pos = n * unit <= 4 ? p + 8 : base + u32(p + 8);
      if (pos < 0 || pos + n * unit > bytes.length) {
        continue;
      }
      found.set(tag, { type, count: n, pos });
    }
    return found;
  }
  function number(entry) {
    if (!entry) {
      return null;
    }
    return entry.type === 3 ? u16(entry.pos) : entry.type === 4 ? u32(entry.pos) : null;
  }
  function ascii(entry) {
    return entry && entry.type === 2 ? readAscii(bytes, entry.pos, entry.count).trim() : '';
  }
  function dms(entry) {
    if (!entry || entry.type !== 5 || entry.count !== 3) {
      return null;
    }
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const numerator = u32(entry.pos + i * 8);
      const denominator = u32(entry.pos + i * 8 + 4);
      if (numerator === null || !denominator) {
        return null;
      }
      parts.push(numerator / denominator);
    }
    if (parts.some((v) => !Number.isFinite(v)) || parts[1] >= 60 || parts[2] >= 60) {
      return null;
    }
    return parts[0] + parts[1] / 60 + parts[2] / 3600;
  }
  const root = entries(u32(base + 4));
  const gps = entries(number(root.get(0x8825)));
  const lat = dms(gps.get(2));
  const lon = dms(gps.get(4));
  const latRef = ascii(gps.get(1)).toUpperCase();
  const lonRef = ascii(gps.get(3)).toUpperCase();
  if (
    lat === null ||
    lon === null ||
    !['N', 'S'].includes(latRef) ||
    !['E', 'W'].includes(lonRef) ||
    lat > 90 ||
    lon > 180
  ) {
    return null;
  }
  const exif = entries(number(root.get(0x8769)));
  return {
    lat: latRef === 'S' ? -lat : lat,
    lon: lonRef === 'W' ? -lon : lon,
    time: ascii(exif.get(0x9003)) || ascii(root.get(0x0132)),
    datum: ascii(gps.get(0x0012)),
  };
}
function parseJpegMetadata(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos++] !== 0xff) {
      break;
    }
    while (bytes[pos] === 0xff) {
      pos++;
    }
    const marker = bytes[pos++];
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    const size = view.getUint16(pos, false);
    if (size < 2 || pos + size > bytes.length) {
      break;
    }
    if (marker === 0xe1 && readAscii(bytes, pos + 2, 6) === 'Exif') {
      const found = parseTiffMetadata(bytes, pos + 8);
      if (found) {
        return found;
      }
    }
    pos += size;
  }
  return null;
}
function parsePngMetadata(bytes) {
  if (readAscii(bytes, 1, 3) !== 'PNG' || bytes[0] !== 137) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos, false);
    const type = readAscii(bytes, pos + 4, 4);
    const data = pos + 8;
    if (length > bytes.length - data - 4) {
      break;
    }
    if (type === 'eXIf') {
      return parseTiffMetadata(bytes, data);
    }
    if (type === 'IEND') {
      break;
    }
    pos = data + length + 4;
  }
  return null;
}
function readIsoBoxes(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let p = start;
  while (p + 8 <= end) {
    let length = view.getUint32(p, false);
    let header = 8;
    const type = readAscii(bytes, p + 4, 4);
    if (length === 1) {
      if (p + 16 > end) {
        break;
      }
      const high = view.getUint32(p + 8, false);
      const low = view.getUint32(p + 12, false);
      length = high * 4294967296 + low;
      header = 16;
    } else if (length === 0) {
      length = end - p;
    }
    if (!Number.isSafeInteger(length) || length < header || p + length > end) {
      break;
    }
    boxes.push({ type, start: p, data: p + header, end: p + length });
    p += length;
  }
  return boxes;
}
function parseHeifMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = readIsoBoxes(bytes, 0, bytes.length);
  if (!top.some((b) => b.type === 'ftyp')) {
    return null;
  }
  const meta = top.find((b) => b.type === 'meta');
  if (!meta) {
    return null;
  }
  const children = readIsoBoxes(bytes, meta.data + 4, meta.end);
  const iinf = children.find((b) => b.type === 'iinf');
  const iloc = children.find((b) => b.type === 'iloc');
  const idat = children.find((b) => b.type === 'idat');
  if (!iinf || !iloc) {
    return null;
  }
  const version = bytes[iinf.data];
  const entryCount =
    version === 0 ? view.getUint16(iinf.data + 4, false) : view.getUint32(iinf.data + 4, false);
  const entries = readIsoBoxes(bytes, iinf.data + (version === 0 ? 6 : 8), iinf.end).slice(
    0,
    entryCount,
  );
  const exifIds = new Set();
  for (const box of entries) {
    if (box.type !== 'infe') {
      continue;
    }
    const v = bytes[box.data];
    const p = box.data + 4;
    if (v >= 2) {
      const id = v === 2 ? view.getUint16(p, false) : view.getUint32(p, false);
      const type = readAscii(bytes, p + (v === 2 ? 4 : 6), 4);
      if (type === 'Exif') {
        exifIds.add(id);
      }
    }
  }
  if (!exifIds.size) {
    return null;
  }
  const read = (position, size) => {
    if (size === 0) {
      return 0;
    }
    if (size > 8 || position + size > bytes.length) {
      throw Error('HEIC 元数据偏移无效');
    }
    let result = 0;
    for (let j = 0; j < size; j++) {
      result = result * 256 + bytes[position + j];
    }
    if (!Number.isSafeInteger(result)) {
      throw Error('HEIC 元数据偏移过大');
    }
    return result;
  };
  const ver = bytes[iloc.data];
  const offsetSize = bytes[iloc.data + 4] >> 4;
  const lengthSize = bytes[iloc.data + 4] & 15;
  const baseSize = bytes[iloc.data + 5] >> 4;
  const indexSize = ver ? bytes[iloc.data + 5] & 15 : 0;
  let p = iloc.data + 6;
  let count = ver < 2 ? view.getUint16(p, false) : view.getUint32(p, false);
  p += ver < 2 ? 2 : 4;
  if (count > 10000) {
    throw Error('HEIC 元数据项目过多');
  }
  for (let i = 0; i < count; i++) {
    const id = ver < 2 ? read(p, 2) : read(p, 4);
    p += ver < 2 ? 2 : 4;
    const method = ver ? read(p, 2) & 4095 : 0;
    if (ver) {
      p += 2;
    }
    p += 2;
    const baseOffset = read(p, baseSize);
    p += baseSize;
    if (p + 2 > bytes.length) {
      break;
    }
    const extents = view.getUint16(p, false);
    p += 2;
    const chunks = [];
    let total = 0;
    for (let j = 0; j < extents; j++) {
      if (ver && indexSize) {
        p += indexSize;
      }
      const relative = read(p, offsetSize);
      p += offsetSize;
      const length = read(p, lengthSize);
      p += lengthSize;
      if (!exifIds.has(id)) {
        continue;
      }
      const start = (method === 1 ? idat?.data : 0) + baseOffset + relative;
      if (
        (method !== 0 && method !== 1) ||
        !Number.isFinite(start) ||
        start < 0 ||
        length < 0 ||
        start + length > bytes.length
      ) {
        throw Error('HEIC Exif 区段无效');
      }
      total += length;
      if (total > 8 * 1024 * 1024) {
        throw Error('HEIC Exif 过大');
      }
      chunks.push(bytes.subarray(start, start + length));
    }
    if (!exifIds.has(id)) {
      continue;
    }
    const data = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      data.set(chunk, at);
      at += chunk.length;
    }
    if (data.length < 8) {
      return null;
    }
    const offset = new DataView(data.buffer).getUint32(0, false);
    const candidates = [4 + offset, 4, 6, 0];
    for (const start of candidates) {
      const found = parseTiffMetadata(data, start);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return null;
}
function photoMetadata(buffer, name) {
  const bytes = new Uint8Array(buffer);
  const extension = name.split('.').pop().toLowerCase();
  let gps = null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    gps = parseJpegMetadata(bytes);
  } else if (bytes[0] === 137) {
    gps = parsePngMetadata(bytes);
  } else if (readAscii(bytes, 0, 2) === 'II' || readAscii(bytes, 0, 2) === 'MM') {
    gps = parseTiffMetadata(bytes);
  } else if (readAscii(bytes, 4, 4) === 'ftyp') {
    gps = parseHeifMetadata(bytes);
  } else if (!['jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'heif'].includes(extension)) {
    throw Error('不支持的格式');
  }
  if (!gps) {
    return null;
  }
  if (
    !Number.isFinite(gps.lon) ||
    !Number.isFinite(gps.lat) ||
    Math.abs(gps.lon) > 180 ||
    Math.abs(gps.lat) > 90
  ) {
    throw Error('GPS 坐标无效');
  }
  return gps;
}
export { photoMetadata };
