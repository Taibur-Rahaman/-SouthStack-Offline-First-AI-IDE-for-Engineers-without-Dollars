# SouthStack P2P Demo Runbook

This runbook is a repeatable script for live demonstration with one host and two peers.

## Environment

- Host laptop with Chrome and WebGPU
- Two peer devices on same Wi-Fi
- Host command:

```bash
cd southstack-p2p
python3 serve_with_signal.py
```

## Demo Flow

### 1) Connection setup (Host + 2 peers)

1. Host opens app and clicks `Start session - show link & QR`.
2. Peer 1 joins using invite link or QR.
3. Host clicks `New guest` and repeats for Peer 2.
4. Verify `Devices in this room` shows at least 3 devices.

Success criteria:
- no manual SDP paste required
- peers appear authenticated and connected

### 2) Multi-device development

1. On host, submit a coding task from `Start shared job`.
2. Confirm subtasks are distributed and processed in parallel.
3. Show merged final output in `Shared result`.

Success criteria:
- distributed assignment visible in logs
- merged output appears without manual intervention

### 3) Multi-device debugging

1. Submit a prompt containing debugging keywords such as `debug` or `failing test`.
2. Confirm pipeline stages are split as:
   - reproduce/localize
   - root-cause analysis
   - patch proposal
   - regression checks
3. Confirm merged debugging result appears in shared output.

Success criteria:
- staged debugging pipeline runs across devices
- output contains patch + regression checks

### 4) Fault tolerance and recovery

1. Disconnect one peer mid-task.
2. Verify automatic retry/reassignment.
3. Rejoin disconnected peer and verify automatic room recovery.

Success criteria:
- task continues on remaining nodes
- reconnect does not require full app reset

## Dry Run Checklist

- [ ] Connection setup completed
- [ ] Multi-device development completed
- [ ] Multi-device debugging completed
- [ ] Fault-tolerance behavior verified
- [ ] No blocking errors in activity log
