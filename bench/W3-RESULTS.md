# W3 Knowdex coalescing results

Measured locally on 2026-11-16 for [C2](https://github.com/Krishna-Mehta-135/Knowdex/issues/48).
The original resume claim was about a 90% reduction in outbound WebSocket update
frames under keystroke-burst load. These results do not support that number.

Each accepted workload has five interleaved baseline (0 ms) and candidate
(16 ms) runs after a discarded warm-up. Values below are medians; brackets show
the minimum and maximum across runs. Frames and bytes are per non-sending
receiver. The latency cost is candidate minus baseline median.

| Workload                      | Update frames: 0 ms → 16 ms | Frame reduction | Update bytes: 0 ms → 16 ms                | Byte reduction | Delivery p50: 0 ms → 16 ms (cost)                     | Delivery p99: 0 ms → 16 ms (cost)                        |
| ----------------------------- | --------------------------- | --------------: | ----------------------------------------- | -------------: | ----------------------------------------------------- | -------------------------------------------------------- |
| One typist, 10 chars/s        | 20 [20–20] → 20 [20–20]     |              0% | 420 [381–420] → 420 [420–420]             |             0% | 1.46 [1.35–2.16] → 18.10 [17.85–19.16] ms (+16.64 ms) | 4.49 [3.66–14.20] → 21.84 [21.65–22.78] ms (+17.36 ms)   |
| Five typists, 10 chars/s each | 100 [100–100] → 20 [20–20]  |             80% | 8,940 [8,748–8,940] → 2,885 [2,865–2,905] |         67.73% | 5.90 [5.86–9.80] → 19.81 [19.35–20.30] ms (+13.91 ms) | 10.88 [10.05–19.97] → 23.89 [22.98–29.02] ms (+13.01 ms) |
| 2,000-character paste         | Inconclusive                |               — | Inconclusive                              |              — | Inconclusive                                          | Inconclusive                                             |
| AI stream, 50 tokens/s        | 50 [50–50] → 50 [44–50]     |              0% | 1,354 [1,354–1,354] → 1,354 [1,294–1,354] |             0% | 1.12 [0.97–1.48] → 18.21 [17.85–18.97] ms (+17.10 ms) | 4.70 [4.04–6.37] → 23.34 [22.87–152.08] ms (+18.64 ms)   |

The paste's first measured baseline run reached **131.48% generator CPU** and
failed the plan's 70% validity gate. No paste result file was accepted, so no
paste reduction or latency value is inferred. Its warm-ups completed, but the
required five valid repetitions did not; [issue #54](https://github.com/Krishna-Mehta-135/Knowdex/issues/54)
tracks a valid rerun. The AI candidate p99 range includes
a 152.08 ms outlier; do not describe its latency as reliably bounded by the
median.

**Proposed resume wording for owner review:** “Reduced outbound WebSocket update
frames by 80% with five simultaneous typists in a local 10-receiver benchmark
(100 to 20 frames per receiver); median p99 delivery latency rose from 10.88
to 23.89 ms.” The 90% number should be removed. There was no median frame
reduction for one typist or the AI stream.

## Method and fairness review

- The system under test used Docker cpuset `0-1`, 384 MB per app container;
  the generator used cores `2-3`. Docker reported 12,480,258,048 bytes of
  memory, above the 12 GB checkpoint. Host: Apple M5, ARM, macOS; Docker
  29.9.3. Docker on macOS runs in a VM and client and server share a host.
- Within each workload, baseline and candidate used the same WebSocket image
  digest and commit. The interval switch (0 or 16 ms) was the only deliberate
  backend difference; `/bench/config` verified it. Clients, document, auth,
  schedule, reset procedure, and ten receivers were shared. One/five typists
  used commit `dad9122`; AI stream used `b3bbeac`, after a Makefile workload
  selector change. No comparison combines runs from different commits.
- The generator could affect the latency measure because real Yjs clients and
  server share the laptop. Valid runs stayed below 70% generator CPU (highest
  observed 24.55%) using one-second CPU windows. The paste workload showed
  this risk can invalidate a run. CPU sampling excludes connection setup and
  metric aggregation. The five-typist frame reduction is exact across all
  five repetitions, while delivery latency includes client scheduling.
- Counters include outbound document **update** frames only, excluding sync,
  awareness, and control frames. Typist markers are unique one-character
  private-use Unicode symbols, not ASCII; encoded bytes may differ from
  ordinary typing. The 2,000-character paste is a single update, so its
  coalescing benefit could be small even if a valid run is obtained.

Reproduce with `make bench-knowdex-coalesce` after `docker info` reports at
least 12 GB. Run a selected workload with
`make bench-knowdex-coalesce BENCH_WORKLOADS=ai_stream`. The harness rejects
CPU-over-limit or failed self-check runs before writing schema-v1 files.
Accepted raw files remain locally in ignored `bench/results/` for ProjectBench
ingestion; they are not committed.
