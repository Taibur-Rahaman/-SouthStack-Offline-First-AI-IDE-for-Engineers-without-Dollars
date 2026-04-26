# SouthStack P2P (unified app)

This folder is the **single** SouthStack browser application. The former **`southstack/`** and **`southstack-demo/`** trees redirect here and their console APIs are implemented in **`main.js`**.

## Run

```bash
python3 serve_with_signal.py
```

Open `http://127.0.0.1:8000` (add `?nosw=1` if assets look stale).

## Features (all variants in one)

| Area | What |
|------|------|
| **P2P** | WebRTC data channels, rooms, coordinator election, shared jobs, checkpoints |
| **WebGPU LLM** | WebLLM via CDN; model list in `CONFIG.modelCandidates` in `main.js` |
| **Legacy `ask()`** | `window.ask("prompt")` — same idea as old **southstack-demo**: user-only message, streamed to console (no coding filter) |
| **`promptCoding()`** | Coding assistant path with system prompt + non-coding filter |
| **`SouthStack` API** | `SouthStack.getSystemStatus()`, `SouthStack.clearRuntimeCaches()`, etc. |

## Tools (repo root)

```bash
npm install
npm run run-debug -- --distributed --quiet-json
```

See also `FINAL_DEMO_BRIEF.md` and `../SUBMISSION_README.md`.
