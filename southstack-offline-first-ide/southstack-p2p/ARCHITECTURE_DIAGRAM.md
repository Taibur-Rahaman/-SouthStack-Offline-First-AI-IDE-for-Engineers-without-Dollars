# SouthStack P2P Architecture Diagram

```mermaid
flowchart LR
    U[User CLI in Browser] --> H[Host Coordinator]
    H --> A[Agent Workflow Layer]
    A --> M[Model Layer WebGPU Small LLM]
    A --> S[Scheduler and Context Router]
    H --> N[P2P Networking Layer WebRTC]
    N --> P1[Peer Device 1]
    N --> P2[Peer Device 2]
    N --> P3[Peer Device N]
    P1 --> R[Result and Debug Merge]
    P2 --> R
    P3 --> R
    R --> H
    H --> DB[IndexedDB State and Recovery]
```

## Protocol and Reliability

- Structured messages: task assign, ack, result, heartbeat, reassignment
- Retry and timeout handling for dropped packets
- Idempotency using message IDs and duplicate suppression
- Auto-reconnect flow with backoff when link is lost

## Security and Privacy

- Session auth token is attached to invite and handshake
- Leader-only authorization for state and task control messages
- Transport uses browser WebRTC secure channels
- Local-only validation report: `LOCAL_DATA_HANDLING_RESULTS.json`
