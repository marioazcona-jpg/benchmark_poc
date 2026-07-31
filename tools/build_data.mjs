// Benchmark data generator
// Reads data/peers.csv (export from Google Sheets) and produces the dashboard
// data structure (data/generated.json) plus a QA report.
// Run: node tools/build_data.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'peers.csv');
const OUT_JSON = path.join(ROOT, 'data', 'generated.json');

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields, escaped quotes, embedded newlines)
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  text = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const BANK_KEY = {
  'Banco Santander S.A.': 'Santander', 'CaixaBank, S.A.': 'CaixaBank',
  'Grupo Banco Sabadell': 'Sabadell', 'Societe Generale S.A.': 'SocGen',
  'ING Groep N.V.': 'ING', 'Intesa Sanpaolo S.p.A.': 'Intesa',
  'Barclays PLC': 'Barclays', 'Standard Chartered PLC': 'StanChart',
  'NatWest Group plc': 'NatWest', 'Nordea Bank Abp': 'Nordea',
  'HSBC Holdings plc': 'HSBC',
  'Bancolombia S.A.': 'Bancolombia', 'Citigroup Inc.': 'Citigroup',
  'Banco Bilbao Vizcaya Argentaria, S.A.': 'BBVA',
  'Türkiye İş Bankası A.Ş.': 'Isbank', 'Akbank T.A.Ş.': 'Akbank',
  'Yapı ve Kredi Bankası A.Ş.': 'YapiKredi', 'JPMorgan Chase & Co.': 'JPMorgan',
  'Lloyds Banking Group plc': 'Lloyds', 'UniCredit S.p.A.': 'UniCredit',
  'Morgan Stanley': 'MorganStanley', 'The Goldman Sachs Group, Inc.': 'Goldman',
  'Commerzbank AG': 'Commerzbank', 'UBS Group AG': 'UBS',
};
const SECTOR_KEY = {
  'Power': 'Power', 'Oil & Gas': 'Oil & Gas', 'Steel': 'Steel',
  'Automotive': 'Automotive', 'Thermal Coal Mining': 'Coal', 'Aviation': 'Aviation',
  'Commercial Real Estate': 'CRE', 'Residential Real Estate': 'RRE',
  'Agriculture': 'Agriculture', 'Cement': 'Cement', 'Aluminum': 'Aluminium',
  'Shipping': 'Shipping', 'Other': null,
};
const C = {
  bank: 0, sectorRaw: 1, sectorNorm: 2, scope: 3, geo: 6, method: 8, scenario: 9, unit: 10,
  baseY: 12, lastY: 13, objY: 14, vBase: 15, v2023: 16, v2024: 17, v2025: 18,
  v2026: 19, vObj: 20, status: 24, validation: 25, currency: 26, comments: 41,
};

// Cobertura geográfica del objetivo: normaliza variantes a una etiqueta corta para tabla.
function normGeo(s) {
  let t = String(s || '').trim();
  if (!t || /^global$/i.test(t)) return t ? 'Global' : null;
  // multi-país: deja el primero + "…"
  const parts = t.split(/[;,]/).map(x => x.trim()).filter(Boolean);
  const map = {
    'türkiye': 'Turquía', 'turkiye': 'Turquía', 'turkey': 'Turquía',
    'uk': 'UK', 'reino unido': 'UK', 'united kingdom': 'UK',
    'españa': 'España', 'spain': 'España', 'península ibérica': 'Iberia',
    'italia': 'Italia', 'italy': 'Italia', 'germany': 'Alemania', 'alemania': 'Alemania',
    'switzerland': 'Suiza', 'nordics': 'Nórdicos', 'europa': 'Europa', 'europe': 'Europa',
    'holanda': 'Holanda', 'brasil': 'Brasil',
  };
  const first = parts[0];
  const lbl = map[first.toLowerCase()] || first;
  return parts.length > 1 ? `${lbl} +${parts.length - 1}` : lbl;
}

