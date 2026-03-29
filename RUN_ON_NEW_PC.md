# How to Run SouthStack on a New PC

Follow these steps on any new computer.

## 1. Get the code

```bash
git clone https://github.com/Taibur-Rahaman/-SouthStack-Offline-First-AI-IDE-for-Engineers-without-Dollars.git
cd -SouthStack-Offline-First-AI-IDE-for-Engineers-without-Dollars
```

## 2. Use Google Chrome

- Install [Google Chrome](https://www.google.com/chrome/) (latest).
- Enable WebGPU: open `chrome://flags/#enable-unsafe-webgpu` → set to **Enabled** → **Relaunch**.

## 3. Start the app (no install needed)

From the project root, serve the **southstack** folder:

**Option A – Python (usually already on Mac/Linux):**
```bash
cd southstack
python3 -m http.server 8000
```

**Option B – Python on Windows:**
```bash
cd southstack
py -m http.server 8000
```

**Option C – Node.js:**
```bash
cd southstack
npx http-server -p 8000
```

If port 8000 is in use, use another (e.g. 8080): `python3 -m http.server 8080` and open `http://localhost:8080/` instead.

## 4. Open in Chrome

1. In Chrome go to: **http://localhost:8000/?v=6**
2. Press **F12** (or Cmd+Option+I on Mac) → open the **Console** tab.
3. Wait for the model to load (first time it downloads ~500MB–1GB; progress in console).
4. When you see the model ready, type in the console:
   ```javascript
   ask("Write a hello world in Python")
   ```

## 5. Optional: P2P multi-laptop / phone (recommended path)

Plain `python3 -m http.server` **does not** provide WebRTC signaling; two devices will need manual SDP copy/paste. For **QR / invite link / auto-join**, use the signaling server:

```bash
cd southstack-p2p
python3 serve_with_signal.py
```

- Listens on **port 8000** by default (`0.0.0.0`). Use another port: `PORT=8001 python3 serve_with_signal.py`.
- **Host:** open `http://<HOST_LAN_IP>:8000` (or your `PORT`), click **Start session — show link & QR**.
- **Guest:** same Wi‑Fi, open the invite URL or scan QR (must show your PC’s **LAN IP**, not `localhost`).
- If a device shows stale cache: add **`?nosw=1`** to the URL once.

Fallback (no signaling API): `python3 -m http.server 8000` in `southstack-p2p` and use **Advanced → manual WebRTC text** to paste offer/answer between devices.

## Quick reference

| Step            | Command / action |
|-----------------|------------------|
| Clone           | `git clone https://github.com/Taibur-Rahaman/-SouthStack-Offline-First-AI-IDE-for-Engineers-without-Dollars.git` |
| Single AI app   | `cd southstack` → `python3 -m http.server 8000` → http://localhost:8000/?v=6 |
| P2P + QR/invite | `cd southstack-p2p` → **`python3 serve_with_signal.py`** → **Start session** on host |
| Course docs     | `CSE327_FEASIBILITY_BRIEF.md`, `CSE327_DEMO_CHECKLIST.md` |

**Requirements:** Chrome with WebGPU enabled, 6GB+ RAM recommended, ~1GB free disk for the model. No Node/Python packages to install for the app itself (Python is only used to run the local file server / signaling script).
