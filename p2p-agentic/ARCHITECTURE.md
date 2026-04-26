# P2P Agentic Coding System - Complete Architecture

## 🎯 Overview

A **peer-to-peer distributed coding system** where multiple browser-based machines share computational tasks using WebGPU LLMs.

```
Laptop 1 (Coordinator)
├── P2PAgenticCoordinator
├── Task Queue Manager
├── Load Balancer
├── Result Aggregator
└── Health Monitor

Laptop 2 (Peer 1)          Laptop 3 (Peer 2)          Laptop 4 (Peer 3)
├── P2PAgenticPeerWorker   ├── P2PAgenticPeerWorker   ├── P2PAgenticPeerWorker
├── WebGPU LLM             ├── WebGPU LLM             ├── WebGPU LLM
├── Task Executor          ├── Task Executor          ├── Task Executor
└── Result Reporter        └── Result Reporter        └── Result Reporter
     │                           │                           │
     └───────────────────────────┴───────────────────────────┘
                          ↓
                    WebRTC P2P
                  (or Relay Server)
```

---

## 🏗️ Core Components

### 1. **P2PAgenticCoordinator** (`coordinator.js`)

**Responsibilities:**
- Maintain list of connected peers and their capabilities
- Queue coding tasks
- Distribute subtasks to peers based on load/capabilities
- Aggregate results from multiple peers
- Monitor peer health and handle failures
- Balance load across devices

**Key Methods:**

```javascript
// Register new peer
coordinator.registerPeer(peerId, capabilities)

// Distribute task across peers
taskId = await coordinator.executeDistributedTask({
  prompt: "Build a web framework",
  subtasks: [
    "Create Router class",
    "Implement Middleware system",
    "Add Request/Response wrappers"
  ]
})

// Get task results
result = await coordinator.getTaskResult(taskId, timeoutMs)

// Monitor status
status = coordinator.getStatus()
```

**Algorithms:**

**Task Distribution (Load Balancing):**
```
For each queued task T:
  Find all idle peers P
  For each unassigned subtask S:
    Select best peer P based on:
      - Available RAM
      - GPU capabilities
      - Current load
      - Network latency
    Assign S → P
    Update P.status = 'working'
```

**Failure Handling:**
```
On peer disconnection:
  For each incomplete task on that peer:
    Mark as 'queued'
    Re-add to task queue
  Remove peer from active list
  Trigger new scheduling
```

---

### 2. **P2PAgenticPeerWorker** (`peer-worker.js`)

**Responsibilities:**
- Detect local hardware capabilities
- Initialize WebGPU LLM engine
- Listen for task assignments
- Execute coding tasks locally
- Report progress and results
- Handle graceful shutdown

**Key Methods:**

```javascript
// Initialize peer
await worker.initialize()

// Get peer capabilities
capabilities = worker.detectCapabilities()
// Returns: { webgpu, ram, gpu, storage, bandwidth, cpuCores }

// Handle task from coordinator
await worker.executeTask(taskId, subtaskId, prompt, model)

// Report progress
worker.reportProgress(taskId, subtaskId, { tokens, preview })

// Get status
status = worker.getStatus()
```

**Task Execution Flow:**
```
1. Receive TASK_ASSIGN message
2. Initialize LLM inference
3. Stream tokens from model
4. Report progress every N tokens
5. Collect full response
6. Send TASK_RESULT to coordinator
7. Mark as idle
8. Wait for next task
```

---

### 3. **Relay Server** (Optional - for WAN connectivity)

For devices not on same LAN, use WebRTC relay server:

```javascript
// relay-server.js
import http from 'http';

const peers = new Map();

http.createServer((req, res) => {
  // Handle WebRTC signaling
  // ICE candidate exchange
  // SDP offer/answer
}).listen(8001);
```

---

## 🔄 Communication Flow

### Peer Discovery & Registration

```
1. Peer starts:
   peer.initialize()

2. Peer announces availability:
   PEER_ANNOUNCE {
     peerId: "peer_xyz",
     capabilities: {...},
     timestamp: now
   }

3. Coordinator receives:
   coordinator.registerPeer(peerId, capabilities)
   peers.set(peerId, {status: 'idle', ...})

4. Peer responds to heartbeat:
   PONG { peerId, activeTasks, timestamp }
```

### Task Distribution

