# ui-builder-p2p — Final architecture map

Production-hardened view of the real-time stack: transport, shared state, awareness, blobs, and recovery.

## Single sources of truth

| Domain | Canonical source | Notes |
|--------|------------------|--------|
| Document (pages, elements, audio meta, proposals) | **Yjs `Y.Doc`** | All peers converge on CRDT merges. Remote updates apply with `ORIGIN_REMOTE` (`p2p-remote`). |
| Ephemeral cursors / selection / names | **y-protocols `Awareness`** on the same doc | Serialized over JSON `presence-update` only. |
| Peer list in the UI | **Derived** | `mirrorAwarenessToYjsPresence` writes the `presence` **Y.Map** with `ORIGIN_PRESENCE_MIRROR` — local mirror for rendering and IndexedDB durability; **not** re-broadcast on the mesh (avoids duplicating awareness on the wire). |
| Large binary assets | **Chunk protocol** (`chunk-start` / `chunk-part` / `chunk-end`, optional `chunk-ack`) | Small payloads use legacy `blob-response`. |
| Transport | **WebRTC data channels** only | Signaling WebSocket carries SDP/ICE only — no app state. |

## Event flow (text diagram)

```
Signaling WS                    WebRTC mesh
(join / signal)                 (binary + JSON frames)
       │                              │
       ▼                              ▼
 ensurePeer / RTC negotiate    parseTaggedFrame (frameCodec)
       │                              │
       │                    ┌──────────┴──────────┐
       │                    │                     │
       │             binary-yjs              json envelope
       │                    │                     │
       │                    ▼                     ▼
       │           decodeYjsWirePayload    parseValidateJsonEnvelopeStrict
       │           epoch guard              ├─ presence-update → awareness
       │                    │              ├─ chunk-* → ChunkReassemblyHub / ACK
       │                    ▼              └─ blob-request/response → cache
       │           Y.applyUpdate(doc, · , ORIGIN_REMOTE)
       │                    │
       └────────────────────┴──► Local Y.Doc update → y-indexeddb persistence

Local edits: doc.on('update') → YjsOutboundBatcher → encodeYjsWirePayload → binary frame to all open DCs.
Awareness (non-P2P origin): awareness.on('update') → debounced JSON presence-update.

UI: React reads Yjs structures; `tick` driven by doc + awareness-driven mirror — no duplicate awareness listeners.
```

## Module responsibilities

| Area | Responsibility |
|------|----------------|
| `p2p/WebRTCMesh.ts` | Peer connections, epoch tagging, wire sync (`sendWireSyncOnChannel`), chunk hub + ACK sessions, JSON/binary dispatch |
| `p2p/frameCodec.ts` | Magic-tagged frames (`YJ`, JSON) |
| `p2p/yjsWireEpoch.ts` | Versioned binary Yjs payload (`YJE1` + epoch) |
| `p2p/yjsSendScheduler.ts` | Adaptive batching of outbound Yjs updates |
| `crdt/yjsDocument.ts` | Schema, `ORIGIN_*` constants including presence mirror |
| `crdt/awarenessCollaboration.ts` | Awareness helpers, wire versions, mirror + stale presence removal |
| `audio/chunkedBlobTransfer.ts` | Receive reassembly, non-ACK bulk send, timeouts |
| `audio/chunkedBlobTransferAck.ts` | Sliding-window ACK send path |
| `persistence/uiBuilderPersistence.ts` | y-indexeddb + awareness snapshot store |
| `builder/BuilderWorkspace.tsx` | Binds mesh, awareness, cache — minimal event subscriptions |

## Failure recovery paths

| Scenario | Path |
|----------|------|
| ICE trouble | `scheduleIceRestart` → `restartIce` + re-offer |
| Data channel closed | `onPeerTransportGone` (prune chunk state) → delayed `tryReconnectDataChannel` (new PC, same peer id) → `onopen` runs `sendWireSyncOnChannel` |
| Peer left room | `teardownPeer` → transport cleanup + PC close |
| Chunk receiver stalls | Session timeout in `ChunkReassemblyHub`; sender ACK window drained via `handlePeerDisconnected` on disconnect |
| Epoch stale traffic | `shouldDropBinaryEpoch` / `shouldDropJsonEpoch` drop out-of-date wire |

## Performance-critical paths

- **Yjs outbound**: `YjsOutboundBatcher` merges updates before DC send; adaptive delay between flushes.
- **Awareness**: 50 ms debounce + binary dedupe before `presence-update` broadcast.
- **Chunks**: ACK window caps in-flight indices; receiver fires ACK after part stored.

## Debug-only invariants

With `VITE_DEBUG_MODE` / `DEBUG_MODE` true, `observability/debugInvariants.ts` logs non-fatal warnings for epoch / chunk-index sanity — **never throws** in production.
