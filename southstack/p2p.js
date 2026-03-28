/**
 * Minimal WebRTC mesh with manual offer/answer signaling (no server).
 * Uses a single reliable ordered DataChannel per connection.
 */
 
const DEFAULT_RTC_CONFIG = {
  iceServers: [
    // Public STUN servers; required for NAT traversal.
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};
 
function nowMs() {
  return Date.now();
}
 
function randomId() {
  // short-ish, stable enough for demo purposes
  return (
    Math.random().toString(16).slice(2) +
    "-" +
    Math.random().toString(16).slice(2)
  ).slice(0, 18);
}
 
export class P2PMesh {
  constructor({ peerId, rtcConfig } = {}) {
    this.peerId = peerId || randomId();
    this.rtcConfig = rtcConfig || DEFAULT_RTC_CONFIG;
 
    /** @type {Map<string, {pc: RTCPeerConnection, dc: RTCDataChannel, connected: boolean, lastSeenMs: number}>} */
    this.peers = new Map();
 
    /** @type {(evt: {from: string, msg: any}) => void} */
    this.onMessage = null;
    /** @type {(evt: {peerId: string}) => void} */
    this.onPeerConnected = null;
    /** @type {(evt: {peerId: string}) => void} */
    this.onPeerDisconnected = null;
  }
 
  listPeers() {
    return Array.from(this.peers.keys()).sort();
  }
 
  isConnectedTo(peerId) {
    const p = this.peers.get(peerId);
    return !!(p && p.connected && p.dc && p.dc.readyState === "open");
  }
 
  broadcast(msg) {
    for (const [pid, p] of this.peers.entries()) {
      if (!p.dc || p.dc.readyState !== "open") continue;
      try {
        p.dc.send(JSON.stringify(msg));
      } catch (e) {
        // ignore send errors; disconnect handler will clean up
        console.warn("P2P send failed to", pid, e);
      }
    }
  }
 
  send(toPeerId, msg) {
    const p = this.peers.get(toPeerId);
    if (!p || !p.dc || p.dc.readyState !== "open") return false;
    p.dc.send(JSON.stringify(msg));
    return true;
  }
 
  /**
   * Create an outbound connection offer. User must paste it into the other peer.
   * Returns a JSON string containing { from, sdp, type }.
   */
  async createOffer({ remotePeerId } = {}) {
    const pc = new RTCPeerConnection(this.rtcConfig);
    const dc = pc.createDataChannel("southstack", { ordered: true });
    const peerKey = remotePeerId || "__pending__" + randomId();
    this._registerPeer(peerKey, pc, dc);
 
    await pc.setLocalDescription(await pc.createOffer());
    await this._waitForIceGatheringComplete(pc);
 
    return JSON.stringify({
      v: 1,
      from: this.peerId,
      to: remotePeerId || null,
      sdp: pc.localDescription,
    });
  }
 
  /**
   * Accept an offer JSON string and create an answer JSON string.
   */
  async acceptOfferAndCreateAnswer(offerJson) {
    const offer = JSON.parse(offerJson);
    if (!offer || !offer.sdp) throw new Error("Invalid offer");
 
    const pc = new RTCPeerConnection(this.rtcConfig);
    let dc = null;
 
    pc.ondatachannel = (ev) => {
      dc = ev.channel;
      this._registerPeer(offer.from, pc, dc);
    };
 
    await pc.setRemoteDescription(offer.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await this._waitForIceGatheringComplete(pc);
 
    return JSON.stringify({
      v: 1,
      from: this.peerId,
      to: offer.from,
      sdp: pc.localDescription,
    });
  }
 
  /**
   * Finalize an outbound connection by applying the remote answer.
   */
  async acceptAnswer(answerJson, { remotePeerId } = {}) {
    const answer = JSON.parse(answerJson);
    if (!answer || !answer.sdp) throw new Error("Invalid answer");
 
    const pid = remotePeerId || answer.from || answer.to;
    if (!pid) throw new Error("Cannot determine remote peer id");
 
    // We stored the offer-side peer entry under a pending key; find it.
    const pendingEntry = Array.from(this.peers.entries()).find(
      ([k, v]) => k.startsWith("__pending__") && v.pc && v.pc.signalingState !== "closed"
    );
    if (!pendingEntry) throw new Error("No pending offer connection found");
 
    const [pendingKey, p] = pendingEntry;
    await p.pc.setRemoteDescription(answer.sdp);
 
    // Rename pending key to real peer id.
    this.peers.delete(pendingKey);
    this.peers.set(pid, p);
 
    // Update message handler to use final pid.
    this._wireDataChannel(pid, p.dc);
  }
 
  disconnectPeer(peerId) {
    const p = this.peers.get(peerId);
    if (!p) return;
    try {
      p.dc?.close();
    } catch {}
    try {
      p.pc?.close();
    } catch {}
    this.peers.delete(peerId);
    this.onPeerDisconnected?.({ peerId });
  }
 
  disconnectAll() {
    for (const pid of this.listPeers()) this.disconnectPeer(pid);
  }
 
  _registerPeer(peerId, pc, dc) {
    const entry = {
      pc,
      dc,
      connected: false,
      lastSeenMs: nowMs(),
    };
    this.peers.set(peerId, entry);
 
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        entry.connected = true;
        this.onPeerConnected?.({ peerId });
      }
      if (st === "failed" || st === "disconnected" || st === "closed") {
        this.disconnectPeer(peerId);
      }
    };
 
    this._wireDataChannel(peerId, dc);
  }
 
  _wireDataChannel(peerId, dc) {
    if (!dc) return;
    dc.onopen = () => {
      const p = this.peers.get(peerId);
      if (p) p.connected = true;
      this.onPeerConnected?.({ peerId });
    };
    dc.onclose = () => {
      this.disconnectPeer(peerId);
    };
    dc.onerror = () => {
      this.disconnectPeer(peerId);
    };
    dc.onmessage = (ev) => {
      const p = this.peers.get(peerId);
      if (p) p.lastSeenMs = nowMs();
      let msg = null;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        msg = ev.data;
      }
      this.onMessage?.({ from: peerId, msg });
    };
  }
 
  _waitForIceGatheringComplete(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const onState = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", onState);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", onState);
      // Safety: resolve after a short max wait so UI doesn't hang forever.
      setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", onState);
        resolve();
      }, 2500);
    });
  }
}

