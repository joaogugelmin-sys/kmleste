// Foto carimbada, planilha Excel (.xlsx), KMZ e pacote ZIP para exportação.
/* global JSZip */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
  // remove caracteres de controle inválidos em XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function dataHora(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return { data: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`, hora: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` };
}

// ---------- Foto carimbada ----------
function loadImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

export async function stampPhoto(file, ap) {
  const img = await loadImage(file);
  const MAX = 1920;
  let w = img.naturalWidth, h = img.naturalHeight;
  const sc = Math.min(1, MAX / Math.max(w, h));
  w = Math.round(w * sc); h = Math.round(h * sc);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0, w, h);

  const fs = Math.max(16, Math.round(Math.min(w, h) * 0.032));
  const { data, hora } = dataHora(ap.criado);
  const l1 = [ap.rodovia ? `${ap.rodovia}  km ${ap.kmTxt}` : 'Fora das rodovias cadastradas', ap.sentidoTxt, ap.pista].filter(Boolean).join('  ·  ');
  const l2 = [ap.trecho && `Trecho ${ap.trecho}`, ap.area && `Área ${ap.area}`, ap.tipo].filter(Boolean).join('  ·  ');
  const l3 = `${data} ${hora}  ·  ${ap.lat.toFixed(6)}, ${ap.lon.toFixed(6)}  (±${Math.round(ap.acc)} m)`;
  const l4 = ['KM Leste', ap.nome, ap.lote].filter(Boolean).join('  ·  ');
  const lines = [[l1, 1.25, true], [l2, 1, false], [l3, 1, false], [l4, 0.9, false]];
  const pad = Math.round(fs * 0.6);
  const bandH = lines.reduce((s, [, k]) => s + fs * k * 1.35, 0) + pad * 2;
  g.fillStyle = 'rgba(0,0,0,0.62)';
  g.fillRect(0, h - bandH, w, bandH);
  g.fillStyle = '#f2b705';
  g.fillRect(0, h - bandH, Math.max(6, fs * 0.3), bandH);
  let y = h - bandH + pad;
  g.textBaseline = 'top';
  for (const [t, k, bold] of lines) {
    g.font = `${bold ? '700' : '500'} ${Math.round(fs * k)}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
    g.fillStyle = bold ? '#ffffff' : '#e8e8e8';
    let txt = t;
    while (g.measureText(txt).width > w - pad * 3 && txt.length > 10) txt = txt.slice(0, -2);
    if (txt !== t) txt = txt.slice(0, -1) + '…';
    g.fillText(txt, pad * 1.6, y);
    y += fs * k * 1.35;
  }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
  // miniatura
  const tw = 240, th = Math.round(h * tw / w);
  const tc = document.createElement('canvas'); tc.width = tw; tc.height = th;
  tc.getContext('2d').drawImage(cv, 0, 0, tw, th);
  const thumb = await new Promise((r) => tc.toBlob(r, 'image/jpeg', 0.7));
  return { blob, thumb, w, h };
}

// ---------- XLSX mínimo ----------
const COLS = [
  ['ID', 10], ['Data', 11], ['Hora', 9], ['Usuário', 22], ['Contrato/Lote', 16], ['Rodovia', 10], ['km', 11],
  ['km (m)', 10], ['Estaca', 16], ['Sentido', 12], ['Pista', 8], ['Trecho SRE', 14], ['Área', 6],
  ['De', 30], ['Para', 30], ['Tipo', 24], ['Lado', 8], ['Gravidade', 10], ['Observação', 50],
  ['Latitude', 12], ['Longitude', 12], ['Precisão GPS (m)', 10], ['Dist. eixo (m)', 10], ['Base', 14], ['Fotos', 40],
];

function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

export function buildXlsx(zip, rows) {
  const cell = (v, r, c, style) => {
    const ref = colName(c) + r;
    const s = style ? ` s="${style}"` : '';
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    if (v === null || v === undefined || v === '') return `<c r="${ref}"${s}/>`;
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  let sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols>' + COLS.map(([, w], i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
  sheet += '<row r="1">' + COLS.map(([n], i) => cell(n, 1, i, 1)).join('') + '</row>';
  rows.forEach((row, ri) => {
    sheet += `<row r="${ri + 2}">` + row.map((v, ci) => cell(v, ri + 2, ci, 2)).join('') + '</row>';
  });
  sheet += `</sheetData><autoFilter ref="A1:${colName(COLS.length - 1)}${rows.length + 1}"/></worksheet>`;

  const x = zip.folder('xl');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  x.file('workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Apontamentos" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Apontamentos!$A$1:$' + colName(COLS.length - 1) + '$' + (rows.length + 1) + '</definedName></definedNames></workbook>');
  x.file('_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  x.file('styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B4F9C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD0D0D0"/></left><right style="thin"><color rgb="FFD0D0D0"/></right><top style="thin"><color rgb="FFD0D0D0"/></top><bottom style="thin"><color rgb="FFD0D0D0"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf borderId="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  x.file('worksheets/sheet1.xml', sheet);
}

export function apRow(ap, fotoNames) {
  const { data, hora } = dataHora(ap.criado);
  return [
    ap.codigo, data, hora, ap.nome || '', ap.lote || '', ap.rodovia || '', ap.kmTxt || '',
    ap.km != null ? Math.round(ap.km) : '', ap.estaca || '', ap.sentidoTxt || '', ap.pista || '', ap.trecho || '', ap.area || '',
    ap.de || '', ap.para || '', ap.tipo || '', ap.lado || '', ap.grav || '', ap.obs || '',
    +ap.lat.toFixed(7), +ap.lon.toFixed(7), Math.round(ap.acc), ap.dist != null ? Math.round(ap.dist) : '',
    ap.base || '', fotoNames.join(', '),
  ];
}

// ---------- KML / KMZ ----------
const GRAV_COLOR = { Alta: 'ff1c1cd6', 'Média': 'ff0596f2', Baixa: 'ff3ca83c' }; // aabbggrr

export function buildKml(items) {
  let k = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>KM Leste – Apontamentos</name>';
  for (const [g, c] of Object.entries(GRAV_COLOR)) {
    k += `<Style id="g${g === 'Média' ? 'Media' : g}"><IconStyle><color>${c}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`;
  }
  for (const { ap, fotos } of items) {
    const { data, hora } = dataHora(ap.criado);
    const st = ap.grav === 'Alta' ? 'gAlta' : ap.grav === 'Baixa' ? 'gBaixa' : 'gMedia';
    let d = `<b>${esc(ap.rodovia || '')} km ${esc(ap.kmTxt || '')}</b> – ${esc(ap.sentidoTxt || '')} ${esc(ap.pista || '')}<br/>` +
      `Trecho ${esc(ap.trecho || '–')} · Área ${esc(ap.area || '–')}<br/>` +
      `<b>${esc(ap.tipo || '')}</b> · Lado ${esc(ap.lado || '–')} · Gravidade ${esc(ap.grav || '–')}<br/>` +
      `${esc(ap.obs || '')}<br/>${data} ${hora} · ${esc(ap.nome || '')}<br/>`;
    for (const f of fotos) d += `<img src="files/${f}" width="480"/><br/>`;
    k += `<Placemark><name>${esc(ap.codigo)} – ${esc(ap.tipo || '')}</name><styleUrl>#${st}</styleUrl>` +
      `<description><![CDATA[${d}]]></description><TimeStamp><when>${ap.criado}</when></TimeStamp>` +
      `<Point><coordinates>${ap.lon},${ap.lat},0</coordinates></Point></Placemark>`;
  }
  return k + '</Document></kml>';
}

