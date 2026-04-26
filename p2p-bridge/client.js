export function createP2PBridge({ url, onUiJson, onAudioResource, onConnectionChange }) {
  if (!url) {
    console.info("[p2p-bridge] disabled: missing URL");
    if (onConnectionChange) onConnectionChange("disabled");
    return {
      enabled: false,
      connect() {},
      disconnect() {},
      sendUiJson() {},
      sendAudioResource() {}
    };
  }

  let socket = null;
  let reconnectTimer = null;
  let shouldReconnect = true;

  function scheduleReconnect() {
    if (!shouldReconnect || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      console.info("[p2p-bridge] reconnecting...");
      connect();
    }, 1200);
  }

  function connect() {
    if (socket || typeof WebSocket === "undefined") return;
    console.info("[p2p-bridge] connecting:", url);
    if (onConnectionChange) onConnectionChange("connecting");
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      console.info("[p2p-bridge] connected");
      if (onConnectionChange) onConnectionChange("connected");
    });

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.info("[p2p-bridge] received:", msg?.type);
        if (msg?.type === "ui-json" && onUiJson) {
          onUiJson(msg.payload);
        }
        if (msg?.type === "audio-resource" && onAudioResource) {
          onAudioResource(msg.payload);
        }
      } catch (error) {
        console.warn("[p2p-bridge] invalid message:", error);
        // Ignore invalid bridge payloads.
      }
    });

    socket.addEventListener("close", () => {
      console.info("[p2p-bridge] disconnected");
      socket = null;
      if (onConnectionChange) onConnectionChange("disconnected");
      scheduleReconnect();
    });

    socket.addEventListener("error", (error) => {
      console.warn("[p2p-bridge] socket error:", error);
      if (onConnectionChange) onConnectionChange("disconnected");
    });
  }

  function disconnect() {
    shouldReconnect = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!socket) return;
    socket.close();
    socket = null;
  }

  function sendUiJson(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.info("[p2p-bridge] ui send skipped: socket not open");
      return;
    }
    console.info("[p2p-bridge] sending: ui-json");
    socket.send(JSON.stringify({ type: "ui-json", payload }));
  }

  function sendAudioResource(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.info("[p2p-bridge] audio send skipped: socket not open");
      return;
    }
    console.info("[p2p-bridge] sending: audio-resource");
    socket.send(JSON.stringify({ type: "audio-resource", payload }));
  }

  return {
    enabled: true,
    connect,
    disconnect,
    sendUiJson,
    sendAudioResource
  };
}