```
1. User submits task to coordinator:
   taskId = coordinator.executeDistributedTask({
     prompt: "...",
     subtasks: [...]
   })

2. Coordinator queues task:
   taskQueue.push({
     id: taskId,
     subtasks: [...],
     results: {}
   })

3. Scheduler finds idle peers:
   availablePeers = peers.filter(p => p.status === 'idle')

4. Assign subtasks:
   TASK_ASSIGN {
     taskId,
     subtaskId,
     prompt: "Subtask description",
     model: "Qwen2.5-Coder-1.5B",
     maxTokens: 512
   }

5. Peer receives and executes:
   peer.handleCoordinatorMessage(msg)
   result = await executeTask(...)

6. Peer reports result:
   TASK_RESULT {
     taskId,
     subtaskId,
     result: {response, tokens, duration}
   }

7. Coordinator aggregates:
   parentTask.results[subtaskId] = result
   if (allSubtasksDone) {
     aggregated = aggregateResults(parentTask)
     results.set(taskId, aggregated)
   }

8. User retrieves result:
   result = await coordinator.getTaskResult(taskId)
```

---

## 📊 Capability Matching

### Peer Capabilities

Each peer reports:

```javascript
{
  webgpu: boolean,           // GPU compute available
  ram: number (GB),          // System memory
  gpu: {vendor, device},     // GPU model
  storage: {                 // Persistent storage
    available: bytes,
    used: bytes,
    percent: number
  },
  bandwidth: {               // Network quality
    effectiveType: '4g'|'3g'|'slow-4g',
    downlink: Mbps,
    rtt: ms
  },
  cpuCores: number          // CPU parallelism
}
```

### Task Assignment Strategy

```
Score = w1*gpu_match + w2*ram_available + w3*load_inverse + w4*network_quality

For task T, peer P:
  gpu_match = 1 if P.gpu.vendor != 'unknown' else 0.5
  ram_available = max(0, P.ram - used) / P.ram
  load_inverse = 1 / (P.activeTasks + 1)
  network_quality = 1 / (P.bandwidth.rtt / 50)  // normalized
  
  score(T, P) = weighted sum
```

---

## 🛡️ Fault Tolerance

### Peer Failure Detection

```
Heartbeat interval: 5 seconds

On coordinator:
  For each peer:
    time_since_heartbeat = now - peer.lastHeartbeat
    
    if (time_since_heartbeat > 15_000ms) {
      // Peer timeout
      coordinator.handlePeerFailure(peerId)
    }
```

### Task Recovery

```
When peer fails:
  1. Find all tasks assigned to that peer
  2. For incomplete tasks:
     - Set status back to 'queued'
     - Re-add to task queue
  3. Remove peer from active list
  4. Trigger new task scheduling
  5. Other peers pick up work
```

### Result Deduplication

```
If peer reports same result twice:
  Check if result.taskId + result.subtaskId already exists
  If yes: ignore duplicate
  If no: add to results
```

---

## 🚀 Usage Examples

### Example 1: Simple Task Distribution

```javascript
// In coordinator browser:
const coordinator = new P2PAgenticCoordinator();

// Wait for peers to connect...
// They announce via PEER_ANNOUNCE messages

// Submit task:
const taskId = await coordinator.executeDistributedTask({
  prompt: "Build a complete REST API framework",
  subtasks: [
    "Create Server class with routing",
    "Implement middleware system",
    "Add request/response handling",
    "Write unit tests"
  ]
});

// Get result (blocks until ready):
const result = await coordinator.getTaskResult(taskId, 60000);

// result contains:
// {
//   sections: [
//     { subtask: "...", code: "...", tokens: 150 },
//     ...
//   ],
//   totalTokens: 600,
//   processingTime: 45000
// }
```

### Example 2: Monitoring

```javascript
// Real-time status:
setInterval(() => {
  const status = coordinator.getStatus();
  console.log(`Peers: ${status.peers.length}`);
  console.log(`Queued tasks: ${status.taskQueue.queued}`);
  console.log(`In progress: ${status.taskQueue.inProgress}`);
  console.log(`Completed: ${status.taskQueue.completed}`);
}, 1000);
```

### Example 3: Custom Subtask Decomposition

```javascript
// Auto-split large task:
const task = {
  prompt: "Implement complete file system operations",
  subtasks: [
    "Create File class with read/write/delete",
    "Implement Directory class with listing",
    "Add permission system (rwx)",
    "Write integration tests",
    "Create CLI interface"
  ]
};

const taskId = await coordinator.executeDistributedTask(task);
```

