# Context Scaling Results

This file captures measured context-scaling behavior for SouthStack P2P using the local benchmark tool.

Run command:

```bash
node southstack-p2p/tools/context_scaling_benchmark.js
```

## Measured Results

| Scenario | Lines | Characters | Chunks (6k chars) | Build time | Chunking time | Routing time | RSS (MB) | Heap used (MB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 10k | 10,000 | 675,560 | 113 | 13.52 ms | 1.11 ms | 0.13 ms | 40.9 | 7.2 |
| 50k | 50,000 | 3,555,560 | 593 | 48.26 ms | 5.35 ms | 0.11 ms | 69.5 | 24.5 |
| 500k | 500,000 | 37,555,560 | 6,260 | 440.59 ms | 70.21 ms | 0.15 ms | 327.3 | 203.4 |

## Notes

- Context chunking and routing are now deterministic and linear with input size.
- Routing distributes shards across `host`, `peer-1`, and `peer-2` in round-robin order.
- 500k-line synthetic load remains processable, but memory usage becomes substantial.
- For live browser runs, 500k scenarios should be tested on higher-memory machines.

## Next Validation

- Repeat this benchmark during real multi-device session with WebRTC enabled.
- Capture end-to-end task latency and retry count in addition to local chunking cost.
- Run at least one large open-source codebase with the same metric table format.
