import { inflateRawSync } from 'node:zlib';

export function documentXml(zip: Buffer) {
  for (let i = 0; i < zip.length - 46; i++) {
    if (zip.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = zip.readUInt16LE(i + 28);
    const name = zip.subarray(i + 46, i + 46 + nameLength).toString();
    if (name !== 'word/document.xml') continue;
    const offset = zip.readUInt32LE(i + 42);
    const start =
      offset +
      30 +
      zip.readUInt16LE(offset + 26) +
      zip.readUInt16LE(offset + 28);
    const bytes = zip.subarray(start, start + zip.readUInt32LE(i + 20));
    return (
      zip.readUInt16LE(i + 10) === 8 ? inflateRawSync(bytes) : bytes
    ).toString();
  }
  throw new Error('Missing DOCX document');
}
