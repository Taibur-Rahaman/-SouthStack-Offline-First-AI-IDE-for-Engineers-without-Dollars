# The Great CSE 327 Project: Feasibility Brief

Project: **SouthStack** (offline-first AI IDE in the browser)  
Prepared for: **Dr. Nabeel Mohammed**  
Scope: Local findings from this codebase and runtime tests (no external web research in this draft).

## 0) Instructor / course project statement

**One-line description (course ask):** Using small language models that run in the browser via **WebGPU**, we are building a **peer-to-peer agentic coding** system where **multiple laptops** connect over the network and **share the work** of a coding task (plan → delegate subtasks → merge), **without** sending prompts or generated code through a **central cloud API**.

**What this maps to in the notes**

| Note | Project meaning |
|------|------------------|
| Browser version of CLI | Tab-based workflow: prompt in, structured agent steps out—no separate desktop CLI required. |
| Offline, agentic | Plan/delegate/merge; offline after model/JS cache; first run needs network for downloads. |
| Reasonable runtime | Small quantized models (sub‑2B class), WebGPU, timeouts/fallbacks. |
| P2P / share capacity | Each peer may run a local LLM; leader assigns subtasks across connected browsers. |
| Fault-tolerant | Leader election, state sync, IndexedDB checkpoints; graceful degradation when a peer drops. |
| No server for *task* data | Prompts and shared coding traffic over **WebRTC data channels**; optional **LAN-only** HTTP is for **SDP signaling** only—not LLM inference. |
| “No API” constraint | **No cloud LLM API**; inference stays in-browser. |

**Demo scope:** Two or more browsers on the same LAN; static files + optional `serve_with_signal.py` for auto SDP; host starts a **shared job**, guests participate. **Code anchor:** `southstack-p2p/`.

**Security / robustness (honest):** Room/invite links are weak shared secrets; leader vs guest roles are client-side; reconnect after tab close; checkpoints help the same profile after refresh—**not** production-grade auth.

**Open Q — close browser and restart?** Live WebRTC session ends; other peers see disconnect; restarted machine reopens page and **re-joins** the room; local checkpoints may restore **local** history on the same browser profile.

**Paper summary line:** Browser-based, offline-capable, **P2P agentic coding** pooling **small WebGPU LLMs** across devices **without** a central cloud API for the coding task.

---

## 1) Executive Summary

The project is feasible in staged form:

1. **Local AI in browser (WebGPU)** is working in this repo with WebLLM and downloadable model weights.
2. **Peer-to-peer coordination** is feasible and already prototyped via WebRTC DataChannels (`southstack-p2p`).
3. **Offline-first shell** is feasible through PWA/service worker + IndexedDB checkpoints.
4. **Full in-browser full-stack runtime (WebContainers-equivalent)** is not yet implemented in this repo and is the largest remaining engineering gap.

## 2) Current Technical Floor in This Repository

### 2.1 WebLLM / Browser LLMs

- `southstack/main.js` initializes WebLLM via dynamic ESM import and calls `CreateMLCEngine(...)`.
- Model download and cache population are observable in runtime logs (progress and parameter cache fetches).
- `window.ask(prompt)` is wired for streaming chat completions and UI response display.
- Fallback behavior is implemented for model-load failures and memory pressure.

**Assessment:** Feasible on WebGPU-capable Chrome devices, with first-run download latency as expected.

### 2.2 Multi-Laptop Agentic Flow (P2P)

- `southstack-p2p/main.js` implements:
  - WebRTC DataChannel transport
  - shared state replication
  - checkpointing in IndexedDB
  - deterministic leader election (lowest peer ID)
  - subtask delegation and result merge
- Manual SDP exchange exists, plus **`serve_with_signal.py`** (LAN) for automatic offer/answer exchange when demos need two devices without copy/paste.

**Assessment:** Feasible as a distributed, browser-only coordination model with no central backend.

### 2.3 Offline-First Architecture

- `southstack/service-worker.js` and `southstack-p2p/sw.js` provide offline caching behavior.
- IndexedDB is used for task/checkpoint persistence in P2P mode.