// ---------------------------------------------------------------------------
// Number parsing: comma OR dot decimal; both => last separator is decimal.
// Returns null for non-numeric. Range "X-Y" handled separately.
// ---------------------------------------------------------------------------
function parseNum(s, largeScale = false) {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;
  if (/^(n\/?a|seguimiento|exclusi[oó]n|#div\/0!|—|n\.?d\.?)/i.test(t)) return null;
  // strip trailing unit/notes: keep leading numeric token (allow sign, digits, . ,)
  const m = t.match(/^-?[\d.,]+/);
  if (!m) return null;
  let num = m[0];
  const hasComma = num.includes(','), hasDot = num.includes('.');
  if (hasComma && hasDot) {
    if (num.lastIndexOf(',') > num.lastIndexOf('.')) num = num.replace(/\./g, '').replace(',', '.');
    else num = num.replace(/,/g, '');
  } else if (hasComma) {
    num = num.replace(',', '.');
  } else if (hasDot && largeScale && /^-?\d{1,3}\.\d{3}$/.test(num)) {
    // European thousands separator in a large-scale row (e.g. "1.107" => 1107)
    num = num.replace('.', '');
  } // otherwise lone dot => decimal, keep
  const v = parseFloat(num);
  return Number.isFinite(v) ? v : null;
}

const RANGE_RE = /^\s*(-?[\d.,]+)\s*-\s*(-?[\d.,]+)\s*$/;
function parseRange(s, largeScale = false) {
  const m = String(s || '').trim().match(RANGE_RE);
  if (!m) return null;
  const a = parseNum(m[1], largeScale), b = parseNum(m[2], largeScale);
  if (a == null || b == null) return null;
  return [Math.min(a, b), Math.max(a, b)];
}

// ---------------------------------------------------------------------------
// Scope / status normalisation
// ---------------------------------------------------------------------------
function normScope(s) {
  const nums = new Set();
  String(s || '').replace(/\b([123])(?:\.\d+)?\b/g, (_, d) => { nums.add(+d); return _; });
  if (!nums.size) return '';
  return 'S' + [...nums].sort().join('+');
}
function normStatus(s) {
  const t = String(s || '').toLowerCase();
  if (!t.trim()) return null;
  if (/seguimiento|monitoring/.test(t)) return 'monitoring';
  if (/ahead|exceed|already below|target met|^aligned|\baligned\b|superior/.test(t)) return 'ahead of target';
  if (/misalign|no alineado|off track|worsen|behind|retroceso/.test(t)) return 'misaligned';
  if (/on.?track|avance|on track/.test(t)) return 'on-track';
  return 'on-track';
}

// Short disambiguating label when one bank has several rows in the same tab
function segHint(rec) {
  const s = rec.sectorRaw || '', u = rec.unitRaw || '', su = s + ' ' + u;
  if (/\bTSB\b/i.test(s)) return 'TSB';
  if (/\bBOF\b/i.test(su)) return 'BOF';
  if (/\bEAF\b/i.test(su)) return 'EAF';
  if (/project finance/i.test(s)) return 'Project Fin.';
  if (/nzba/i.test(s)) return 'NZBA';
  if (/corporate/i.test(s)) return 'Corporate';
  if (/upstream/i.test(s)) return 'Upstream';
  if (/down|mid/i.test(s)) return 'Down/Mid';
  if (/passenger|pax/i.test(s)) return 'Pasaje';
  if (/merchant|freight|cargo/i.test(s)) return 'Carga';
  if (/operational/i.test(s)) return 'Operac.';
  if (/end.?use|mix/i.test(s)) return 'Uso final';
  const crop = su.match(/\b(wheat|maize|rice|trigo|ma[ií]z|arroz|soja|corn)\b/i);
  if (crop) return crop[1];
  const tail = s.split(/[-–:]/).pop().trim();
  if (tail && tail.toLowerCase() !== s.toLowerCase() && tail.length <= 14) return tail;
  return rec.scope || 'alt';
}

// ---------------------------------------------------------------------------
// Submetric classification + unit normalisation per sector.
// Returns { submetric, factor, canonical, exclude, reason }.
// ---------------------------------------------------------------------------
function classify(sectorKey, unit, rawVal) {
  const u = String(unit || '').trim();
  const lu = u.toLowerCase();
  const atypical = /°c|temperature|epc|exclusi|no aplica|salida total|phase.?out/i.test(u);

  switch (sectorKey) {
    case 'Cement':
      return { submetric: null, canonical: 'tCO₂e/t', factor: 1 };
    case 'Power': {
      let f = 1;
      if (/t\s*co2.*\/?\s*mwh|tco2e?\/mwh|tco2\/mwh/i.test(lu)) f = 1000;       // t/MWh
      else if (/\/tj/i.test(lu)) return { exclude: true, reason: 'Power en base TJ (energía primaria, seguimiento)' };
      // kg/MWh and g/kWh => factor 1 (numerically equal)
      return { submetric: null, canonical: 'kgCO₂e/MWh', factor: f };
    }
    case 'Steel': {
      if (/ssp|score|deviation|alignment/i.test(lu)) return { submetric: 'Score', canonical: 'SSP score', factor: 1 };
      let f = (rawVal != null && Math.abs(rawVal) > 20) ? 1 / 1000 : 1; // kg→t by magnitude
      return { submetric: 'Intensidad', canonical: 'tCO₂e/t', factor: f };
    }
    case 'Oil & Gas': {
      if (/\bmt|million metric|millones|m mt/i.test(lu)) return { submetric: 'Absolutas', canonical: 'MtCO₂e', factor: 1 };
      if (/boe/i.test(lu)) return { exclude: true, reason: 'O&G intensidad en base boe (no comparable a /MJ)' };
      if (/mj|\/tj/i.test(lu)) {
        // Submétrica Intensidad (gCO₂e/MJ) retirada a petición: O&G solo muestra Absolutas.
        return { exclude: true, reason: 'O&G Intensidad /MJ retirada (solo Absolutas)' };
      }
      if (atypical) return { exclude: true, reason: 'O&G métrica atípica (' + u + ')' };
      return { exclude: true, reason: 'O&G unidad no reconocida (' + u + ')' };
    }
    case 'Automotive': {
      if (/tkm|pkm/i.test(lu)) return { exclude: true, reason: 'Automotive base tkm/pkm (transporte, no por vehículo)' };
      let f = (rawVal != null && Math.abs(rawVal) > 0 && Math.abs(rawVal) < 5) ? 1000 : 1; // kg/t→g
      return { submetric: null, canonical: 'gCO₂/vkm', factor: f };
    }
    case 'Aviation': {
      // existing dashboard splits RPK / RTK
      const sub = /rpk|pkm/i.test(lu) ? 'RPK' : 'RTK';
      return { submetric: sub, canonical: 'gCO₂e/' + sub, factor: 1 };
    }
    case 'Shipping': {
      if (/delta|score|%|\bad\b|alineamiento|alignment/i.test(lu)) return { submetric: 'Alignment', canonical: 'Alignment Δ/score', factor: 1 };
      if (/dwt-?nm|t-?nm|gt-?nm|tnm/i.test(lu)) return { submetric: 'Intensidad', canonical: 'gCO₂/dwt-nm', factor: 1 };
      return { submetric: 'Alignment', canonical: 'Alignment Δ/score', factor: 1 };
    }
    case 'CRE': case 'RRE': {
      if (/m²|m2|sq\.?m|\/m2|m2 era/i.test(lu)) return { submetric: null, canonical: 'kgCO₂e/m²', factor: 1 };
      return { exclude: true, reason: (sectorKey) + ' métrica no-intensidad (' + u + ')' };
    }
    case 'Aluminium': {
      if (/score|delta|alineamiento|saff/i.test(lu)) return { submetric: 'Score', canonical: 'Alignment score', factor: 1 };
      let f = (rawVal != null && Math.abs(rawVal) > 50) ? 1 / 1000 : 1; // kg→t
      return { submetric: 'Intensidad', canonical: 'tCO₂e/t', factor: f };
    }
    case 'Agriculture': {
      if (/°c/i.test(lu)) return { exclude: true, reason: 'Agriculture objetivo en °C (ITR)' };
      if (/mtco2|mtco₂/i.test(lu)) return { submetric: 'Absolutas', canonical: 'MtCO₂e', factor: 1 };
      if (/€m|eurm|revenue/i.test(lu)) return { submetric: 'Int. económica', canonical: 'tCO₂e/€m', factor: 1 };
      return { submetric: 'Int. física', canonical: u || 'físico', factor: 1 };
    }
    case 'Coal': {
      // exposure / phase-out — keep value + unit, currency-aware (rendered approximately)
      return { submetric: null, canonical: 'Exposición', factor: 1, exposure: true };
    }
    default:
      return { exclude: true, reason: 'sector no soportado' };
  }
}

// Sector range sanity (canonical units) for corrupt detection
const SANE = {
  Cement: [0.1, 5], Power: [0, 1200], Steel: [0.2, 5], Automotive: [20, 400],
  Aluminium: [0.3, 15], 'Oil & Gas': null, Aviation: [50, 1300],
};

// ---------------------------------------------------------------------------
// Main transform
// ---------------------------------------------------------------------------
const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
const data = rows.slice(1).filter(r => r.some(c => (c || '').trim() !== ''));

const SKIP_BANKS = new Set(['YapiKredi']); // datos no validados — excluidos a petición
const records = [];
const excluded = [];
const corrupt = [];

for (let ri = 0; ri < data.length; ri++) {
  const r = data[ri];
  const csvLine = ri + 2; // 1-based incl header
  const bankRaw = (r[C.bank] || '').trim();
  const bank = BANK_KEY[bankRaw];
  const secNorm = (r[C.sectorNorm] || '').trim();
  const sector = SECTOR_KEY[secNorm];
  if (!bank) { excluded.push({ csvLine, why: 'banco desconocido: ' + bankRaw }); continue; }
  if (SKIP_BANKS.has(bank)) { excluded.push({ csvLine, bank, why: 'banco excluido (datos no válidos)' }); continue; }
  if (!(secNorm in SECTOR_KEY)) { excluded.push({ csvLine, bank, why: 'sector sin mapear: ' + secNorm.slice(0, 30) }); continue; }
  if (sector === null) { excluded.push({ csvLine, bank, why: "sector 'Other'" }); continue; }

  const unit = (r[C.unit] || '').trim();
  // Detect European thousands convention: a bare integer >= 100 in any value cell
  const largeScale = [C.vBase, C.v2023, C.v2024, C.v2025, C.v2026, C.vObj]
    .some(ci => /^\s*\d{3,}\s*$/.test(r[ci] || ''));
  const rawBase = parseNum(r[C.vBase], largeScale);
  const cls = classify(sector, unit, rawBase);
  if (cls.exclude) { excluded.push({ csvLine, bank, sector, why: cls.reason }); continue; }

  const f = cls.factor || 1;
  const conv = (raw) => (raw == null ? null : raw * f);

  // Build year series (normalised)
  const baseY = parseInt(r[C.baseY]) || null;
  const objY = parseInt(r[C.objY]) || null;
  const series = {};
  const put = (y, raw) => { const v = conv(raw); if (y && v != null) series[y] = v; };
  put(baseY, rawBase);
  put(2023, parseNum(r[C.v2023], largeScale));
  put(2024, parseNum(r[C.v2024], largeScale));
  put(2025, parseNum(r[C.v2025], largeScale));
  put(2026, parseNum(r[C.v2026], largeScale));

  // Objective: in-cell range OR single value (two-row ranges merged later)
  const objRangeCell = parseRange(r[C.vObj], largeScale);
  let objLow = null, objHigh = null, obj = null;
  if (objRangeCell) { objLow = objRangeCell[0] * f; objHigh = objRangeCell[1] * f; }
  else { obj = conv(parseNum(r[C.vObj], largeScale)); }

  // Universal: Excel date serials leaked into value cells (e.g. 46174)
  for (const y of Object.keys(series)) {
    if (series[y] >= 40000 && series[y] <= 50000) {
      corrupt.push({ csvLine, bank, sector, year: y, value: series[y], unit, note: 'serial Excel' });
      delete series[y];
    }
  }
  // Corrupt detection vs sane range (intensity sectors only)
  const sane = SANE[sector];
  if (sane && !cls.exposure && cls.submetric !== 'Score') {
    for (const y of Object.keys(series)) {
      const v = series[y];
      if (v != null && (v < sane[0] || v > sane[1])) {
        corrupt.push({ csvLine, bank, sector, year: y, value: v, unit });
        delete series[y];
      }
    }
  }

  const baseVal = baseY != null ? (series[baseY] ?? null) : null;
  // latest reported (desc)
  let latest = null, latestY = null;
  for (const y of [2026, 2025, 2024, 2023]) if (series[y] != null) { latest = series[y]; latestY = y; break; }

  let pctYTD = null;
  if (baseVal != null && latest != null && baseVal !== 0 && cls.submetric !== 'Score' && cls.submetric !== 'Alignment')
    pctYTD = Math.round((baseVal - latest) / Math.abs(baseVal) * 100);

  // Drop rows with nothing plottable (no series points and no objective)
  if (Object.keys(series).length === 0 && obj == null && objLow == null) {
    excluded.push({ csvLine, bank, sector, why: 'sin datos plottable' });
    continue;
  }

  records.push({
    csvLine, bank, sector, sectorRaw: (r[C.sectorRaw] || '').trim(),
    submetric: cls.submetric, canonical: cls.canonical, factor: f, exposure: !!cls.exposure,
    scope: normScope(r[C.scope]), metod: (r[C.method] || '').trim(),
    scenario: (r[C.scenario] || '').trim(), geo: normGeo(r[C.geo]),
    baseY, objY, series, baseVal, latest, latestY,
    obj, objLow, objHigh,
    status: normStatus(r[C.status]), pctYTD,
    unitRaw: unit, currency: (r[C.currency] || '').trim(),
  });
}

// ---------------------------------------------------------------------------
// Merge two-row ranges: same bank/sector/submetric/scope + identical series,
// differing only in single obj -> objLow/objHigh.
// ---------------------------------------------------------------------------
const sig = (rec) => rec.bank + '|' + rec.sector + '|' + rec.submetric + '|' + rec.scope + '|' +
  rec.sectorRaw + '|' + Object.entries(rec.series).sort().map(([y, v]) => y + ':' + (+v).toFixed(4)).join(',');
const groups = new Map();
for (const rec of records) { const k = sig(rec); (groups.get(k) || groups.set(k, []).get(k)).push(rec); }

const merged = [];
const rangeMerges = [];
for (const [k, recs] of groups) {
  if (recs.length >= 2 && recs.every(x => x.obj != null) && new Set(recs.map(x => x.obj)).size > 1) {
    const objs = recs.map(x => x.obj).sort((a, b) => a - b);
    const base = recs[0];
    base.objLow = objs[0]; base.objHigh = objs[objs.length - 1]; base.obj = null;
    rangeMerges.push({ bank: base.bank, sector: base.sector, sub: base.submetric, low: base.objLow, high: base.objHigh });
    merged.push(base);
  } else {
    for (const rec of recs) merged.push(rec);
  }
}

// objMid + final obj resolution
for (const rec of merged) {
  if (rec.objLow != null && rec.objHigh != null) {
    rec.objMid = (rec.objLow + rec.objHigh) / 2;
    rec.isRange = true;
    if (rec.baseVal != null && rec.latest != null && rec.baseVal !== 0 && !rec.pctYTD && rec.submetric !== 'Score' && rec.submetric !== 'Alignment')
      rec.pctYTD = Math.round((rec.baseVal - rec.latest) / Math.abs(rec.baseVal) * 100);
  } else { rec.objMid = rec.obj; rec.isRange = false; }
}

// ---------------------------------------------------------------------------
// Display-name collision: same (bank, sector, submetric) > 1 -> suffix segment
// ---------------------------------------------------------------------------
const byTab = new Map();
for (const rec of merged) {
  const k = rec.bank + '|' + rec.sector + '|' + rec.submetric;
  (byTab.get(k) || byTab.set(k, []).get(k)).push(rec);
}
const collisions = [];
for (const [k, recs] of byTab) {
  if (recs.length > 1) {
    for (const rec of recs) rec.displaySuffix = segHint(rec);
    collisions.push({ key: k, count: recs.length, suffixes: recs.map(x => x.displaySuffix) });
  }
}

// ---------------------------------------------------------------------------
// Assemble per-sector output + write JSON
// ---------------------------------------------------------------------------
const bySector = {};
for (const rec of merged) (bySector[rec.sector] ||= []).push(rec);
fs.writeFileSync(OUT_JSON, JSON.stringify({ records: merged, bySector }, null, 1));

// ---------------------------------------------------------------------------
// Emit inject-ready JS literal (existing dashboard shape + extras)
// ---------------------------------------------------------------------------
const NEW_META = {
  NatWest:       { flag: '🇬🇧', color: '#5A287D', european: false, spanish: false, tier1: true,  mainPeer: true,  label: 'NatWest' },
  HSBC:          { flag: '🇬🇧', color: '#DB0011', european: false, spanish: false, tier1: true,  mainPeer: true,  label: 'HSBC' },
  Isbank:        { flag: '🇹🇷', color: '#0E4C92', european: false, spanish: false, tier1: false, mainPeer: false, label: 'İşbank' },
  Akbank:        { flag: '🇹🇷', color: '#E2001A', european: false, spanish: false, tier1: false, mainPeer: false, label: 'Akbank' },
  MorganStanley: { flag: '🇺🇸', color: '#00488D', european: false, spanish: false, tier1: true,  mainPeer: false, label: 'Morgan Stanley' },
  Goldman:       { flag: '🇺🇸', color: '#6699CC', european: false, spanish: false, tier1: true,  mainPeer: false, label: 'Goldman Sachs' },
  Commerzbank:   { flag: '🇩🇪', color: '#C9A227', european: true,  spanish: false, tier1: true,  mainPeer: false, label: 'Commerzbank' },
  UBS:           { flag: '🇨🇭', color: '#E60000', european: false, spanish: false, tier1: true,  mainPeer: false, label: 'UBS' },
};

const SELECTOR_DEFAULT = { 'Oil & Gas': 'Absolutas', Shipping: 'Alignment', Steel: 'Intensidad', Aluminium: 'Intensidad', Agriculture: 'Absolutas', Aviation: 'RTK' };
const SUBMETRIC_LABEL = { 'Oil & Gas': 'MtCO₂e', Intensidad: 'gCO₂e/MJ', Score: 'SSP score', Alignment: 'Alignment Δ (%)', 'Int. económica': 'tCO₂e/€m', 'Int. física': 'físico' };

const ORDER = ['BBVA', 'Sabadell', 'CaixaBank', 'Santander', 'SocGen', 'ING', 'Intesa', 'Barclays', 'StanChart', 'HSBC', 'Nordea', 'Bancolombia', 'Citigroup', 'JPMorgan', 'Lloyds', 'UniCredit', 'NatWest', 'Commerzbank', 'UBS', 'MorganStanley', 'Goldman', 'Isbank', 'Akbank'];
const rank = (b) => { const i = ORDER.indexOf(b); return i < 0 ? 999 : i; };
const PRIORITY = new Set(['BBVA', 'Santander', 'CaixaBank', 'Sabadell', 'SocGen', 'ING', 'Intesa']);
const rnd = (v) => v == null ? null : Math.round(v * 1000) / 1000;

function recOut(rec) {
  const s = rec.series;
  return {
    name: rec.bank, seg: rec.displaySuffix || null,
    base: rnd(rec.baseVal), baseY: rec.baseY,
    y2022: rnd(s[2022] ?? null), y2023: rnd(s[2023] ?? null), y2024: rnd(s[2024] ?? null),
    y2025: rnd(s[2025] ?? null), y2026: rnd(s[2026] ?? null),
    obj: rec.isRange ? null : rnd(rec.obj),
    objLow: rnd(rec.objLow), objHigh: rnd(rec.objHigh), objY: rec.objY,
    status: rec.status, pctYTD: rec.pctYTD, scope: rec.scope, metod: rec.metod || '—',
    geo: rec.geo || null,
    show: rec.bank === 'BBVA' || (PRIORITY.has(rec.bank) && Object.keys(rec.series).length > 0),
  };
}

const sectorsOut = {};
const SKIP_SECTORS = new Set(['Coal']); // phase-out multi-divisa: se conserva la versión curada
for (const [sec, recs] of Object.entries(bySector)) {
  if (SKIP_SECTORS.has(sec)) continue;
  recs.sort((a, b) => rank(a.bank) - rank(b.bank));
  if (sec in SELECTOR_DEFAULT && sec !== 'Aviation') {
    const subs = {};
    for (const rec of recs) {
      const sm = rec.submetric || 'Intensidad';
      (subs[sm] ||= []).push(recOut(rec));
    }
    sectorsOut[sec] = { subMetrics: subs, defaultSubMetric: SELECTOR_DEFAULT[sec] };
  } else if (sec === 'Aviation') {
    const subs = { RPK: [], RTK: [] };
    for (const rec of recs) (subs[rec.submetric] ||= []).push(recOut(rec));
    sectorsOut[sec] = { subMetrics: subs, defaultSubMetric: 'RTK' };
  } else {
    sectorsOut[sec] = { banks: recs.map(recOut) };
  }
}

const GEN = { bankMeta: NEW_META, sectors: sectorsOut };
const genLiteral = 'const GEN = ' + JSON.stringify(GEN, null, 2) + ';';
fs.writeFileSync(path.join(ROOT, 'data', 'generated.js'),
  '/* AUTO-GENERADO por tools/build_data.mjs — NO editar a mano. */\n' + genLiteral + '\n');

// Inject the GEN literal directly into index.html between markers (single-file output)
const htmlPath = path.join(ROOT, 'index.html');
const START = '/*GEN_START*/', END = '/*GEN_END*/';
let html = fs.readFileSync(htmlPath, 'utf8');
const si = html.indexOf(START), ei = html.indexOf(END);
if (si >= 0 && ei > si) {
  html = html.slice(0, si + START.length) + '\n' + genLiteral + '\n' + html.slice(ei);
  fs.writeFileSync(htmlPath, html);
  console.log('GEN inyectado en index.html (' + genLiteral.length + ' chars)');
} else {
  console.log('!! marcadores GEN_START/END no encontrados en index.html');
}

// ---------------------------------------------------------------------------
// SENDAS/ESCENARIOS DE BBVA (data/scenarios_full.csv) → literal PATHWAYS (PGEN)
// FUENTE ÚNICA DE VERDAD de los escenarios (reemplaza al antiguo bbva_pathways.csv).
// Formato long: sector,scenario,vintage,metric,unit,year,value. Escenarios por
// sector: CPS/STEPS/NZ del WEO2025 + NZ del WEO2021 (senda histórica → 'nz2021',
// usada en la comparativa temporal de Climate Scenarios).
// Unidades convertidas a las del dashboard (Cement/Steel kg→t).
// 'oil_gas' (absoluto, Mt CO2, sin narrativa) se EXCLUYE del selector de escenarios.
// ---------------------------------------------------------------------------
const PW_SECTOR = {
  cement:   { key: 'Cement',     factor: 0.001, unit: 'tCO₂e/t' },
  steel:    { key: 'Steel',      factor: 0.001, unit: 'tCO₂e/t' },
  aviation: { key: 'Aviation',   factor: 1,     unit: 'gCO₂e/RPK' },
  autos:    { key: 'Automotive', factor: 1,     unit: 'gCO₂/vkm' },
  power:    { key: 'Power',       factor: 1,     unit: 'kgCO₂e/MWh' },
};
const PW_SCEN = { CPS_WEO2025: 'cps', STEPS_WEO2025: 'steps', NZ_WEO2025: 'nz', NZ_WEO2021: 'nz2021' };
const PW_YEARS = Array.from({ length: 2050 - 2020 + 1 }, (_, i) => 2020 + i);

const PATHWAYS = {};
const pwReport = [];
try {
  const rows = parseCSV(fs.readFileSync(path.join(ROOT, 'data', 'scenarios_full.csv'), 'utf8'));
  const head = rows[0].map(h => (h || '').trim());
  const ci = { sector: head.indexOf('sector'), scen: head.indexOf('scenario'), year: head.indexOf('year'), val: head.indexOf('value') };
  // Acumula (sector→scenario→year→value) para reordenar a serie anual continua.
  const acc = {};
  for (const r of rows.slice(1)) {
    if (!r.some(c => (c || '').trim())) continue;
    const secDef = PW_SECTOR[(r[ci.sector] || '').trim()];
    const scen = PW_SCEN[(r[ci.scen] || '').trim()];
    if (!secDef || !scen) continue; // ignora oil_gas y escenarios no mapeados
    const yr = parseInt(r[ci.year]);
    const raw = parseNum(r[ci.val]);
    ((acc[secDef.key] ||= {})[scen] ||= {})[yr] = raw == null ? null : Math.round(raw * secDef.factor * 1000) / 1000;
  }
  for (const [sector, scens] of Object.entries(acc)) {
    const obj = (PATHWAYS[sector] = { years: PW_YEARS, unit: Object.values(PW_SECTOR).find(s => s.key === sector).unit });
    for (const [scen, byYear] of Object.entries(scens)) {
      obj[scen] = PW_YEARS.map(y => (y in byYear ? byYear[y] : null));
    }
  }
  for (const [k, v] of Object.entries(PATHWAYS))
    pwReport.push(`${k}{${Object.keys(v).filter(x => x !== 'years' && x !== 'unit').join(',')}}`);
} catch (e) {
  console.log('!! No se pudo leer data/scenarios_full.csv: ' + e.message);
}

// ---------------------------------------------------------------------------
// OIL & GAS (data/og_scenarios.csv) → se fusiona en PATHWAYS['Oil & Gas'] (senda
// BBVA + real, escala BBVA ~Mt) y GLOBALS['Oil & Gas'] (mundial, escala ~Gt).
// Formato long propio: scenario,vintage,scope,year,value,unit,source. Absoluto
// Mt CO2. WEO2025 → CPS/STEPS/NZE; WEO2023 NZE → senda anterior de la comparativa
// (se guarda en 'nz2021' con cmpPrevVintage='WEO2023'). Solo la serie combinada
// 'Global O&G (A.4)' (no el desglose Oil/Gas). Global y BBVA están a ~1000x de
// escala, por eso NO se superponen: la pantalla muestra BBVA y el global aparte.
// ---------------------------------------------------------------------------
const OG_YEARS = Array.from({ length: 2050 - 2021 + 1 }, (_, i) => 2021 + i);
function loadOG() {
  try {
    const rows = parseCSV(fs.readFileSync(path.join(ROOT, 'data', 'og_scenarios.csv'), 'utf8'));
    const head = rows[0].map(h => (h || '').trim());
    const ci = { scen: head.indexOf('scenario'), vint: head.indexOf('vintage'), scope: head.indexOf('scope'), year: head.indexOf('year'), val: head.indexOf('value') };
    const acc = { bbva: {}, global: {} };
    for (const r of rows.slice(1)) {
      if (!r.some(c => (c || '').trim())) continue;
      const scope = (r[ci.scope] || '').trim();
      const vint = (r[ci.vint] || '').trim();
      const scen = (r[ci.scen] || '').trim();
      let group = null;
      if (scope === 'BBVA O&G') group = 'bbva';
      else if (scope === 'Global O&G (A.4)') group = 'global';
      else continue; // ignora Global Oil (A.4) / Global Gas (A.4)
      let key = null;
      if (vint === 'WEO2025') key = scen === 'CPS' ? 'cps' : scen === 'STEPS' ? 'steps' : scen === 'NZE' ? 'nz' : null;
      else if (vint === 'WEO2023' && scen === 'NZE') key = 'nz2021';
      if (!key) continue;
      const yr = parseInt(r[ci.year]);
      const v = parseNum(r[ci.val]);
      ((acc[group][key] ||= {}))[yr] = v == null ? null : Math.round(v * 1000) / 1000;
    }
    const toSeries = byYear => OG_YEARS.map(y => (y in byYear ? byYear[y] : null));
    const build = g => {
      const o = { years: OG_YEARS, unit: 'Mt CO₂' };
      for (const [k, byYear] of Object.entries(acc[g])) o[k] = toSeries(byYear);
      return o;
    };
    const bbva = build('bbva'); bbva.cmpPrevVintage = 'WEO2023';
    return { bbva, global: build('global') };
  } catch (e) {
    console.log('!! No se pudo leer data/og_scenarios.csv: ' + e.message);
    return null;
  }
}
const OG = loadOG();
if (OG) {
  PATHWAYS['Oil & Gas'] = OG.bbva;
  pwReport.push(`Oil & Gas{${Object.keys(OG.bbva).filter(x => x !== 'years' && x !== 'unit' && x !== 'cmpPrevVintage').join(',')}}`);
}

const pwLiteral = 'const PATHWAYS = ' + JSON.stringify(PATHWAYS) + ';';
{
  const PS = '/*PGEN_START*/', PE = '/*PGEN_END*/';
  const psi = html.indexOf(PS), pei = html.indexOf(PE);
  if (psi >= 0 && pei > psi) {
    html = html.slice(0, psi + PS.length) + '\n' + pwLiteral + '\n' + html.slice(pei);
    fs.writeFileSync(htmlPath, html);
    console.log('PATHWAYS inyectado (' + pwLiteral.length + ' chars) — ' + (pwReport.join(' · ') || 'sin datos'));
  } else {
    console.log('!! marcadores PGEN_START/END no encontrados en index.html');
  }
}

// ---------------------------------------------------------------------------
// NARRATIVAS POR SECTOR (data/sector_narratives.json) → literal NARRATIVES (NGEN)
// intro + 3 tramos (drivers + comparativa NZ2021 vs NZ2025). Se reindexan a las
// claves de sector del dashboard (autos→Automotive, resto capitalizado).
// ---------------------------------------------------------------------------
const NARR_KEY = { cement: 'Cement', steel: 'Steel', aviation: 'Aviation', autos: 'Automotive', power: 'Power' };
const NARRATIVES = {};
const nReport = [];
try {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sector_narratives.json'), 'utf8'));
  for (const [sec, obj] of Object.entries(raw)) {
    const key = NARR_KEY[sec];
    if (!key) continue; // oil_gas u otros sin narrativa
    NARRATIVES[key] = obj;
    nReport.push(`${key}(${(obj.tramos || []).length} tramos)`);
  }
} catch (e) {
  console.log('!! No se pudo leer data/sector_narratives.json: ' + e.message);
}
const nLiteral = 'const NARRATIVES = ' + JSON.stringify(NARRATIVES) + ';';
{
  const NS = '/*NGEN_START*/', NE = '/*NGEN_END*/';
  const nsi = html.indexOf(NS), nei = html.indexOf(NE);
  if (nsi >= 0 && nei > nsi) {
    html = html.slice(0, nsi + NS.length) + '\n' + nLiteral + '\n' + html.slice(nei);
    fs.writeFileSync(htmlPath, html);
    console.log('NARRATIVES inyectado (' + nLiteral.length + ' chars) — ' + (nReport.join(' · ') || 'sin datos'));
  } else {
    console.log('!! marcadores NGEN_START/END no encontrados en index.html');
  }
}

// ---------------------------------------------------------------------------
// ESCENARIOS GLOBALES WEO2025 (data/weo2025_global.csv) → literal GLOBALS (GGEN)
// Comunes a todos los bancos. Ya vienen en unidades del dashboard (sin conversión).
// Se recorta a 2020-2050 para alinear con las sendas de BBVA.
// ---------------------------------------------------------------------------
const GW_SECTOR = {
  'Cement': 'Cement', 'Steel': 'Steel', 'Aviation': 'Aviation', 'Automotive': 'Automotive',
  'Commercial RE': 'CRE', 'Residential RE': 'RRE', 'Aluminium': 'Aluminium', 'Power': 'Power',
};
const GW_SCEN = { CPS: 'cps', STEPS: 'steps', NZE: 'nz' };
const GW_UNIT = {
  Cement: 'tCO₂e/t', Steel: 'tCO₂e/t', Aluminium: 'tCO₂e/t',
  Aviation: 'gCO₂e/RPK', Automotive: 'gCO₂/vkm', Power: 'kgCO₂e/MWh',
  CRE: 'kgCO₂e/m²', RRE: 'kgCO₂e/m²',
};

const GLOBALS = {};
const gwReport = [];
try {
  const gRows = parseCSV(fs.readFileSync(path.join(ROOT, 'data', 'weo2025_global.csv'), 'utf8'));
  const c2020 = gRows[0].indexOf('2020');
  const gYears = gRows[0].slice(c2020).map(y => parseInt(y)).filter(Boolean); // 2020..2050
  for (const r of gRows.slice(1)) {
    if (!r.some(c => (c || '').trim())) continue;
    const key = GW_SECTOR[(r[0] || '').trim()];
    const scen = GW_SCEN[(r[2] || '').trim()];
    if (!key || !scen) continue;
    const obj = (GLOBALS[key] ||= { years: gYears, unit: GW_UNIT[key] || (r[4] || '').trim() });
    obj[scen] = gYears.map((_, i) => {
      const v = parseNum(r[c2020 + i]);
      return v == null ? null : Math.round(v * 1000) / 1000;
    });
  }
  for (const [k, v] of Object.entries(GLOBALS))
    gwReport.push(`${k}{${Object.keys(v).filter(x => x !== 'years' && x !== 'unit').join(',')}}`);
} catch (e) {
  console.log('!! No se pudo leer data/weo2025_global.csv: ' + e.message);
}
// O&G mundial (escala ~Gt, absoluto) — se muestra APARTE del corredor BBVA.
if (typeof OG !== 'undefined' && OG) {
  GLOBALS['Oil & Gas'] = OG.global;
  gwReport.push(`Oil & Gas{${Object.keys(OG.global).filter(x => x !== 'years' && x !== 'unit').join(',')}}`);
}

const gwLiteral = 'const GLOBALS = ' + JSON.stringify(GLOBALS) + ';';
{
  const GS = '/*GGEN_START*/', GE = '/*GGEN_END*/';
  const gsi = html.indexOf(GS), gei = html.indexOf(GE);
  if (gsi >= 0 && gei > gsi) {
    html = html.slice(0, gsi + GS.length) + '\n' + gwLiteral + '\n' + html.slice(gei);
    fs.writeFileSync(htmlPath, html);
    console.log('GLOBALS inyectado (' + gwLiteral.length + ' chars) — ' + (gwReport.join(' · ') || 'sin datos'));
  } else {
    console.log('!! marcadores GGEN_START/END no encontrados en index.html');
  }
}

// ---------------------------------------------------------------------------
// QA REPORT
// ---------------------------------------------------------------------------
console.log('================ QA REPORT ================');
console.log(`Filas CSV: ${data.length} · Registros válidos: ${merged.length} · Excluidos: ${excluded.length}`);
console.log('\n--- Registros por sector / submétrica ---');
for (const s of Object.keys(bySector).sort()) {
  const subs = {};
  for (const rec of bySector[s]) subs[rec.submetric || '—'] = (subs[rec.submetric || '—'] || 0) + 1;
  console.log(`  ${s}: ${bySector[s].length}  {${Object.entries(subs).map(([k, v]) => k + ':' + v).join(', ')}}`);
}

console.log('\n--- Rangos fusionados (2 filas -> low–high) ---');
for (const m of rangeMerges) console.log(`  ${m.bank}/${m.sector}/${m.sub}: ${(+m.low).toFixed(2)}–${(+m.high).toFixed(2)}`);
const cellRanges = merged.filter(r => r.isRange && !rangeMerges.find(m => m.bank === r.bank && m.sector === r.sector));
console.log('\n--- Rangos en celda "X-Y" ---');
for (const r of cellRanges) console.log(`  ${r.bank}/${r.sector}/${r.submetric}: ${(+r.objLow).toFixed(2)}–${(+r.objHigh).toFixed(2)}`);

console.log('\n--- Colisiones de nombre (mismo banco/sector/submétrica) ---');
for (const c of collisions) console.log(`  ${c.key}  ->  ${c.suffixes.join(' / ')}`);

console.log('\n--- VALORES CORRUPTOS (descartados, revisar) ---');
for (const c of corrupt) console.log(`  L${c.csvLine} ${c.bank}/${c.sector} ${c.year}=${c.value} (${c.unit})`);

console.log('\n--- Excluidos por motivo ---');
const exBy = {};
for (const e of excluded) { const w = e.why.replace(/\(.*/, '').trim(); exBy[w] = (exBy[w] || 0) + 1; }
for (const [w, n] of Object.entries(exBy).sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  ${w}`);

console.log(`\nJSON escrito en data/generated.json`);
