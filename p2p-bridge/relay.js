import { WebSocketServer } from "ws";

const port = Number(process.env.P2P_BRIDGE_PORT || 3020);
const wss = new WebSocketServer({ port });

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    for (const client of wss.clients) {
      if (client !== socket && client.readyState === client.OPEN) {
        client.send(raw);
      }
    }
  });
});

console.log(`p2p relay listening on ws://localhost:${port}`);
