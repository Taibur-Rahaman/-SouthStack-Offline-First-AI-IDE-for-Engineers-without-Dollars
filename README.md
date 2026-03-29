# CSE 327 — SouthStack workspace

Browser-based **WebGPU LLM** demo (`southstack/`) and **peer-to-peer agentic coding** prototype (`southstack-p2p/`) with WebRTC task sharing—no cloud LLM API for inference.

## Quick links

| What | Where |
|------|--------|
| Run single-browser AI | [`RUN_ON_NEW_PC.md`](RUN_ON_NEW_PC.md) → `southstack/` + `python3 -m http.server 8000` |
| Run P2P + auto invite/QR | `southstack-p2p/` → **`python3 serve_with_signal.py`** (see [`southstack-p2p/README.md`](southstack-p2p/README.md)) |
| Full P2P project documentation (Bangla + English) | [`BROWSER_BASED_P2P_AGENTIC_CODING_SYSTEM.md`](BROWSER_BASED_P2P_AGENTIC_CODING_SYSTEM.md) |
| Instructor / course wording | [`CSE327_FEASIBILITY_BRIEF.md`](CSE327_FEASIBILITY_BRIEF.md) §0 |
| Pre-demo checklist | [`CSE327_DEMO_CHECKLIST.md`](CSE327_DEMO_CHECKLIST.md) |
| Pointer to §0 only | [`CSE327_INSTRUCTOR_PROJECT_STATEMENT.md`](CSE327_INSTRUCTOR_PROJECT_STATEMENT.md) |

## Tests

```bash
npm test
```

Uses Vitest at repo root (not required to run the static web apps).
