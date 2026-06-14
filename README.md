# SouthStack — Offline-First AI IDE for Engineers without Dollars

Browser-based, peer-to-peer coding assistant that runs **small LLMs locally via WebGPU** — no cloud API keys, no subscription. Devices on the same network collaborate over WebRTC to plan, delegate, and merge coding tasks.

## Overview

SouthStack (P2P Agentic Coding) targets engineers who need AI-assisted development without paying for cloud LLM APIs. Multiple devices share inference load: one coordinator runs WebLLM on WebGPU while peers exchange task plans and code over encrypted data channels.

## Key Features

- **Offline-first** — WebGPU + WebLLM in the browser; no OpenAI/Anthropic dependency
- **Peer-to-peer** — WebRTC data channels for shared jobs across LAN devices
- **Multi-device** — Automatic network discovery, QR codes, mDNS (`southstack-PORT.local`)
- **Cross-platform** — Windows, macOS, Linux, Android, iOS browsers
- **Coordinator election** — WebGPU-capable device leads inference; others contribute
- **Unified app** — Single browser app in `southstack-p2p/` (legacy folders redirect here)

## Quick Start

```bash
git clone https://github.com/Taibur-Rahaman/-SouthStack-Offline-First-AI-IDE-for-Engineers-without-Dollars.git
cd -SouthStack-Offline-First-AI-IDE-for-Engineers-without-Dollars

npm start
```

This starts the universal server with network discovery and QR code generation. Open the URL shown in the terminal (usually `http://localhost:8000`). On other devices on the same Wi-Fi, use the displayed LAN IP.

### Manual start (P2P app)

```bash
cd southstack-p2p
python3 serve_with_signal.py
```

## Documentation

| Document | Purpose |
|----------|---------|
| [SUBMISSION_README.md](./SUBMISSION_README.md) | Grader quick-run guide, proof paths, demo claims |
| [VIDEO_RECORDING.md](./VIDEO_RECORDING.md) | 60–90s demo video instructions |
| [TODO_MASTER_LIST.md](./TODO_MASTER_LIST.md) | Task checklist and project status |
| [southstack-p2p/FINAL_DEMO_BRIEF.md](./southstack-p2p/FINAL_DEMO_BRIEF.md) | Demo script and feature claims |
| [docs/](./docs/) | Additional architecture and setup notes |

## Project Structure

```
├── southstack-p2p/       # Main P2P + WebGPU application
├── southstack/           # Redirects to southstack-p2p
├── southstack-demo/      # Redirects to southstack-p2p
├── Demo_Ui/              # UI builder demos
├── autonomy/             # Autonomy subsystem
├── evolution/            # Evolution/experiment modules
├── infra/                # Infrastructure configs
├── p2p-agentic/          # Agentic P2P modules
├── p2p-bridge/           # Bridge utilities
└── docs/                 # Extended documentation
```

## Tech Stack

- **Frontend:** JavaScript, WebGPU, WebLLM, WebRTC
- **Server:** Node.js / Python signaling server
- **Networking:** mDNS, QR-based pairing, LAN discovery

## Submission & Evaluation

For academic submission or grading, start with **[SUBMISSION_README.md](./SUBMISSION_README.md)** — it covers the one-command distributed demo, proof JSON paths, and evaluation criteria.

## Author

**Md Taibur Rahaman** — [GitHub](https://github.com/Taibur-Rahaman)

## License

See repository license files.
