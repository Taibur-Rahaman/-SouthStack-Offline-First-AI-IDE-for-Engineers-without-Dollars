# SouthStack (legacy folder)

**This standalone UI has been merged into [`../southstack-p2p/`](../southstack-p2p/).**

Opening [`index.html`](index.html) redirects to the unified app, which includes:

- All **P2P / WebRTC** features (`serve_with_signal.py`, rooms, coordinator)
- **Legacy console API** from this tree: `window.ask()`, `SouthStack.clearRuntimeCaches()`, `SouthStack.getSystemStatus()`, etc. (see `southstack-p2p/main.js`)

The previous `main.js` here is kept as a stub for reference; do not use for new work.
