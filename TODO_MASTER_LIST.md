# TODO_MASTER_LIST.md

## PRIORITY TASKS (Work in this order)

### Phase 1: Connection
1. [DONE] Create basic HTML page with WebRTC setup for 1 host and 2 clients (logic present in `southstack-p2p/index.html` + `main.js`)
2. [DONE] Implement signaling server using simple HTTP SDP endpoints (`southstack-p2p/serve_with_signal.py`) (verified by `tools/p2p_stability_probe.py`)
3. [ ] Establish P2P connection between host and one client (LOGIC READY, NEEDS REAL TEST)
4. [ ] Extend to connect host with second client (LOGIC READY, NEEDS REAL TEST)
5. [ ] Test multi-peer connection stability (LOGIC READY, NEEDS REAL TEST)
6. [ ] Add TURN server configuration for NAT traversal (READY, NEEDS REAL TEST: optional `window.SOUTHSTACK_TURN` fallback added to ICE config)
7. [ ] Implement/verify explicit ICE candidate exchange path (READY, NEEDS REAL TEST: trickle candidate POST/GET + `addIceCandidate` polling path added)

### Phase 2: Communication
8. [ ] Implement reliable message passing between connected peers (READY, NEEDS REAL TEST)
9. [DONE] Send/receive JSON messages with logging (JSON parse/stringify path present and used)
10. [ ] Handle message acknowledgments (READY, NEEDS REAL TEST: generic `ack` envelope + existing subtask ack/retry path)
11. [DONE] Standardize DataChannel message envelope (`{id,type,payload,timestamp,from,to?}` with malformed message rejection)

### Phase 3: Task Execution
12. [DONE] Define stable task format (`taskId/subtaskId/taskType/stableTaskId` carried in subtask payload)
13. [ ] Distribute simple tasks from host to clients (LOGIC READY, NEEDS REAL TEST)
14. [ ] Execute tasks on clients and return results (LOGIC READY, NEEDS REAL TEST)
15. [DONE] Enforce subtask idempotency on retry (`executedTasks` stable key + cached result fast-return)

### Phase 4: Debugging Agents
16. [DONE] Create analyzer/fixer debugging pipeline (verified via `npm run run-debug -- --distributed --quiet-json`)
17. [DONE] Create fixer agent (verified via `npm run run-debug -- --distributed --quiet-json`)
18. [DONE] Distribute debugging across peers in the toolchain (verified per-peer stats in `southstack-p2p/DISTRIBUTED_DEBUG_DEMO_RESULTS.json`)
19. [DONE] Separate analyzer vs fixer output contracts in WebRTC runtime (analyzer => structured JSON prompt, fixer => code-only prompt)

### Phase 5: Large Codebase
20. [DONE] Load and chunk large codebase in the benchmark/toolchain (context scaling verified, including 500k synthetic lines)
21. [DONE] Distribute chunks across peers in the benchmark/toolchain (verified by distribution efficiency in `DISTRIBUTED_CONTEXT_SCALING_RESULTS.json`)
22. [DONE] Parallel processing optimizations in benchmark/toolchain (verified)

### Engineering follow-ups (likely correctness risks)
23. [DONE] Fix state merge strict version rejection (`mergeIncomingState` now merges fields/subtasks safely; token/checkpoint no longer bump version)
24. [DONE] Fix retry duplication (stable task key + executed-task idempotency guard)
25. [DONE] Fix debug workflow output contract (mode-based analyzer/fixer prompts)

## VERIFICATION REQUIRED

This repo partially verifies “working behavior” here:
- Signaling endpoints verified (`tools/p2p_stability_probe.py`).
- Toolchain debugging + chunking verified (`npm run run-debug -- --distributed`, `distributed_context_scaling.mjs`).

For final WebRTC multi-device verification, test locally with 3 real devices:

1. `cd southstack-p2p && ./start-server.sh` (signaling server running)
2. Open `index.html` in 3 tabs/devices (host + 2 guests)
3. Test P2P connection: “Devices in this room” becomes `3+` and stays stable
4. Test Phase 2/3: Send a shared job that delegates subtasks and confirms returned results appear on the coordinator/host
5. Test Phase 4/5: Run a debug-style prompt and a large-context prompt; confirm delegation and results merge correctly after host/coordinator disconnect
6. Paste console logs if issues found

## STATUS: LOGIC-HARDENED; REAL-DEVICE WEBRTC VERIFICATION STILL REQUIRED
