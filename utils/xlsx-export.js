import { t } from '../i18n/loader.js';

function xmlEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function excelSerialDateFromIso(isoDate) {
  const s = String(isoDate || '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const utc = Date.UTC(year, month - 1, day);
  // Excel serial: days since 1899-12-30
  const excelEpoch = Date.UTC(1899, 11, 30);
  return Math.floor((utc - excelEpoch) / 86400000);
}

function colName(n) {
  let x = n;
  let out = '';
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32le(n) {
  const b = new Uint8Array(4);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, n >>> 0, true);
  return b;
}

function u16le(n) {
  const b = new Uint8Array(2);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, n & 0xffff, true);
  return b;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function textUtf8(s) {
  return new TextEncoder().encode(String(s ?? ''));
}

// ZIP writer (store/no-compression) for XLSX packaging.
function zipStore(entries) {
  const files = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textUtf8(entry.path);
    const data = entry.data instanceof Uint8Array ? entry.data : textUtf8(entry.data);
    const crc = crc32(data);

    // Local file header
    const localHeader = concatBytes([
      u32le(0x04034b50), // signature
      u16le(20), // version needed
      u16le(0), // flags
      u16le(0), // compression (store)
      u16le(0), // mod time
      u16le(0), // mod date
      u32le(crc),
      u32le(data.length),
      u32le(data.length),
      u16le(nameBytes.length),
      u16le(0), // extra len
      nameBytes,
    ]);

    files.push(localHeader, data);

    // Central directory header
    const centralHeader = concatBytes([
      u32le(0x02014b50), // signature
      u16le(20), // version made by
      u16le(20), // version needed
      u16le(0), // flags
      u16le(0), // compression
      u16le(0), // mod time
      u16le(0), // mod date
      u32le(crc),
      u32le(data.length),
      u32le(data.length),
      u16le(nameBytes.length),
      u16le(0), // extra
      u16le(0), // comment
      u16le(0), // disk start
      u16le(0), // internal attrs
      u32le(0), // external attrs
      u32le(offset),
      nameBytes,
    ]);
    central.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralStart = offset;
  const centralBytes = concatBytes(central);
  offset += centralBytes.length;

  const end = concatBytes([
    u32le(0x06054b50), // signature
    u16le(0), // disk
    u16le(0), // disk start
    u16le(entries.length),
    u16le(entries.length),
    u32le(centralBytes.length),
    u32le(centralStart),
    u16le(0), // comment len
  ]);

  return concatBytes([...files, centralBytes, end]);
}

function buildStylesXml({ currencyCode = 'EUR' } = {}) {
  const code = String(currencyCode || 'EUR').toUpperCase();
  const dateFmtId = 164;
  const moneyFmtId = 165;
  const moneyFmtRaw = code === 'BRL' ? `"R$" #,##0.00` : `"${code}" #,##0.00`;
  const moneyFmt = xmlEscape(moneyFmtRaw);
  const dateFmt = 'dd/mm/yyyy';

  const darkGray = 'FF6B6B6B';
  const midGray = 'FFD9D9D9';
  const lightGray = 'FFF2F2F2';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="${dateFmtId}" formatCode="${dateFmt}"/>
    <numFmt numFmtId="${moneyFmtId}" formatCode="${moneyFmt}"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${darkGray}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${midGray}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${lightGray}"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="1" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="3" fillId="1" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center"/>
    </xf>
    <xf numFmtId="${moneyFmtId}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="${moneyFmtId}" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center"/>
    </xf>
    <xf numFmtId="${dateFmtId}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function buildSheetXml({ movements, companyName, month, year, currencyCode }) {
  const cols = [
    { width: 12 }, // DATA
    { width: 14 }, // VALOR DOC.
    { width: 14 }, // JUROS/MULTAS
    { width: 14 }, // DESCONTOS
    { width: 14 }, // VALOR PAGO
    { width: 26 }, // TIPO DA DESPESA
    { width: 26 }, // FORNECEDOR
  ];

  const title = t('xlsx.title');
  const companyLabel = t('xlsx.label.company');
  const companyText = `${String(companyLabel || '').trim()} ${String(companyName || '').trim() || ''}`.trim();
  const headers = [
    t('xlsx.col.date'),
    t('xlsx.col.docValue'),
    t('xlsx.col.interest'),
    t('xlsx.col.discount'),
    t('xlsx.col.paidValue'),
    t('xlsx.col.expenseType'),
    t('xlsx.col.vendor'),
  ];

  const rows = [];
  const addCell = (cells, c, valueXml) => {
    cells.push(`<c r="${c}">${valueXml}</c>`);
  };

  // Row 1 (title band)
  {
    const r = 1;
    const cells = [];
    addCell(cells, `A${r}`, `<v>${xmlEscape(title)}</v><is><t>${xmlEscape(title)}</t></is>`);
    for (let i = 2; i <= 5; i++) addCell(cells, `${colName(i)}${r}`, '');
    addCell(cells, `F${r}`, `<is><t>${xmlEscape(companyText)}</t></is>`);
    addCell(cells, `G${r}`, '');
    // Apply styles via separate <c s="..."> is required; build with style attr inline
    const styled = [];
    styled.push(`<c r="A1" s="1" t="inlineStr"><is><t>${xmlEscape(title)}</t></is></c>`);
    for (let i = 2; i <= 5; i++) styled.push(`<c r="${colName(i)}1" s="1"/>`);
    styled.push(`<c r="F1" s="2" t="inlineStr"><is><t>${xmlEscape(companyText)}</t></is></c>`);
    styled.push(`<c r="G1" s="2"/>`);
    rows.push(`<row r="1" ht="28" customHeight="1">${styled.join('')}</row>`);
  }

  // Row 2 (headers)
  {
    const styled = headers
      .map((h, idx) => `<c r="${colName(idx + 1)}2" s="3" t="inlineStr"><is><t>${xmlEscape(h)}</t></is></c>`)
      .join('');
    rows.push(`<row r="2" ht="22" customHeight="1">${styled}</row>`);
  }

  const all = Array.isArray(movements) ? movements : [];
  let rowNum = 3;
  for (const m of all) {
    const dateSerial = excelSerialDateFromIso(m?.date);
    const docValue = Number(m?.docValue) || 0;
    const interest = Number(m?.interest) || 0;
    const discount = Number(m?.discount) || 0;
    const paidValue = Number(m?.paidValue) || 0;
    const expenseType = String(m?.expenseType || '');
    const vendor = String(m?.vendor || '');

    const cells = [];
    if (dateSerial != null) cells.push(`<c r="A${rowNum}" s="8"><v>${dateSerial}</v></c>`);
    else cells.push(`<c r="A${rowNum}" s="8" t="inlineStr"><is><t>${xmlEscape(m?.date || '')}</t></is></c>`);
    cells.push(`<c r="B${rowNum}" s="5"><v>${docValue}</v></c>`);
    cells.push(`<c r="C${rowNum}" s="5"><v>${interest}</v></c>`);
    cells.push(`<c r="D${rowNum}" s="5"><v>${discount}</v></c>`);
    cells.push(`<c r="E${rowNum}" s="6"><v>${paidValue}</v></c>`);
    cells.push(`<c r="F${rowNum}" s="7" t="inlineStr"><is><t>${xmlEscape(expenseType)}</t></is></c>`);
    cells.push(`<c r="G${rowNum}" s="4" t="inlineStr"><is><t>${xmlEscape(vendor)}</t></is></c>`);
    rows.push(`<row r="${rowNum}" ht="20" customHeight="1">${cells.join('')}</row>`);
    rowNum++;
  }

  // Optional extra rows similar to template (VALOR PAGO = 0.00)
  for (let i = 0; i < 3; i++) {
    const cells = [];
    cells.push(`<c r="A${rowNum}" s="8"/>`);
    cells.push(`<c r="B${rowNum}" s="5"/>`);
    cells.push(`<c r="C${rowNum}" s="5"/>`);
    cells.push(`<c r="D${rowNum}" s="5"/>`);
    cells.push(`<c r="E${rowNum}" s="6"><v>0</v></c>`);
    cells.push(`<c r="F${rowNum}" s="7"/>`);
    cells.push(`<c r="G${rowNum}" s="4"/>`);
    rows.push(`<row r="${rowNum}" ht="20" customHeight="1">${cells.join('')}</row>`);
    rowNum++;
  }

  const colsXml = cols
    .map((c, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${c.width}" customWidth="1"/>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr/>
  <dimension ref="A1:G${Math.max(2, rowNum - 1)}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colsXml}</cols>
  <sheetData>${rows.join('')}</sheetData>
  <mergeCells count="2">
    <mergeCell ref="A1:E1"/>
    <mergeCell ref="F1:G1"/>
  </mergeCells>
</worksheet>`;
}

export function buildXlsxEntries({ movements, companyName, month, year, currencyCode = 'EUR' } = {}) {
  const mm = pad2(Number(month) || 1);
  const yyyy = String(Number(year) || new Date().getFullYear());
  const sheetName = `Movimentos ${mm}/${yyyy}`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Controle de movimentação financeira</dc:title>
  <dc:creator>LedgerLite</dc:creator>
  <cp:lastModifiedBy>LedgerLite</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>LedgerLite</Application>
</Properties>`;

  // Minimal theme file improves compatibility with Excel/Numbers.
  const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Calibri"/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst/>
      <a:lnStyleLst/>
      <a:effectStyleLst/>
      <a:bgFillStyleLst/>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

  const styles = buildStylesXml({ currencyCode });
  const sheet = buildSheetXml({ movements, companyName, month, year, currencyCode });

  return [
    { path: '[Content_Types].xml', data: contentTypes },
    { path: '_rels/.rels', data: rels },
    { path: 'docProps/core.xml', data: core },
    { path: 'docProps/app.xml', data: app },
    { path: 'xl/workbook.xml', data: workbook },
    { path: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { path: 'xl/styles.xml', data: styles },
    { path: 'xl/theme/theme1.xml', data: theme },
    { path: 'xl/worksheets/sheet1.xml', data: sheet },
  ];
}

export async function generateXlsxBuffer({ movements, companyName, month, year, currencyCode } = {}) {
  const entries = buildXlsxEntries({ movements, companyName, month, year, currencyCode });
  return zipStore(entries.map((e) => ({ path: e.path, data: e.data })));
}
