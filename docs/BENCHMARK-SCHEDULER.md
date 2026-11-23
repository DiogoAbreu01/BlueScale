# BlueScale — reproducible scheduler microbenchmark

**Scope:** deterministic TypeScript fallback algorithm (`src/lib/scheduler/core.ts`) only. This is a *synthetic in-memory microbenchmark*, **not** database latency, end-to-end throughput, hosted-service performance, or the optional Python/MILP optimizer.

## Reproduce

With **Node.js 22 or later** installed, at the repository root:

```powershell
node --experimental-strip-types scripts/benchmark-scheduler.mjs
node --experimental-strip-types scripts/benchmark-scheduler.mjs --json
```

No database, sign-in, live user data or npm dependencies are required for this benchmark. The script generates deterministic input (five consecutive 60-minute periods; 2, 6 or 10 parallel shifts; fixed skills, availability, commute and historical workloads), runs **3 warmups and 9 measured iterations**, then validates the output against `validateSchedule`. Medians and nearest-rank p95 values are reported in milliseconds.

## Measured snapshot (local Windows PC, 22 Nov 2026)

Host: **AMD Ryzen 5 5500**, Windows, **Node v24.22.1**. Run from an isolated clone on the user's PC in Itajubá, Brazil.

| Members | Shifts | Final assignments | Uncovered shifts | Median algorithm time | p95 of 9 runs |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 10 | 30 | 0 | **3.52 ms** | 4.09 ms |
| 60 | 30 | 90 | 0 | **50.07 ms** | 50.82 ms |
| 100 | 50 | 150 | 0 | **206.65 ms** | 210.96 ms |

The numbers above are **one observed sample**, not an SLA, upper bound, universal performance claim or production capacity guarantee. Results will vary with CPU, thermal load, Node version, the number and distribution of constraints, and other processes. The fixture is intentionally reproducible, not representative of every real event.

## Interpretation and follow-up

- These cases demonstrate the deterministic fallback can generate *valid schedules under this test fixture* and provide a transparent timing baseline.
- This does **not** prove globally optimal allocation, latency under concurrent users, network speed, or performance of the real API and database.
- For release validation, separately measure: PostgreSQL query/migration latency, the optional MILP service, HTTP request duration, cold-start behavior and real-browser E2E flows.
- Since scoring and eligibility checks operate over assignments and shift/member arrays, scaling should be measured on larger instances rather than extrapolated linearly from this small table.

The benchmark produces fresh measurements when re-run; only published, reproducible logs should be used as portfolio evidence. See [release validation](RELEASE-V1.md) and [CI workflow](../.github/workflows/ci.yml).
