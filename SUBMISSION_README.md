# CSE327 — Browser-Based P2P Agentic Coding (Submission)

## One command (distributed demo + metrics)

From the **repository root** (with Node.js installed):

```bash
npm install
npm run run-debug -- --distributed --repo=./external/redis
```

Clean terminal output only (no large JSON on screen — results still saved to disk):

```bash
npm run run-debug -- --distributed --repo=./external/redis --quiet-json
```

## Why this matters

- **No cloud LLM API** for core design: local browser execution and peer coordination (see `southstack-p2p/`).
- **Multiple devices** share work: WebRTC mesh + distributed task model.
- **Runs in the browser**: Chrome + WebGPU for on-device models where applicable.
- **Large codebases**: validated on real tree scans (e.g. **300k+ lines** processed in demo runs — see JSON below).
- **Distributed debugging**: analyzer/fixer pipeline with per-peer stats and reproducible JSON output.

## Proof artifacts (sample results)

| Artifact | Purpose |
|----------|---------|
| `southstack-p2p/DISTRIBUTED_DEBUG_DEMO_RESULTS.json` | Full end-to-end run: summary, comparison, scaling |
| `southstack-p2p/BROWSER_AGENTIC_DEBUG_RESULTS.json` | Distributed debugger output on the chosen repo |
| `southstack-p2p/SINGLE_NODE_DEBUG_RESULTS.json` | Single-peer baseline for comparison |
| `southstack-p2p/DISTRIBUTED_CONTEXT_SCALING_RESULTS.json` | File vs function chunking metrics |

## Narrative + 1-minute demo

See **`southstack-p2p/FINAL_DEMO_BRIEF.md`** (pitch, claims, script).

## Recording the demo video (60–90s)

See **`VIDEO_RECORDING.md`**.

## Checklist

- [ ] `npm test` (optional)
- [ ] `npm run run-debug -- --distributed --repo=./external/redis --quiet-json`
- [ ] No crash; table + bars + summary visible
- [ ] Attach or point to `DISTRIBUTED_DEBUG_DEMO_RESULTS.json` for reviewers

## Full project docs

The root `README.md` is a **unified merge** of multiple READMEs. The **canonical runnable app** is **`southstack-p2p/`** (legacy **`southstack/`** + **`southstack-demo/`** APIs are included there). See **`southstack-p2p/README.md`**.
