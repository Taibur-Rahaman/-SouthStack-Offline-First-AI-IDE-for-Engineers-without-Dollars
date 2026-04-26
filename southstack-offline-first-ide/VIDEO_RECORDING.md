# Record a 60–90 second demo video

This repo cannot record video for you. Use one of these on your machine:

## macOS (built-in)

1. **QuickTime Player** → File → New Screen Recording → select region → Record.
2. Run in Terminal (from repo root):

   ```bash
   npm run run-debug -- --distributed --repo=./external/redis --quiet-json
   ```

3. Show on screen: peer table → workload bars → summary lines → speedup lines.
4. Stop recording → export as `.mov` or upload to your course platform.

## Cross-platform (OBS)

1. Install [OBS Studio](https://obsproject.com/).
2. Add **Display Capture** or **Window Capture** (Terminal).
3. Start recording → run the same command → stop → export MP4.

## What to say (under 90 seconds)

1. “Three devices connect in the browser over P2P; no cloud LLM API for this flow.”
2. “We run one command on a real codebase — Redis in `external/redis`.”
3. Point at the **peer table** and **bars**, then **summary** and **estimated parallel speedup**.
4. “Proof is in `southstack-p2p/DISTRIBUTED_DEBUG_DEMO_RESULTS.json`.”
