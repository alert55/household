// Tests the REAL recurrenceDates() and anchor() in data.js - pulled out of the
// file rather than hand-copied, so the test cannot drift from the code.
//
//     node tools/recurcheck.js data.js
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

function grab(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

// eslint-disable-next-line no-eval
eval(grab('addDays') + '\n' + grab('recurrenceDates') + '\n' + grab('anchor'));

const fails = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) { console.log('        got  ' + JSON.stringify(got)); console.log('        want ' + JSON.stringify(want)); fails.push(label); }
}

console.log('weekday numbering (must match Postgres extract(dow): 0=Sunday)');
check('2026-09-13 is Sunday -> 0', anchor('2026-09-13').dow, 0);
check('2026-09-11 is Friday -> 5', anchor('2026-09-11').dow, 5);

console.log('\nweekly, anchored on a Friday');
check('every Friday for three weeks',
  recurrenceDates('weekly', [5], null, '2026-09-11', '2026-09-11', '2026-10-01'),
  ['2026-09-11', '2026-09-18', '2026-09-25']);

console.log('\nmonthly on the 31st - the clamp');
check('Feb 2026 (28 days) lands on the 28th',
  recurrenceDates('monthly', null, 31, '2026-01-31', '2026-02-01', '2026-02-28'), ['2026-02-28']);
check('Feb 2028 (leap) lands on the 29th',
  recurrenceDates('monthly', null, 31, '2026-01-31', '2028-02-01', '2028-02-29'), ['2028-02-29']);
check('September (30 days) lands on the 30th',
  recurrenceDates('monthly', null, 31, '2026-08-31', '2026-09-01', '2026-09-30'), ['2026-09-30']);
check('a full quarter: Sep 30, Oct 31, Nov 30',
  recurrenceDates('monthly', null, 31, '2026-08-31', '2026-09-01', '2026-11-30'),
  ['2026-09-30', '2026-10-31', '2026-11-30']);
check('the 15th is never clamped',
  recurrenceDates('monthly', null, 15, '2026-01-15', '2026-02-01', '2026-02-28'), ['2026-02-15']);

console.log('\nno backfill');
check('a series anchored in the past starts from today, not from its anchor',
  recurrenceDates('weekly', [5], null, '2026-08-07', '2026-09-11', '2026-09-20'),
  ['2026-09-11', '2026-09-18']);
check('a future anchor waits for its own date',
  recurrenceDates('daily', null, null, '2026-09-14', '2026-09-11', '2026-09-16'),
  ['2026-09-14', '2026-09-15', '2026-09-16']);

console.log('\nFAILURES: ' + (fails.length ? fails.join('; ') : 'none'));
process.exit(fails.length ? 1 : 0);