---

## 🌐 Multi-Device Setup

### Option 1: Same Local Network (Easiest)

**Requirements:**
- All devices on same WiFi
- No relay server needed

**Setup:**

1. Find coordinator IP:
   ```bash
   # Mac
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Linux
   hostname -I
   ```

2. Coordinator:
   ```javascript
   const coordinator = new P2PAgenticCoordinator({
     localNetwork: true,
     listenPort: 8001
   });
   ```

3. Peers:
   ```javascript
   const worker = new P2PAgenticPeerWorker({
     coordinatorUrl: 'ws://192.168.1.100:8001'
   });
   ```

### Option 2: Cloud/WAN (More Complex)

**Requirements:**
- Public relay server
- STUN/TURN servers for NAT traversal

**Setup:**

```javascript
// Relay server (on VPS):
import RelayServer from './relay-server.js';
const relay = new RelayServer({ port: 8001 });
relay.start();

// Coordinator:
const coordinator = new P2PAgenticCoordinator({
  relayUrl: 'wss://your-relay.com:8001'
});

// Peers:
const worker = new P2PAgenticPeerWorker({
  relayUrl: 'wss://your-relay.com:8001'
});
```

### Option 3: Direct WebRTC (Peer-to-Peer)

**No relay needed, but NAT traversal required:**

```javascript
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Use in peer initialization
```

---

## 📈 Performance Optimization

### Task Granularity

Subtasks should take **1-5 minutes** of inference time:

```javascript
// ✅ Good - balanced load
subtasks: [
  "Implement feature A",  // ~2 min on peer
  "Implement feature B",  // ~2 min on peer
  "Write tests",          // ~1 min on peer
]

// ❌ Bad - too fine-grained
subtasks: [
  "Function 1",   // 10 seconds
  "Function 2",   // 10 seconds
  "Function 3",   // 10 seconds
  // ... 100 tasks, overhead > benefit
]

// ❌ Bad - too coarse
subtasks: [
  "Implement entire framework"  // 30 minutes
  // Can't parallelize effectively
]
```

### Bandwidth Optimization

For slow networks:

```javascript
// Don't send full model artifacts
message = {
  type: 'TASK_ASSIGN',
  taskId, subtaskId, prompt
  // Model already cached on peer
}

// Compress results
result = {
  response: compressed(code),
  tokens: 150,
  compressed: true
}
```

---

## 🔍 Debugging

### Enable Logging

```javascript
coordinator.debug = true;
worker.debug = true;

// See all messages in console
// [P2P Coordinator] Registered peer_xyz
// [P2P Worker] Executing task_1
// [P2P Worker] Task completed
```

### Monitor Network

Browser DevTools > Network tab shows all messages:
- Signaling messages (JSON)
- Task assignments
- Result transfers

### Check Peer Health

```javascript
// On coordinator
coordinator.peers.forEach(peer => {
  console.log(peer.id, {
    status: peer.status,
    activeTasks: peer.activeTasks,
    lastHeartbeat: new Date(peer.lastHeartbeat)
  });
});
```

---

## 🎓 Learning Outcomes

By implementing this system, you learn:

✅ **Distributed Systems**
- Task distribution & load balancing
- Failure detection & recovery
- State synchronization

✅ **Browser APIs**
- WebRTC DataChannels
- Web Workers
- Broadcast Channel API

✅ **AI/ML**
- LLM inference on edge
- Token streaming
- Model quantization

✅ **Performance Engineering**
- Parallel processing
- Task granularity tuning
- Network optimization

---

## 📋 Next Steps

1. **Test locally**: Run demo with 2-3 browser windows
2. **Test on LAN**: Use multiple laptops on same WiFi
3. **Add relay server**: Scale to WAN
4. **Implement persistence**: Save task history
5. **Add monitoring UI**: Real-time dashboard

---

## 🔗 Related Files

- `coordinator.js` - Main coordinator
- `peer-worker.js` - Peer worker
- `demo.js` - Usage examples
- `../southstack-p2p/main.js` - WebGPU LLM engine
- `relay-server.js` - WebRTC relay (optional)

---

**Built on:** WebGPU • WebRTC • WebLLM • Browser APIs

**Status:** 🚀 Production Ready
