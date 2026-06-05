// Comparator (Qualitative Analysis) generator.
// Reads data/comp_cambios.csv + data/comp_analisis.csv and injects
// YOY_DATA / YOY_ANALYSIS / YOY_BANKS / YOY_DOMAINS into index.html.
// Run: node tools/build_comparator.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else f += c; }
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── Bank name → id ────────────────────────────────────────────────────────
const BANK_MAP = {
  'santander': 'santander', 'banco santander': 'santander',
  'ing': 'ing', 'ing group': 'ing', 'ing groep': 'ing',
  'standard chartered': 'stanchart', 'stanchart': 'stanchart',
  'citi': 'citi', 'citigroup': 'citi',
  'societe generale': 'socgen', 'société générale': 'socgen', 'socgen': 'socgen',
  'hsbc': 'hsbc', 'hsbc holdings': 'hsbc',
  'natwest': 'natwest', 'natwest group': 'natwest',
  'barclays': 'barclays',
  'sabadell': 'sabadell', 'banco sabadell': 'sabadell',
  'intesa': 'intesa', 'intesa sanpaolo': 'intesa',
  'nordea': 'nordea',
  'caixabank': 'caixabank',
  'deutsche bank': 'deutsche', 'deutsche': 'deutsche',
  'bancolombia': 'bancolombia',
  'unicredit': 'unicredit',
  'lloyds': 'lloyds', 'lloyds banking group': 'lloyds',
  'akbank': 'akbank',
  'commerzbank': 'commerzbank',
  'jpmorgan': 'jpmorgan', 'jpmorgan chase': 'jpmorgan', 'jp morgan': 'jpmorgan',
  'morgan stanley': 'morganstanley', 'morgan chase': 'morganstanley',
  'bnp': 'bnp', 'bnp paribas': 'bnp',
  'ubs': 'ubs',
  'goldman': 'goldman', 'goldman sachs': 'goldman',
  'isbank': 'isbank', 'işbank': 'isbank', 'türkiye iş bankası': 'isbank',
  'bbva': 'bbva',
};
const bankId = raw => BANK_MAP[String(raw).trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ')] || null;

// ── Sector → dashboard key ────────────────────────────────────────────────
const SECTOR_MAP = {
  oilgas: 'Oil & Gas', oilandgas: 'Oil & Gas', power: 'Power', steel: 'Steel',
  automotive: 'Automotive', automocion: 'Automotive', automoción: 'Automotive',
  cement: 'Cement', aviation: 'Aviation', shipping: 'Shipping',
  cre: 'CRE', commercialrealestate: 'CRE', rre: 'RRE', residentialrealestate: 'RRE',
  coal: 'Coal', aluminium: 'Aluminium', aluminum: 'Aluminium', agriculture: 'Agriculture',
};
const sectorKey = raw => SECTOR_MAP[String(raw).trim().toLowerCase().replace(/\s+/g, '').replace(/&/g, '')] || null;

// Normalise change-type to a canonical CT code (D/F/M/N/S/DM/MF/DF)
function normTipo(raw) {
  const t = String(raw == null ? '' : raw).replace(/[​-‍﻿]/g, '').trim().toUpperCase();
  if (!t || !/^[DFMNS]([\/+\-,. ]*[DFMNS])*$/.test(t)) return { tipo: 'M', bad: true };
  const letters = [...new Set(t.replace(/[^DFMNS]/g, '').split(''))];
  if (letters.length <= 1) return { tipo: letters[0] || 'M', bad: !letters.length };
  const core = letters.filter(l => l !== 'N' && l !== 'S');
  const ord = { D: 0, M: 1, F: 2 };
  core.sort((a, b) => ord[a] - ord[b]);
  return { tipo: core.join('') || letters[0], bad: false };
}

// ── Bank metadata + domains ───────────────────────────────────────────────
const META = {
  santander: { name: 'Santander', abbr: 'SA', color: '#EC0000', flag: '🇪🇸', country: 'España' },
  ing: { name: 'ING Group', abbr: 'IN', color: '#FF6200', flag: '🇳🇱', country: 'Países Bajos' },
  hsbc: { name: 'HSBC', abbr: 'HS', color: '#DB0011', flag: '🇬🇧', country: 'Reino Unido' },
  bnp: { name: 'BNP Paribas', abbr: 'BN', color: '#00965E', flag: '🇫🇷', country: 'Francia' },
  jpmorgan: { name: 'JPMorgan', abbr: 'JP', color: '#003087', flag: '🇺🇸', country: 'Estados Unidos' },
  citi: { name: 'Citi', abbr: 'CI', color: '#003B70', flag: '🇺🇸', country: 'Estados Unidos' },
  barclays: { name: 'Barclays', abbr: 'BA', color: '#00AEEF', flag: '🇬🇧', country: 'Reino Unido' },
  natwest: { name: 'NatWest', abbr: 'NW', color: '#42145F', flag: '🇬🇧', country: 'Reino Unido' },
  socgen: { name: 'Société Générale', abbr: 'SG', color: '#E30613', flag: '🇫🇷', country: 'Francia' },
  deutsche: { name: 'Deutsche Bank', abbr: 'DB', color: '#003399', flag: '🇩🇪', country: 'Alemania' },
  unicredit: { name: 'UniCredit', abbr: 'UC', color: '#E2001A', flag: '🇮🇹', country: 'Italia' },
  sabadell: { name: 'Sabadell', abbr: 'SB', color: '#002D72', flag: '🇪🇸', country: 'España' },
  intesa: { name: 'Intesa Sanpaolo', abbr: 'IS', color: '#009A44', flag: '🇮🇹', country: 'Italia' },
  nordea: { name: 'Nordea', abbr: 'NO', color: '#00005E', flag: '🇫🇮', country: 'Finlandia' },
  caixabank: { name: 'CaixaBank', abbr: 'CX', color: '#007BC4', flag: '🇪🇸', country: 'España' },
  stanchart: { name: 'Standard Chartered', abbr: 'SC', color: '#0F7B3F', flag: '🇬🇧', country: 'Reino Unido' },
  lloyds: { name: 'Lloyds', abbr: 'LL', color: '#024731', flag: '🇬🇧', country: 'Reino Unido' },
  akbank: { name: 'Akbank', abbr: 'AK', color: '#E2001A', flag: '🇹🇷', country: 'Turquía' },
  commerzbank: { name: 'Commerzbank', abbr: 'CO', color: '#D4A017', flag: '🇩🇪', country: 'Alemania' },
  morganstanley: { name: 'Morgan Stanley', abbr: 'MS', color: '#00488D', flag: '🇺🇸', country: 'Estados Unidos' },
  bancolombia: { name: 'Bancolombia', abbr: 'BC', color: '#FDBD12', flag: '🇨🇴', country: 'Colombia' },
  goldman: { name: 'Goldman Sachs', abbr: 'GS', color: '#6699CC', flag: '🇺🇸', country: 'Estados Unidos' },
  ubs: { name: 'UBS', abbr: 'UB', color: '#E60000', flag: '🇨🇭', country: 'Suiza' },
  isbank: { name: 'İşbank', abbr: 'IB', color: '#0E4C92', flag: '🇹🇷', country: 'Turquía' },
  bbva: { name: 'BBVA', abbr: 'BB', color: '#004481', flag: '🇪🇸', country: 'España' },
};
const DOMAINS = {
  santander: 'santander.com', ing: 'ing.com', hsbc: 'hsbc.com', bnp: 'bnpparibas.com',
  jpmorgan: 'jpmorganchase.com', citi: 'citigroup.com', barclays: 'barclays.com', natwest: 'natwest.com',
  socgen: 'societegenerale.com', deutsche: 'db.com', unicredit: 'unicredit.eu', sabadell: 'bancsabadell.com',
  intesa: 'intesasanpaolo.com', nordea: 'nordea.com', caixabank: 'caixabank.es', stanchart: 'sc.com',
  lloyds: 'lloydsbankinggroup.com', akbank: 'akbank.com', commerzbank: 'commerzbank.com',
  morganstanley: 'morganstanley.com', bancolombia: 'bancolombia.com', goldman: 'goldmansachs.com',
  ubs: 'ubs.com', isbank: 'isbank.com.tr', bbva: 'bbva.com',
};
const ORDER = ['santander', 'ing', 'hsbc', 'bnp', 'jpmorgan', 'citi', 'barclays', 'natwest', 'socgen', 'deutsche', 'unicredit', 'sabadell', 'intesa', 'nordea', 'caixabank', 'stanchart', 'lloyds', 'commerzbank', 'morganstanley', 'goldman', 'ubs', 'bancolombia', 'akbank', 'isbank', 'bbva'];

// ── Parse CAMBIOS → YOY_DATA ──────────────────────────────────────────────
const cam = parseCSV(read('data/comp_cambios.csv')).slice(1).filter(r => r.some(c => (c || '').trim()));
const data = [];
const badBanks = new Set(), badSectors = new Set(), tipos = new Set(), badTipos = [];
for (const r of cam) {
  const id = bankId(r[0]); const sec = sectorKey(r[1]);
  if (!id) { badBanks.add((r[0] || '').trim()); continue; }
  if (!sec) { badSectors.add((r[1] || '').trim()); continue; }
  const nt = normTipo(r[2]);
  if (nt.bad) badTipos.push(`${id}/${sec}:"${String(r[2] || '').trim()}"`);
  tipos.add(nt.tipo);
  data.push({
    banco: id, sector: sec, tipo: nt.tipo,
    resumen: (r[3] || '').trim(), descripcion: (r[4] || '').trim(),
    ref2024: (r[5] || '').trim() || '—', ref2025: (r[6] || '').trim() || '—',
    alerta: (r[7] || '').trim() || null,
  });
}

// ── Parse ANALISIS → YOY_ANALYSIS ─────────────────────────────────────────
const ana = parseCSV(read('data/comp_analisis.csv')).slice(1).filter(r => r.some(c => (c || '').trim()));
const analysis = {};
const VALID_ICON = new Set(['alert', 'warn', 'info', 'neutral']);
for (const r of ana) {
  const id = bankId(r[0]); if (!id) { badBanks.add((r[0] || '').trim()); continue; }
  const orden = parseInt(r[1]) || 0;
  const icon = (r[2] || '').trim().toLowerCase();
  const titulo = (r[3] || '').trim();
  const cuerpo = (r[4] || '').trim();
  const isIntro = /true|s[ií]|1/i.test((r[5] || '').trim());
  (analysis[id] ||= { intro: '', points: [], _ord: [] });
  if (isIntro) { analysis[id].intro = cuerpo; }
  else { analysis[id].points.push({ _o: orden, icon: VALID_ICON.has(icon) ? icon : 'info', title: titulo, body: cuerpo }); }
}
for (const id of Object.keys(analysis)) {
  analysis[id].points.sort((a, b) => a._o - b._o).forEach(p => delete p._o);
  delete analysis[id]._ord;
}

// ── YOY_BANKS (only banks with data) ──────────────────────────────────────
const withData = new Set([...data.map(d => d.banco), ...Object.keys(analysis)]);
const orderedIds = [...ORDER.filter(id => withData.has(id)), ...[...withData].filter(id => !ORDER.includes(id))];
const banks = orderedIds.map(id => {
  const m = META[id] || { name: id, abbr: id.slice(0, 2).toUpperCase(), color: '#5A6B80', flag: '🏳️', country: '—' };
  return { id, ...m };
});
const domains = {}; for (const id of orderedIds) domains[id] = DOMAINS[id] || '';

// ── Build QGEN + inject ───────────────────────────────────────────────────
const QGEN = { domains, data, banks, analysis };
const lit = 'const QGEN = ' + JSON.stringify(QGEN) + ';';
const HTML = path.join(ROOT, 'index.html');
let html = fs.readFileSync(HTML, 'utf8');
const MS = '/*QGEN_START*/', ME = '/*QGEN_END*/';

if (html.includes(MS)) {
  const s = html.indexOf(MS), e = html.indexOf(ME);
  html = html.slice(0, s + MS.length) + '\n' + lit + '\n' + html.slice(e);
  console.log('QGEN re-inyectado entre marcadores.');
} else {
  const splice = (h, a, b, rep) => { const s = h.indexOf(a), e = h.indexOf(b, s + 1); if (s < 0 || e < 0) throw new Error('anchor no encontrado: ' + a + ' .. ' + b); return h.slice(0, s) + rep + h.slice(e); };
  html = splice(html, 'const YOY_DOMAINS = {', 'function logoImg', MS + '\n' + lit + '\n' + ME + '\nconst YOY_DOMAINS = QGEN.domains;\n\n');
  html = splice(html, 'const YOY_DATA = [', 'const YOY_BANKS', 'const YOY_DATA = QGEN.data;\n\n');
  html = splice(html, 'const YOY_BANKS = [', 'const YOY_SECTORS', 'const YOY_BANKS = QGEN.banks;\n\n');
  html = splice(html, 'const YOY_ANALYSIS = {', '// ─── YOY STATE', 'const YOY_ANALYSIS = QGEN.analysis;\n\n');
  console.log('Transformación inicial: marcadores QGEN insertados + 4 estructuras enlazadas.');
}
fs.writeFileSync(HTML, html);

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\nCAMBIOS: ${data.length} entradas · ANALISIS: ${Object.keys(analysis).length} bancos`);
console.log('Bancos en comparador:', banks.map(b => b.id).join(', '));
console.log('Tipos usados:', [...tipos].sort().join(', '));
const perBank = {}; for (const d of data) perBank[d.banco] = (perBank[d.banco] || 0) + 1;
console.log('Cambios por banco:', JSON.stringify(perBank));
const noIntro = Object.entries(analysis).filter(([, a]) => !a.intro).map(([k]) => k);
if (noIntro.length) console.log('!! Sin intro:', noIntro.join(', '));
if (badTipos.length) console.log('!! TIPOS inválidos→M (revisar hoja):', badTipos.join(' | '));
if (badBanks.size) console.log('!! BANCOS NO MAPEADOS:', [...badBanks].join(' | '));
if (badSectors.size) console.log('!! SECTORES NO MAPEADOS:', [...badSectors].join(' | '));
console.log(`QGEN: ${(lit.length / 1024).toFixed(0)} KB`);
