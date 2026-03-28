import { P2PMesh } from "./p2p.js";
import { SharedState } from "./shared-state.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowMs() {
  return Date.now();
}

function lexicographicMin(arr) {
  return arr.slice().sort()[0] || null;
}

/**
 * Fault-tolerant generation coordinator.
 * - Broadcasts tokens and periodic checkpoints
 * - Leader election on heartbeat loss
 * - Resume generation via prompt replay when leader dies
 */
export class SouthStackFT {
  constructor({ sessionId = "default", peerId, generation } = {}) {
    this.sessionId = sessionId;
    this.peerId = peerId || null;
    this.generation = {
      maxTokens: generation?.maxTokens ?? 512,
      temperature: generation?.temperature ?? 0.2,
    };

    this.mesh = new P2PMesh({ peerId: peerId || undefined });
    this.peerId = this.mesh.peerId;

    this.shared = new SharedState({ sessionId, peerId: this.peerId });
    this.shared.onState = (s) => this.onState?.(s);

    /** @type {(state: any) => void} */
    this.onState = null;
    /** @type {(evt: {type: string, detail?: any}) => void} */
    this.onEvent = null;

    this._hbTimer = null;
    this._electionTimer = null;
    this._snapshotTimer = null;
    this._lastLeaderHeartbeatAt = 0;

    this._generationAbort = { aborted: false, id: null };
    this._engineProvider = null;

    this.mesh.onMessage = ({ from, msg }) => this._onMsg(from, msg);
    this.mesh.onPeerConnected = ({ peerId: pid }) => {
      this._touchPeer(pid);
      this._maybeElectLeader("peer_connected");
      this.onEvent?.({ type: "peer_connected", detail: { peerId: pid } });
    };
    this.mesh.onPeerDisconnected = ({ peerId: pid }) => {
      this.shared.localUpdate((s) => {
        delete s.peers[pid];
        // unassign tasks owned by lost peer (future extension)
        for (const [tid, t] of Object.entries(s.tasks || {})) {
          if (t && t.assignedTo === pid && t.status !== "done") {
            s.tasks[tid] = { ...t, assignedTo: null, status: "pending" };
          }
        }
      });
      this._maybeElectLeader("peer_disconnected");
      this.onEvent?.({ type: "peer_disconnected", detail: { peerId: pid } });
    };
  }

  async start() {
    await this.shared.loadSnapshot();
    this.shared.localUpdate((s) => {
      s.peers[this.peerId] = { lastSeenMs: nowMs() };
      if (!s.leaderId) s.leaderId = null;
      if (!s.term) s.term = 0;
    });

    this._hbTimer = setInterval(() => this._sendHeartbeat(), 1000);
    this._electionTimer = setInterval(() => this._checkLeaderLiveness(), 1200);
    this._snapshotTimer = setInterval(() => {
      this.shared.saveSnapshot().catch(() => {});
    }, 2500);

    this._maybeElectLeader("startup");
  }

  stop() {
    clearInterval(this._hbTimer);
    clearInterval(this._electionTimer);
    clearInterval(this._snapshotTimer);
    this._hbTimer = null;
    this._electionTimer = null;
    this._snapshotTimer = null;
    this.mesh.disconnectAll();
  }

  setEngineProvider(fn) {
    // fn: async () => engine
    this._engineProvider = fn;
  }

  isLeader() {
    return this.shared.get().leaderId === this.peerId;
  }

  getState() {
    return this.shared.get();
  }

  listPeers() {
    return this.mesh.listPeers();
  }

  async createOffer(remotePeerId) {
    return await this.mesh.createOffer({ remotePeerId });
  }

  async acceptOfferAndCreateAnswer(offerJson) {
    return await this.mesh.acceptOfferAndCreateAnswer(offerJson);
  }

  async acceptAnswer(answerJson, remotePeerId) {
    return await this.mesh.acceptAnswer(answerJson, { remotePeerId });
  }

  requestStateSync() {
    this.mesh.broadcast({
      type: "state_request",
      sessionId: this.sessionId,
      from: this.peerId,
    });
  }

