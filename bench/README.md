# Benchmark schema

`result-schema.schema.json` is an exact local copy of the ProjectBench result
schema v1 from `docs/result-schema.schema.json`. Keeping the mirror in this
repository lets a clean clone validate benchmark claims without depending on a
path outside the workspace.

## Knowdex coalescing reproduction

The W3 harness uses one real Yjs sender for the one-typist, paste, and AI
workloads; five real Yjs senders for `five_typists`; and ten non-sending
receivers. It uses `@repo/crdt`'s `ProtocolCodec`. It defines the workloads in
`knowdex-coalesce.ts`: 20 updates at 10 chars/s, 100 updates from five
typists, one 2,000-character paste, and 50 token updates at 50 tokens/s.

Run `make bench-knowdex-coalesce` after Docker reports at least 12 GB of
memory. The target refuses to measure below that checkpoint. It runs five
baseline/candidate repetitions per workload; baseline uses
`KNOWDEX_COALESCE_INTERVAL_MS=0` and candidate uses the production default of
16 ms. Each variant is applied by recreating only `ws-backend-bench`, and the
target verifies `/bench/config` before accepting a run. A real warm-up run is
discarded before the five interleaved A/B repetitions. Results are written to
the ignored `bench/results/` directory.

To rerun one workload after an invalid run, use, for example,
`make bench-knowdex-coalesce BENCH_WORKLOADS=ai_stream`. The default runs all
four. Generator CPU is sampled over one-second windows; a shorter workload
uses its full measured duration. Any run above 70% is rejected without a
result file.

Typist operations use unique synthetic Unicode characters from the private-use
range so each one can be matched to receiver visibility for latency. They are
one character per operation but are not ASCII; encoded frame bytes may therefore
differ from ordinary ASCII typing. This is recorded as a limitation in every
result.

The generator uses `ws-backend-bench:8080` inside Compose. Set
`KNOWDEX_WS_URL`, `KNOWDEX_COUNTER_URL`, `KNOWDEX_RESET_URL`, and
`KNOWDEX_CONFIG_URL` for host-run smoke tests.

### Fairness review

The target builds once, then recreates only `ws-backend-bench` with interval 0
or 16 and verifies the running backend through `/bench/config`. Workload
clients, seeded authorization, persistence, rate limits, receiver count,
CPU/memory limits, counter placement, warm-up policy, and reset procedure are
otherwise shared. The counter endpoint returns only deterministically labelled
`receiver-*` connections; sender traffic is excluded. No comparison or resume
wording is valid until the Docker memory checkpoint and all self-checks pass.
