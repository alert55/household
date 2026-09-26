// Tests the REAL clockIn / hhmmIn / timeLabel / dateIn in data.js: times and
// dates read in the household's timezone, never the browser's.
//
//     node tools/tzcheck.js data.js
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
// eslint-disable-next-line no-eval
eval(['clockIn', 'timeLabel', 'hhmmIn', 'dateIn'].map(grab).join('\n'));

const fails = [];
const check = (label, got, want) => {
  const ok = got === want;
  console.log((ok ? '  ok    ' : '  FAIL  ') + label + (ok ? '' : `   got ${got}, want ${want}`));
  if (!ok) fails.push(label);
};

const t = '2026-09-11T10:30:00Z';
check('10:30Z is 17:30 in Bangkok', hhmmIn(t, 'Asia/Bangkok'), '17:30');
check('10:30Z is 06:30 in New York', hhmmIn(t, 'America/New_York'), '06:30');
check('label reads 5:30p in Bangkok', timeLabel(t, 'Asia/Bangkok'), '5:30p');
check('label reads 6:30a in New York', timeLabel(t, 'America/New_York'), '6:30a');

// 17:00Z is midnight in Bangkok - the date rolls over there, not in UTC.
const late = '2026-09-11T17:00:00Z';
check('17:00Z is already the 12th in Bangkok', dateIn(late, 'Asia/Bangkok'), '2026-09-12');
check('...and still the 11th in UTC', dateIn(late, 'UTC'), '2026-09-11');
check('midnight reads 00:00, not 24:00', hhmmIn(late, 'Asia/Bangkok'), '00:00');
check('midnight label reads 12:00a', timeLabel(late, 'Asia/Bangkok'), '12:00a');
check('noon label reads 12:00p', timeLabel('2026-09-11T05:00:00Z', 'Asia/Bangkok'), '12:00p');

console.log('\nFAILURES: ' + (fails.length ? fails.join('; ') : 'none'));
process.exit(fails.length ? 1 : 0);