**Assessment:** Feasible for app shell and state persistence; model-cache resilience on flaky networks still needs hardening.

### 2.4 In-Browser Runtime (WebContainers-equivalent)

- No production-grade WebContainers integration is present yet in this repo.
- Existing code does not yet run Node/Python/Go servers in an isolated browser runtime.

**Assessment:** This is still an open milestone, not solved by current code.

## 3) Part A: Required Feasibility Questions

### A1) WebLLM / Transformers.js with coder models

Status in repo:
- WebLLM path is implemented and runs in-browser.
- Model selection must match available prebuilt model IDs for the selected WebLLM build.

What is still needed:
- A benchmark matrix in this repo (tokens/s, RAM footprint, first-load time, warm-load time).
- A model tiering policy (high, medium, low-end hardware).
- Graceful fallback behavior when WebGPU is unavailable.

### A2) WebContainers API offline behavior

Status in repo:
- Not yet integrated in this codebase.

What is still needed:
- A minimal proof (React starter + Express starter) with offline re-open after first load.
- Runtime limits doc (memory caps, fs behavior, package install strategy).

### A3) Chrome Prompt API / Gemini Nano viability

Status in repo:
- Not integrated yet.

What is still needed:
- Feature detection and fallback decision tree:
  1) Prompt API available -> use local built-in model path
  2) else WebLLM + WebGPU
  3) else offline limited mode (no AI generation)

## 4) Additional Engineering Challenges (and Solution Paths)

1. **Model catalog drift**
   - Problem: model IDs vary by WebLLM version.
   - Path: lock WebLLM version + validated model IDs in one config source.

2. **Long first-load downloads**
   - Problem: flaky networks can stall model fetches.
   - Path: resumable fetch strategy, progress checkpoints, explicit retry UI.

3. **Service worker stale assets**
   - Problem: old JS can persist after fixes.
   - Path: versioned cache names + network-first for critical app shell files.

4. **Cross-device signaling UX**
   - Problem: manual SDP copy is error-prone.
   - Path: optional lightweight signaling relay (free-tier) while keeping LAN/manual fallback.

5. **Memory contention with runtime + model**
   - Problem: model + tooling can exceed RAM on low-end laptops.
   - Path: model tiering, token limits, worker isolation, kill/restart controls.

6. **Observability in offline mode**
   - Problem: debugging is harder without cloud logs.
   - Path: local diagnostic panel with persisted session traces and export.

## 5) Part B: Questions to Ask the Client (Dr. Nabeel)

1. **Priority order:** Is the MVP priority AI-first editor, or full-stack runtime parity first?
2. **Acceptable first-run latency:** What initial download time is acceptable in grading/demo context?
3. **Target hardware floor:** What is the minimum RAM/GPU class we must support?
4. **Offline definition:** Must all AI and runtime features work fully offline, or can some degrade?
5. **P2P scope:** Is manual room-based collaboration enough for MVP, or must it be near-zero-click?
6. **Language/runtime scope for MVP:** Node only first, or Node + Python + Go from day one?
7. **Security boundary expectations:** Any sandboxing/policy requirements for student-submitted code?
8. **Evaluation rubric:** Which metrics matter most (latency, reliability, UX, feature breadth)?
9. **Dataset/privacy constraints:** Any rules for caching generated code or local prompts?
10. **Demo constraints:** Must the class demo run without internet after one warmup?

## 6) Recommended Next Milestones

1. Lock model/version matrix and ship a reproducible benchmark script.
2. Add capability detector + fallback tree (Prompt API, WebLLM, no-AI mode).
3. Harden P2P onboarding UX (auto status, copy helpers, error guidance).
4. Build minimal in-browser runtime proof (single language first).
5. Run end-to-end offline demo rehearsal and record failure playbook.

**Status in this repo (snapshot):** (3) is **partially** addressed in `southstack-p2p` (invite/QR auto-join, `serve_with_signal.py`, guest UI, `?nosw=1`, LAN hints). (1), (2), (4) remain **open**. (5) is a **manual** rehearsal tracked in `CSE327_DEMO_CHECKLIST.md`.
