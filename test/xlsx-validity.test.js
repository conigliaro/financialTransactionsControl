import { describe, it, expect } from 'vitest';
import { generateXlsxBuffer } from '../utils/xlsx-export.js';

function findEndOfCentralDir(buf) {
  // EOCD signature: 0x06054b50
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0xffff); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  return -1;
}

function readU16LE(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}

function readU32LE(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function unzipStore(buf) {
  const eocd = findEndOfCentralDir(buf);
  if (eocd < 0) throw new Error('Missing EOCD');
  const cdCount = readU16LE(buf, eocd + 10);
  const cdSize = readU32LE(buf, eocd + 12);
  const cdOff = readU32LE(buf, eocd + 16);
  if (cdOff + cdSize > buf.length) throw new Error('Central directory out of bounds');

  const files = new Map();
  let p = cdOff;
  for (let i = 0; i < cdCount; i++) {
    if (!(buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x01 && buf[p + 3] === 0x02)) {
      throw new Error('Bad central dir signature');
    }
    const nameLen = readU16LE(buf, p + 28);
    const extraLen = readU16LE(buf, p + 30);
    const commentLen = readU16LE(buf, p + 32);
    const localOff = readU32LE(buf, p + 42);
    const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen));
    p = p + 46 + nameLen + extraLen + commentLen;

    // Local header signature: 0x04034b50
    if (!(buf[localOff] === 0x50 && buf[localOff + 1] === 0x4b && buf[localOff + 2] === 0x03 && buf[localOff + 3] === 0x04)) {
      throw new Error(`Bad local header signature for ${name}`);
    }
    const lhNameLen = readU16LE(buf, localOff + 26);
    const lhExtraLen = readU16LE(buf, localOff + 28);
    const compMethod = readU16LE(buf, localOff + 8);
    const compSize = readU32LE(buf, localOff + 18);
    if (compMethod !== 0) throw new Error(`Compression not supported for ${name}`);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const dataEnd = dataStart + compSize;
    files.set(name, buf.slice(dataStart, dataEnd));
  }
  return files;
}

function parseXml(bytes) {
  const text = new TextDecoder().decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`XML parse error: ${parserError.textContent}`);
  }
  return { text, doc };
}

describe('XLSX validity (ZIP + XML well-formed)', () => {
  it('generates a zip with required parts and parseable XML', async () => {
    const buf = await generateXlsxBuffer({
      movements: [
        {
          id: 'm1',
          date: '2026-01-18',
          docValue: 100,
          interest: 1.5,
          discount: 0,
          paidValue: 101.5,
          expenseType: 'Café & almoço',
          vendor: 'José Ñandú',
        },
      ],
      companyName: 'ACME & Sons',
      month: 1,
      year: 2026,
      currencyCode: 'EUR',
    });

    expect(buf.length).toBeGreaterThan(1024);
    expect(String.fromCharCode(buf[0], buf[1])).toBe('PK');

    const files = unzipStore(buf);
    const required = [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/theme/theme1.xml',
      'xl/worksheets/sheet1.xml',
      'docProps/core.xml',
      'docProps/app.xml',
    ];
    for (const p of required) expect(files.has(p)).toBe(true);

    const styles = parseXml(files.get('xl/styles.xml'));
    expect(styles.text).toContain('&quot;EUR&quot;');

    const sheet = parseXml(files.get('xl/worksheets/sheet1.xml'));
    expect(sheet.text).toContain('Controle de movimentação financeira');
    expect(sheet.text).toContain('Empresa: ACME &amp; Sons');
    expect(sheet.text).toContain('VALOR PAGO');
    expect(sheet.text).toContain('<mergeCell ref="A1:E1"/>');
  });

  it('handles special characters and newlines without breaking XML', async () => {
    const buf = await generateXlsxBuffer({
      movements: [
        {
          id: 'm2',
          date: '2026-02-01',
          docValue: 0.01,
          interest: 0,
          discount: 0,
          paidValue: 0.01,
          expenseType: '🧾 Pró-labore',
          vendor: 'São Paulo',
          notes: 'line1\nline2',
        },
      ],
      companyName: 'Emoji 💼',
      month: 2,
      year: 2026,
      currencyCode: 'BRL',
    });

    const files = unzipStore(buf);
    parseXml(files.get('xl/worksheets/sheet1.xml'));
    parseXml(files.get('xl/styles.xml'));
  });
});