  /**
   * Starts a replicated generation session.
   * - The leader generates and broadcasts tokens + checkpoints
   * - Followers just render updates
   */
  async runPrompt(prompt) {
    // Persist prompt for continuation
    this.shared.localUpdate((s) => {
      s.prompt = prompt;
      s.partialOutput = "";
      s.status = "running";
      s.error = null;
      s.startedAt = nowMs();
      s.generationId = `${this.peerId}-${nowMs()}`;
    });
    this.mesh.broadcast({ type: "state", sessionId: this.sessionId, state: this.shared.get() });

    this._maybeElectLeader("runPrompt");

    // If we are leader, generate. Otherwise just wait for state/token updates.
    if (this.isLeader()) {
      await this._leaderGenerateFresh();
    }
  }

  cancelGeneration() {
    this._generationAbort.aborted = true;
    this.shared.localUpdate((s) => {
      if (s.status === "running") s.status = "idle";
    });
    this.mesh.broadcast({ type: "cancel", sessionId: this.sessionId, by: this.peerId });
  }

  _touchPeer(peerId) {
    const ts = nowMs();
    this.shared.localUpdate((s) => {
      if (!s.peers) s.peers = {};
      s.peers[peerId] = { lastSeenMs: ts };
    });
  }

  _sendHeartbeat() {
    this._touchPeer(this.peerId);
    const st = this.shared.get();
    this.mesh.broadcast({
      type: "hb",
      sessionId: this.sessionId,
      from: this.peerId,
      leaderId: st.leaderId,
      term: st.term || 0,
      t: nowMs(),
    });
  }

  _checkLeaderLiveness() {
    const st = this.shared.get();
    const leaderId = st.leaderId;
    if (!leaderId) {
      this._maybeElectLeader("no_leader");
      return;
    }
    if (leaderId === this.peerId) return;
    const msSince = nowMs() - (this._lastLeaderHeartbeatAt || 0);
    if (msSince > 3500) {
      this._maybeElectLeader("leader_timeout");
    }
  }

  _maybeElectLeader(reason) {
    const st = this.shared.get();
    const all = [this.peerId, ...this.mesh.listPeers()];
    const leader = lexicographicMin(all);
    if (!leader) return;

    if (st.leaderId !== leader) {
      this.shared.localUpdate((s) => {
        s.leaderId = leader;
        s.term = (s.term || 0) + 1;
      });
      this.mesh.broadcast({
        type: "leader",
        sessionId: this.sessionId,
        leaderId: leader,
        term: this.shared.get().term,
        reason,
      });
      this.mesh.broadcast({ type: "state", sessionId: this.sessionId, state: this.shared.get() });

      // If we just became leader and a generation is mid-flight, take over.
      if (leader === this.peerId) {
        const s2 = this.shared.get();
        if (s2.status === "running" && s2.partialOutput && s2.prompt) {
          this._leaderResumeFromCheckpoint().catch((e) => {
            this.shared.localUpdate((s) => {
              s.status = "error";
              s.error = (e && e.message) || String(e);
            });
            this.mesh.broadcast({ type: "state", sessionId: this.sessionId, state: this.shared.get() });
          });
        }
      }
    }
  }

  _onMsg(from, msg) {
    if (!msg || msg.sessionId !== this.sessionId) return;

    if (msg.type === "hb") {
      this._touchPeer(from);
      const st = this.shared.get();
      if (msg.leaderId === from) this._lastLeaderHeartbeatAt = nowMs();
      // adopt leader if our state has none (or stale)
      if (!st.leaderId && msg.leaderId) {
        this.shared.localUpdate((s) => {
          s.leaderId = msg.leaderId;
          s.term = Math.max(s.term || 0, msg.term || 0);
        });
      }
      return;
    }

    if (msg.type === "leader") {
      this.shared.localUpdate((s) => {
        s.leaderId = msg.leaderId;
        s.term = Math.max(s.term || 0, msg.term || 0);
      });
      return;
    }

    if (msg.type === "state_request") {
      this.mesh.send(from, { type: "state", sessionId: this.sessionId, state: this.shared.get() });
      return;
    }

    if (msg.type === "state") {
      this.shared.mergeRemote(msg.state);
      return;
    }

    if (msg.type === "token") {
      const delta = msg.delta || "";
      if (!delta) return;
      this.shared.localUpdate((s) => {
        if (typeof s.partialOutput !== "string") s.partialOutput = "";
        s.partialOutput += delta;
        s.status = "running";
      });
      return;
    }

    if (msg.type === "done") {
      this.shared.localUpdate((s) => {
        s.status = "done";
        s.completedAt = nowMs();
      });
      return;
    }

    if (msg.type === "cancel") {
      this._generationAbort.aborted = true;
      this.shared.localUpdate((s) => {
        if (s.status === "running") s.status = "idle";
      });
      return;
    }
  }

