// Extracts the mock data literals embedded in happylocal_v2.html into a JSON seed file.
// Run once:  node server/extract-seed.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dir, '..', 'happylocal_v2.html'), 'utf8');

const NAMES = ['GEO', 'PLACES', 'PL', 'STORES', 'MAP_PDAY', 'cal', 'RV', 'RV_PHOTOS',
  'MY_COURSES', 'FAQ_DATA', 'NOTICE_DATA', 'MY_REVIEWS', 'MY_COUPONS', 'CAT_MATCH',
  'LR_DATA', 'HS_REGION_GROUP', 'POOL', 'VIC', 'FARM_SHOTS', 'STORE_SHOTS',
  'STYLE_DESC', 'ADJ', 'MY_PICKUPS', 'REGIONS',
  // 캘린더·약관도 서버가 관리합니다 (프론트 하드코딩 제거).
  'CAL2_FESTIVAL', 'CAL2_SEASONAL', 'CAL2_SHOP_LISTS', 'CAL2_SHOP_TPL',
  'LEGAL_DATA', 'MY_STATS'];

const BACKSLASH = 92;

// Find `const NAME=` / `let NAME=` and brace-match to the end of the literal.
function extract(name) {
  const re = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*([\\[{])', 'm');
  const m = re.exec(html);
  if (!m) return null;

  const start = m.index + m[0].length - 1;
  const open = m[1];
  const close = open === '[' ? ']' : '}';

  let depth = 0, i = start, inStr = null, esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c.charCodeAt(0) === BACKSLASH) { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

const out = {};
const missing = [];
for (const n of NAMES) {
  const src = extract(n);
  if (!src) { missing.push(n); continue; }
  try {
    out[n] = vm.runInNewContext('(' + src + ')', {}, { timeout: 5000 });
  } catch (e) {
    missing.push(n + ' (eval: ' + e.message + ')');
  }
}

const dir = path.join(__dir, 'data');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'seed.json'), JSON.stringify(out, null, 2), 'utf8');

for (const [k, v] of Object.entries(out)) {
  const n = Array.isArray(v) ? v.length : Object.keys(v).length;
  console.log(String(k).padEnd(18), Array.isArray(v) ? 'array ' : 'object', n);
}
if (missing.length) console.log('\nMISSING: ' + missing.join(', '));
console.log('\nwrote ' + path.join(dir, 'seed.json'));
