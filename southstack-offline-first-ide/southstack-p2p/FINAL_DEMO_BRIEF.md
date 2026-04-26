# Final Demo Brief

## One-line pitch

A browser-based distributed agent system that uses multiple devices to debug large codebases locally without APIs.

## Proof-backed claims

- **3-peer real execution**: `agents_completed: 3/3`, `mode: fully-real`
- **Large real codebase**: external Redis repo processed with `total_files_processed: 801` and `total_lines_processed: 354478`
- **Distributed debugging**: analyzer/fixer pipeline runs across peer-1, peer-2, peer-3 and merges outputs
- **No API / local-first**: browser/P2P workflow with local execution and no external LLM API dependency
- **Measured performance gain**:
  - `time_saved_percent: 66.67%`
  - `estimated_parallel_speedup_x: 1.91`

Source artifact: `southstack-p2p/DISTRIBUTED_DEBUG_DEMO_RESULTS.json`

## 1-minute demo script

1. **Connect 3 devices** on same network and open SouthStack P2P.
2. Run:

```bash
npm run run-debug -- --distributed --repo=./external/redis
```

For a **clean terminal** (table + summary only; full JSON on disk):

```bash
npm run run-debug -- --distributed --repo=./external/redis --quiet-json
```

See repo root **`SUBMISSION_README.md`** and **`VIDEO_RECORDING.md`** for packaging and recording.

3. Show terminal table:
   - peer task counts
   - per-peer time
   - done status
   - workload bars
4. Show summary lines:
   - Total Files
   - Issues Found
   - Time Saved
   - Mode
5. Show performance comparison:
   - Single Node Time
   - Distributed Time
   - Speedup
   - Estimated Parallel Speedup
6. Open `southstack-p2p/DISTRIBUTED_DEBUG_DEMO_RESULTS.json` and point at proof fields.

## Reviewer narrative (talk track)

- "This run is on a real external repository, not synthetic fixtures."
- "All three peers execute the debugging pipeline in fully-real mode."
- "The output is deterministic, reproducible, and tied to saved JSON metrics."
- "The system demonstrates practical distributed debugging with local-only execution."
