# UI Builder Stabilization - TODO

## Server files (remove fallback UI)
- [x] `ui-builder/shared/demoLoader.js` — Create demo loader utility
- [x] `ui-builder/server/vision.js` — Remove DEMO_UI_JSON fallback, return `{ ok: false, error }`
- [x] `ui-builder/server/agent.js` — Throw on missing/failed endpoint instead of returning fallback JSON
- [x] `ui-builder/server/builder.js` — Return `null` on invalid input
- [x] `ui-builder/server/api.js` — Remove DEMO_UI fallback, return errors only

## Client files (single source of truth)
- [x] `ui-builder/client/App.jsx` — Use demoLoader, no API fallbacks, direct P2P state set
- [x] `ui-builder/client/components/Renderer.jsx` — Ensure never returns null

## Verification
- [x] Tests pass (21/21 across 5 test files)
- [x] App works without API (demoLoader provides default UI, no API required for manual/demo mode)
- [x] App loads demo UI properly (8 demo UIs available via dropdown)

