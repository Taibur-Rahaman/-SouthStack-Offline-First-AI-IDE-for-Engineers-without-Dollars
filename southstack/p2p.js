// Minimal WebRTC mesh transport with manual copy/paste signaling.
// No STUN/TURN by default (LAN / same network recommended).

function nowMs() {
  return Date.now();
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export class P2PMesh {
  constructor({ peerId, onMessage, onPeerChange, rtcConfig } = {}) {
    this.peerId = peerId;
    this.rtcConfig = rtcConfig || { iceServers: [] };
    this.onMessage = onMessage || (() => {});
    this.onPeerChange = onPeerChange || (() => {});

    this._pc = null;
    this._dc = null;
    this._remotePeerId = null;
    this._connectedAt = null;
  }

  get isConnected() {
    return !!this._dc && this._dc.readyState === "open";
  }

  get remotePeerId() {
    return this._remotePeerId;
  }

  _emitPeerChange() {
    this.onPeerChange({
      connected: this.isConnected,
      remotePeerId: this._remotePeerId,
      connectedAt: this._connectedAt,
    });
  }

  _closeExisting() {
    try {
      if (this._dc) this._dc.close();
    } catch {}
    try {
      if (this._pc) this._pc.close();
    } catch {}
    this._pc = null;
    this._dc = null;
    this._remotePeerId = null;
    this._connectedAt = null;
    this._emitPeerChange();
  }

  _ensurePC() {
    if (this._pc) return this._pc;
    const pc = new RTCPeerConnection(this.rtcConfig);
    pc.onconnectionstatechange = () => this._emitPeerChange();
    pc.oniceconnectionstatechange = () => this._emitPeerChange();
    pc.onicecandidateerror = () => this._emitPeerChange();

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      this._attachDC(dc);
    };

    this._pc = pc;
    return pc;
  }

  _attachDC(dc) {
    this._dc = dc;
    dc.onopen = () => {
      this._connectedAt = nowMs();
      this._emitPeerChange();
      // Identify ourselves.
      this.send({ type: "hello", peerId: this.peerId, t: nowMs() });
    };
    dc.onclose = () => {
      this._emitPeerChange();
    };
    dc.onerror = () => {
      this._emitPeerChange();
    };
    dc.onmessage = (ev) => {
      const msg = typeof ev.data === "string" ? safeJsonParse(ev.data) : null;
      if (!msg) return;
      if (msg.type === "hello" && msg.peerId) {
        this._remotePeerId = msg.peerId;
        this._emitPeerChange();
      }
      this.onMessage(msg);
    };
  }

  send(obj) {
    if (!this.isConnected) return false;
    try {
      this._dc.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    this._closeExisting();
  }

  // Caller side:
  // 1) createOffer() -> paste offer to remote
  // 2) remote returns answer -> setRemoteAnswer(answer)
  async createOffer() {
    this._closeExisting();
    const pc = this._ensurePC();
    const dc = pc.createDataChannel("southstack");
    this._attachDC(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete for easier copy/paste.
    await this._waitIceGatheringComplete(pc);

    return {
      type: "offer",
      from: this.peerId,
      sdp: pc.localDescription,
      createdAt: nowMs(),
    };
  }

  async setRemoteAnswer(answerObj) {
    const pc = this._ensurePC();
    const desc = answerObj?.sdp || answerObj;
    await pc.setRemoteDescription(desc);
  }

  // Callee side:
  // 1) setRemoteOffer(offer)
  // 2) createAnswer() -> paste answer to caller
  async setRemoteOffer(offerObj) {
    this._closeExisting();
    const pc = this._ensurePC();
    const desc = offerObj?.sdp || offerObj;
    await pc.setRemoteDescription(desc);
  }

  async createAnswer() {
    const pc = this._ensurePC();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this._waitIceGatheringComplete(pc);
    return {
      type: "answer",
      from: this.peerId,
      sdp: pc.localDescription,
      createdAt: nowMs(),
    };
  }

  async _waitIceGatheringComplete(pc) {
    if (pc.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      const onChange = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", onChange);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", onChange);
      // Failsafe: resolve anyway after a short delay.
      setTimeout(() => {
        try {
          pc.removeEventListener("icegatheringstatechange", onChange);
        } catch {}
        resolve();
      }, 1500);
    });
  }
}

