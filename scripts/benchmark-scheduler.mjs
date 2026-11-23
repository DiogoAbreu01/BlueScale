// Deterministic, synthetic microbenchmark. It does not measure production or MILP.
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { generateSchedule, validateSchedule } from '../src/lib/scheduler/core.ts';

const repeat = 9;
const warmups = 3;
const rules = { maxMinutesPerMember: 240, maxShiftsPerMember: 4, minRestMinutes: 0 };
const base = Date.parse('2026-11-01T16:00:00.000Z');
const iso = minutes => new Date(base + minutes * 60_000).toISOString();
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const percentile95 = xs => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * .95) - 1];

function fixture(memberCount, shiftCount) {
  const parallel = shiftCount / 5;
  if (!Number.isInteger(parallel)) throw new Error('shiftCount must be a multiple of 5');
  const members = Array.from({ length: memberCount }, (_, i) => ({
    id: 'member-' + i, name: 'Synthetic member ' + i,
    active: i % 19 !== 0,
    commute: ['NEAR', 'MEDIUM', 'FAR'][i % 3],
    preferredPeriod: ['EARLY', 'ANY', 'LATE'][i % 3],
    skillIds: i % 3 === 0 ? ['BAR'] : [],
    availability: [{ start: iso(0), end: iso(360), available: true }],
    historicalMinutes: (i % 6) * 45,
  }));
  const slots = Array.from({ length: shiftCount }, (_, i) => {
    const block = Math.floor(i / parallel);
    return {
      id: 'shift-' + i, station: 'Synthetic station ' + (i % parallel),
      start: iso(block * 60), end: iso((block + 1) * 60),
      minPeople: 2, idealPeople: 3, skillIds: i % 5 === 1 ? ['BAR'] : [],
      priority: 1,
    };
  });
  return { members, slots };
}

const rows = [];
for (const [memberCount, shiftCount] of [[20, 10], [60, 30], [100, 50]]) {
  const { members, slots } = fixture(memberCount, shiftCount);
  for (let i = 0; i < warmups; i++) generateSchedule(members, slots, rules);
  const timings = [];
  let result;
  for (let i = 0; i < repeat; i++) {
    const t0 = performance.now();
    result = generateSchedule(members, slots, rules);
    timings.push(performance.now() - t0);
  }
  const errors = validateSchedule(members, slots, rules, result.assignments);
  if (errors.length) throw new Error('Invalid benchmark fixture/result: ' + errors.join('; '));
  rows.push({
    members: memberCount, shifts: shiftCount, runs: repeat,
    median_ms: Number(median(timings).toFixed(2)),
    p95_ms: Number(percentile95(timings).toFixed(2)),
    assignments: result.assignments.length,
    uncovered_shifts: result.uncovered.length,
  });
}
const report = {
  benchmark: 'BlueScale deterministic TypeScript fallback scheduler (synthetic only)',
  environment: { platform: process.platform, node: process.version, cpu: os.cpus()[0]?.model ?? 'unknown' },
  settings: { warmups, repeat, fixture: '5 sequential 60-minute periods; 2/6/10 parallel slots; fixed ID/skill/availability distributions' },
  rows,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else { console.log(JSON.stringify(report.environment)); console.table(rows); }
