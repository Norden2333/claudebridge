import { inflateRawSync, deflateRawSync } from 'node:zlib';
export const MAX_BINARY = 256 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export const crc32 = bytes => { let n = 0xffffffff; for (const byte of bytes) n = table[(n ^ byte) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; };
const fail = () => { throw new Error('Office 容器损坏、加密或格式不受支持，未改动文件。'); };
// Read package members as data only; never extract paths or run embedded content.
export class OfficeZip {
  constructor(bytes) {
    this.bytes = bytes; this.entries = new Map();
    if (bytes.length > MAX_BINARY || bytes.length < 22) fail();
    let end = -1;
    for (let n = bytes.length - 22; n >= Math.max(0, bytes.length - 65557); n--) if (bytes.readUInt32LE(n) === 0x06054b50 && n + 22 + bytes.readUInt16LE(n + 20) === bytes.length) { end = n; break; }
    if (end < 0) fail();
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
    if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || count !== bytes.readUInt16LE(end + 8) || count > 10000 || !count || start + size !== end) fail();
    this.end = bytes.subarray(end); let position = start, expanded = 0;
    for (let n = 0; n < count; n++) {
      if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) fail();
      const nameLen = bytes.readUInt16LE(position + 28), extraLen = bytes.readUInt16LE(position + 30), commentLen = bytes.readUInt16LE(position + 32), next = position + 46 + nameLen + extraLen + commentLen;
      if (next > end) fail();
      const flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10), compressed = bytes.readUInt32LE(position + 20), length = bytes.readUInt32LE(position + 24), offset = bytes.readUInt32LE(position + 42);
      if (flags & 1 || ![0, 8].includes(method) || bytes.readUInt16LE(position + 34) || compressed === 0xffffffff || length === 0xffffffff || offset === 0xffffffff || offset + 30 > start) fail();
      expanded += length; if (length > MAX_BINARY || expanded > MAX_EXPANDED) fail();
      const nameBytes = bytes.subarray(position + 46, position + 46 + nameLen);
      const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
      if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').some(s => s === '..' || s === '.') || this.entries.has(name)) fail();
      if (bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method) fail();
      const localNameLen = bytes.readUInt16LE(offset + 26), localExtraLen = bytes.readUInt16LE(offset + 28), dataStart = offset + 30 + localNameLen + localExtraLen;
      if (dataStart + compressed > start || !bytes.subarray(offset + 30, offset + 30 + localNameLen).equals(nameBytes)) fail();
      for (const extra of [bytes.subarray(position + 46 + nameLen, position + 46 + nameLen + extraLen), bytes.subarray(offset + 30 + localNameLen, dataStart)]) {
        for (let p = 0; p < extra.length;) { if (p + 4 > extra.length) fail(); const id = extra.readUInt16LE(p), len = extra.readUInt16LE(p + 2); if (id === 1 || p + 4 + len > extra.length) fail(); p += 4 + len; }
      }
      this.entries.set(name, { name, flags, method, compressed, length, crc: bytes.readUInt32LE(position + 16), offset, dataStart, header: bytes.subarray(offset, dataStart), central: bytes.subarray(position, next) }); position = next;
    }
    if (position !== end) fail();
    this.ordered = [...this.entries.values()].sort((a, b) => a.offset - b.offset);
    if (this.ordered[0].offset !== 0) fail();
    for (const [i, entry] of this.ordered.entries()) { const stop = this.ordered[i + 1]?.offset ?? start; if (entry.dataStart + entry.compressed > stop) fail(); entry.raw = bytes.subarray(entry.offset, stop); }
    if (!this.entries.has('[Content_Types].xml')) fail();
  }
  read(name, max = 8 * 1024 * 1024) {
    const entry = this.entries.get(name); if (!entry || entry.length > max) throw new Error('所需文档部分不存在或过大，请缩小范围。');
    const compressed = this.bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed);
    const data = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: max });
    if (data.length !== entry.length || crc32(data) !== entry.crc) fail(); return data;
  }
  rewrite(changes) {
    if ([...this.entries.keys()].some(n => n.startsWith('_xmlsignatures/') || /vbaProject\.bin$/i.test(n))) throw new Error('带数字签名或宏的文档不能在此修改，请使用原应用。');
    // A new copy must not silently propagate a corrupt picture/chart/member.
    for (const name of this.entries.keys()) this.read(name,MAX_BINARY);
    const records = [], centralByName = new Map(); let offset = 0;
    for (const entry of this.ordered) {
      let record = entry.raw, central = Buffer.from(entry.central);
      if (changes.has(entry.name)) {
        const data = changes.get(entry.name), compressed = deflateRawSync(data), sum = crc32(data), header = Buffer.from(entry.header), flags = entry.flags & ~8;
        header.writeUInt16LE(flags, 6); header.writeUInt16LE(8, 8); header.writeUInt32LE(sum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22);
        central.writeUInt16LE(flags, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(sum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24);
        record = Buffer.concat([header, compressed]);
      }
      central.writeUInt32LE(offset, 42); centralByName.set(entry.name, central); records.push(record); offset += record.length;
    }
    const central = Buffer.concat([...this.entries.keys()].map(name => centralByName.get(name))), end = Buffer.from(this.end);
    end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
    const output = Buffer.concat([...records, central, end]); if (output.length > MAX_BINARY) throw new Error('修改后的Office文档超过128 MiB。');
    const verify = new OfficeZip(output);
    for (const [name, entry] of this.entries) { if (changes.has(name)) { if (!verify.read(name).equals(changes.get(name))) fail(); } else if (!verify.entries.get(name).raw.equals(entry.raw)) fail(); }
    return output;
  }
}
