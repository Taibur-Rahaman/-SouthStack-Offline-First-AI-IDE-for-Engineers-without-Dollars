# Demo Dry Run Results

This report captures automated dry-run evidence for the remaining checklist items.

## 1) Host + 2 Peer Stability

- Source: `P2P_STABILITY_PROBE_RESULTS.json`
- Duration: `120s`
- Loops: `286`
- Failures: `0`
- Reconnect events: `286`
- Result: `PASS`

Interpretation:
- Signaling and reconnect flow remained stable across repeated host and two-peer style join cycles.

## 2) Multi-Device Debugging Validation

- Sources:
  - `DEBUG_PIPELINE_REGRESSION_RESULTS.json`
  - `DEBUG_BUG_LIFECYCLE_RESULTS.json`
- Result: `PASS`

Validated behavior:
- Debug intent detection
- 4-stage distributed pipeline generation
- Stage ordering correctness
- Simulated full bug lifecycle merge path

## 3) Large Open-Source Codebase Validation

- Source: `OPEN_SOURCE_CODEBASE_RESULTS.json`
- Codebase: `external/redis`

Scenario summary:
- 10k target: completed
- 50k target: completed
- 500k target: completed (with documented augmentation when repository line count is lower than target)

Metrics captured:
- actual lines and chars
- chunk count
- chunking latency
- routing latency
- sample peer routing map

## 4) Privacy and Local Data Handling Validation

- Source: `LOCAL_DATA_HANDLING_RESULTS.json`
- Result: `PASS`

Validation rule:
- No non-local endpoint call should carry task or prompt payload fields.

## 5) Dry Run Outcome

Automated dry-run checks completed without blocking failures.