export async function buildPackage(items, meta) {
  // items: [{ap, fotos:[{blob}]}]
  const zip = new JSZip();
  const kmz = new JSZip();
  const rows = [];
  const kmlItems = [];
  for (const { ap, fotos } of items) {
    const names = [];
    fotos.forEach((f, i) => {
      const n = `${ap.codigo}_${i + 1}.jpg`;
      names.push(n);
      zip.file(`fotos/${n}`, f.blob);
      kmz.file(`files/${n}`, f.blob);
    });
    rows.push(apRow(ap, names));
    kmlItems.push({ ap, fotos: names });
  }
  const xz = new JSZip();
  buildXlsx(xz, rows);
  zip.file('apontamentos.xlsx', await xz.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  kmz.file('doc.kml', buildKml(kmlItems));
  zip.file('apontamentos.kmz', await kmz.generateAsync({ type: 'blob', compression: 'STORE' }));
  zip.file('LEIA-ME.txt',
    `KM Leste – exportação de apontamentos\r\nUsuário: ${meta.nome || '-'}\r\nGerado em: ${meta.quando}\r\nApontamentos: ${items.length}\r\n\r\n` +
    `apontamentos.xlsx  – planilha (abre no Excel)\r\napontamentos.kmz   – pontos com fotos (abre no Google Earth / QGIS)\r\nfotos/             – fotos carimbadas com rodovia, km, sentido, data e coordenadas\r\n`);
  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
}
