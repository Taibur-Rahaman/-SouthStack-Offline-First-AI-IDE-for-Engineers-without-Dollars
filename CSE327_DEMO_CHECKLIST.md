# SouthStack Demo Checklist (CSE327)

Use this before class demo to reduce failures.

## New user quick run (before checklist)

If someone is running the project for the first time:

```bash
cd southstack-p2p
python3 serve_with_signal.py
```

Windows:

```bash
cd southstack-p2p
py -3 serve_with_signal.py
```

Then host opens `http://127.0.0.1:8000`, clicks **Start session — show link & QR**, and guest joins from same Wi-Fi via invite/QR.
Use `?nosw=1` once if stale UI is shown.

**Repo / docs (already aligned in this workspace):** root [`README.md`](README.md), [`RUN_ON_NEW_PC.md`](RUN_ON_NEW_PC.md), [`southstack-p2p/README.md`](southstack-p2p/README.md), and [`CSE327_FEASIBILITY_BRIEF.md`](CSE327_FEASIBILITY_BRIEF.md) §0 describe **`serve_with_signal.py`**, QR/invite flow, and instructor wording. **`npm test`** passes at repo root.

The boxes below are **your** pre-flight checks on a machine—not something the repo can tick for you.

## 1) Pre-Demo Setup (Night Before)

- [ ] Pull latest repo on demo machine.
- [ ] Open Chrome and enable WebGPU flag if needed.
- [ ] Run `southstack` once and wait for model cache progress to complete.
- [ ] Refresh and confirm warm start is faster than cold start.
- [ ] Run `southstack-p2p` with `serve_with_signal.py` and confirm two tabs or two devices can connect (invite link or QR).
- [ ] Verify no blocking console errors on startup.

## 2) Day-of Demo Commands

### Single-node AI mode

```bash
cd southstack
python3 -m http.server 8000 --bind 127.0.0.1
```

Open: `http://localhost:8000/?v=7`

### P2P multi-laptop mode (use signaling server)

```bash
cd southstack-p2p
python3 serve_with_signal.py
```

Default port **8000** (or `PORT=8001 python3 serve_with_signal.py` to match your URL).  
Host opens: `http://<HOST_LAN_IP>:8000` → **Start session — show link & QR**.  
Joiners scan QR or open the invite link on **same Wi‑Fi** (not `localhost` on the phone).

**Do not** use plain `python3 -m http.server` for cross-device auto-join—there is no `/api/southstack/` signaling.

## 3) Live Demo Flow (Suggested)

1. Show **offline-first** claim:
   - Mention first load downloads model shards.
   - Mention warm reload uses cached artifacts.
2. Show **chat-to-code**:
   - Enter prompt in UI.
   - Display generated answer in response box and console output.
3. Show **P2P collaboration**:
   - Create room on host.
   - Join from second tab/laptop.
   - Delegate one simple coding task and show peer count/state updates.
4. Show **fault tolerance**:
   - Close one peer tab and show leader re-election / continued state.

## 4) Fast Troubleshooting

### Ask button disabled
- Wait for model init to finish.
- Check Console Output for model loading progress.
- Hard refresh with cache-bust URL (`?v=7`).

### Model fails to initialize
- Confirm WebGPU availability in Chrome.
- Verify machine has enough free memory.
- Clear cache then retry first load.

### P2P peers not connecting
- Ensure same Room ID on all peers.
- Use manual Offer/Answer fallback if auto-share is unavailable.
- Confirm same LAN and no restrictive firewall policy.

### Old code still running
- Clear cache.
- Refresh with cache-bust query.
- Restart local server.

## 5) Backup Plan (If Live AI Fails)

- [ ] Show previously cached warm-start logs.
- [ ] Run a reduced prompt with smaller token budget.
- [ ] Fall back to P2P coordination demo without generation.
- [ ] Explain clear next steps and known constraints transparently.

## 6) Talking Points for Grading

- Local inference in browser (no API key).
- Offline-first architecture (PWA + local persistence).
- Zero-cost scaling concept (client hardware does compute).
- Multi-peer collaboration via WebRTC + leader election.
- Honest limitations and roadmap for in-browser runtime engine.