  async _leaderGenerateFresh() {
    const st = this.shared.get();
    if (!this._engineProvider) throw new Error("Engine provider not set");
    const eng = await this._engineProvider();

    this._generationAbort = { aborted: false, id: st.generationId || `${this.peerId}-${nowMs()}` };
    let tokensSinceCheckpoint = 0;
    let lastCheckpointAt = nowMs();

    const stream = await eng.chat.completions.create({
      messages: [{ role: "user", content: st.prompt }],
      max_tokens: this.generation.maxTokens,
      temperature: this.generation.temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      if (!this.isLeader()) throw new Error("Lost leadership during generation");
      if (this._generationAbort.aborted) break;

      const txt = chunk.choices[0]?.delta?.content || "";
      if (!txt) continue;

      tokensSinceCheckpoint += 1;
      this.shared.localUpdate((s) => {
        s.partialOutput += txt;
        s.status = "running";
      });
      this.mesh.broadcast({ type: "token", sessionId: this.sessionId, delta: txt });

      const due = nowMs() - lastCheckpointAt > 1800 || tokensSinceCheckpoint >= 24;
      if (due) {
        tokensSinceCheckpoint = 0;
        lastCheckpointAt = nowMs();
        this.mesh.broadcast({ type: "state", sessionId: this.sessionId, state: this.shared.get() });
        this.shared.saveSnapshot().catch(() => {});
      }
    }

    if (this._generationAbort.aborted) return;
    this.shared.localUpdate((s) => {
      s.status = "done";
      s.completedAt = nowMs();
    });
    this.mesh.broadcast({ type: "done", sessionId: this.sessionId });
    this.mesh.broadcast({ type: "state", sessionId: this.sessionId, state: this.shared.get() });
    await this.shared.saveSnapshot();
  }

  async _leaderResumeFromCheckpoint() {
    const st = this.shared.get();
    if (!st.prompt) return;
    if (!this._engineProvider) throw new Error("Engine provider not set");
    const eng = await this._engineProvider();

    this.onEvent?.({ type: "resume", detail: { leaderId: this.peerId } });
    this._generationAbort = { aborted: false, id: st.generationId || `${this.peerId}-${nowMs()}` };

    // Prompt-replay continuation: feed prompt + partial output back in as assistant history.
    const messages = [
      { role: "user", content: st.prompt },
      { role: "assistant", content: st.partialOutput || "" },
      { role: "user", content: "Continue from where you left off." },
    ];

    const stream = await eng.chat.completions.create({
      messages,
      max_tokens: this.generation.maxTokens,
      temperature: this.generation.temperature,
      stream: true,
    });

    let tokensSinceCheckpoint = 0;
    let lastCheckpointAt = nowMs();

    for await (const chunk of stream) {
      if (!this.isLeader()) throw new Error("Lost leadership during resume");
      if (this._generationAbort.aborted) break;

      const txt = chunk.choices[0]?.delta?.content || "";
      if (!txt) continue;

      tokensSinceCheckpoint += 1;
      this.shared.localUpdate((s) => {
        s.partialOutput += txt;
        s.status = "running";
      });
      this.mesh.broadcast({ type: "token", sessionId: this.sessionId, delta: txt });

      const due = nowMs() - lastCheckpointAt > 1800 || tokensSinceCheckpoint >= 24;
      if (due) {
        tokensSinceCheckpoint = 0;
        lastCheckpointAt = nowMs();
        this.mesh.broadcast({ type: "state", sessionId: this.sessionId, state: this.shared.get() });
        this.shared.saveSnapshot().catch(() => {});
      }
    }

    if (this._generationAbort.aborted) return;
    this.shared.localUpdate((s) => {
      s.status = "done";
      s.completedAt = nowMs();
    });
    this.mesh.broadcast({ type: "done", sessionId: this.sessionId });
    this.mesh.broadcast({ type: "state", sessionId: this.sessionId, state: this.shared.get() });
    await this.shared.saveSnapshot();
  }
}

