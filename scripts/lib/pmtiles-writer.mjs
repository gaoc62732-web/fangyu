import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { zxyToTileId } from 'pmtiles';

// Small, streaming PMTiles v3 writer for our generated MVTs.
// Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
// Consumers use the upstream pmtiles reader, including our round-trip check.
function directory(entries) {
  const bytes = [];
  function varint(value) {
    while (value > 127) {
      bytes.push((value % 128) | 128);
      value = Math.floor(value / 128);
    }
    bytes.push(value);
  }
  varint(entries.length);
  let previous = 0;
  for (const e of entries) {
    varint(e.tileId - previous);
    previous = e.tileId;
  }
  for (const e of entries) varint(e.runLength);
  for (const e of entries) varint(e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i],
      p = entries[i - 1];
    varint(p && e.offset === p.offset + p.length ? 0 : e.offset + 1);
  }
  return gzipSync(Buffer.from(bytes));
}

export class PMTilesWriter {
  constructor(filename) {
    this.filename = filename;
    this.spool = filename + '.tiles.tmp';
    this.fd = fs.openSync(this.spool, 'w');
    this.entries = [];
    this.contents = new Map();
    this.length = 0;
  }
  add(z, x, y, bytes) {
    const key = createHash('sha256').update(bytes).digest('hex');
    let content = this.contents.get(key);
    if (!content) {
      const compressed = gzipSync(bytes);
      content = { offset: this.length, length: compressed.length };
      fs.writeSync(this.fd, compressed);
      this.length += compressed.length;
      this.contents.set(key, content);
    }
    this.entries.push({ tileId: zxyToTileId(z, x, y), runLength: 1, ...content });
  }
  finish({ bounds, maxzoom, metadata }) {
    fs.closeSync(this.fd);
    this.entries.sort((a, b) => a.tileId - b.tileId);
    const entries = [];
    for (const e of this.entries) {
      const previous = entries.at(-1);
      if (
        previous &&
        previous.tileId + previous.runLength === e.tileId &&
        previous.offset === e.offset &&
        previous.length === e.length
      )
        previous.runLength++;
      else entries.push({ ...e });
    }
    let root = directory(entries),
      leafLength = 0;
    const leaves = [];
    if (root.length > 16000) {
      const rootEntries = [];
      for (let i = 0; i < entries.length; i += 4096) {
        const bytes = directory(entries.slice(i, i + 4096));
        rootEntries.push({
          tileId: entries[i].tileId,
          runLength: 0,
          offset: leafLength,
          length: bytes.length,
        });
        leaves.push(bytes);
        leafLength += bytes.length;
      }
      root = directory(rootEntries);
    }
    if (root.length > 16257) throw Error('PMTiles root directory exceeds the first 16 KiB');
    const json = gzipSync(Buffer.from(JSON.stringify(metadata)));
    const header = Buffer.alloc(127);
    header.write('PMTiles', 0);
    header[7] = 3;
    const jsonOffset = 127 + root.length,
      leafOffset = jsonOffset + json.length;
    const values = [
      127,
      root.length,
      jsonOffset,
      json.length,
      leafOffset,
      leafLength,
      leafOffset + leafLength,
      this.length,
      this.entries.length,
      entries.length,
      this.contents.size,
    ];
    values.forEach((value, i) => header.writeBigUInt64LE(BigInt(value), 8 + i * 8));
    header[96] = 0; // content was streamed in XYZ traversal, not Hilbert order
    header[97] = header[98] = 2; // gzip directories/metadata and gzip MVT
    header[99] = 1;
    header[100] = 0;
    header[101] = maxzoom;
    bounds.forEach((n, i) => header.writeInt32LE(Math.round(n * 1e7), 102 + i * 4));
    header[118] = Math.min(4, maxzoom);
    header.writeInt32LE(Math.round((bounds[0] + bounds[2]) * 0.5e7), 119);
    header.writeInt32LE(Math.round((bounds[1] + bounds[3]) * 0.5e7), 123);
    const out = fs.openSync(this.filename + '.tmp', 'w');
    for (const bytes of [header, root, json, ...leaves]) fs.writeSync(out, bytes);
    const input = fs.openSync(this.spool, 'r'),
      buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(input, buffer, 0, buffer.length, null)))
      fs.writeSync(out, buffer, 0, count);
    fs.closeSync(input);
    fs.closeSync(out);
    fs.renameSync(this.filename + '.tmp', this.filename);
    fs.unlinkSync(this.spool);
    return this.entries.length;
  }
}
