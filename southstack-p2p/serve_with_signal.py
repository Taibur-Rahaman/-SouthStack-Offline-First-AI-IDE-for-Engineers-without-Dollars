#!/usr/bin/env python3
"""
Serve southstack-p2p over HTTP plus minimal /api/southstack/* SDP signaling
so two devices on the same Wi‑Fi can connect without copy/pasting WebRTC text.

Run:  python3 serve_with_signal.py
Then: open http://localhost:8000 and use "Start session — show link & QR".
"""
from __future__ import annotations

import json
import os
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
# Set in main() before serve_forever()
_SERVER_PORT = 8000
_BIND_HOST = "0.0.0.0"
# room_id -> {"offer": str | None, "answer": str | None}
ROOMS: dict[str, dict[str, str | None]] = {}
DEBUG_LOG_PATH = "/Users/eloneflax/cse327/.cursor/debug-947c6e.log"


def dbg_log(run_id: str, hypothesis_id: str, location: str, message: str, data: dict | None = None) -> None:
    # region agent log
    payload = {
        "sessionId": "947c6e",
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data or {},
        "timestamp": int(time.time() * 1000),
    }
    try:
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except OSError:
        pass
    # endregion


def guess_lan_ipv4s() -> list[str]:
    """Best-effort local IPv4 addresses for URLs other devices can try (stdlib only)."""
    seen: set[str] = set()
    out: list[str] = []

    def add(ip: str) -> None:
        if not ip or ip.startswith("127.") or ip == "0.0.0.0":
            return
        if ip not in seen:
            seen.add(ip)
            out.append(ip)

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.25)
        s.connect(("8.8.8.8", 80))
        add(s.getsockname()[0])
        s.close()
    except OSError:
        pass

    try:
        hostname = socket.gethostname()
        for res in socket.getaddrinfo(hostname, None, socket.AF_INET, socket.SOCK_STREAM):
            add(res[4][0])
    except OSError:
        pass

    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _empty(self, code: int) -> None:
        self.send_response(code)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        p = urlparse(self.path)
        if p.path == "/api/southstack/ping":
            return self._empty(204)
        if p.path == "/api/southstack/lan-hint":
            ips = guess_lan_ipv4s()
            urls = ["http://%s:%s" % (ip, _SERVER_PORT) for ip in ips]
            return self._json(
                200,
                {
                    "port": _SERVER_PORT,
                    "bind": _BIND_HOST,
                    "ips": ips,
                    "urls": urls,
                },
            )
        if p.path == "/api/southstack/offer":
            q = parse_qs(p.query)
            room = (q.get("room") or [None])[0]
            room = unquote(room) if room else None
            if not room:
                dbg_log("pre-fix-v3", "S2", "serve_with_signal.py:GET:offer", "missing room on offer get", {})
                return self._json(400, {"error": "missing room"})
            data = ROOMS.get(room) or {}
            sdp = data.get("offer")
            if not sdp:
                dbg_log("pre-fix-v3", "S2", "serve_with_signal.py:GET:offer", "offer missing", {"room": room})
                # Not an error: guests poll until host creates an offer.
                return self._empty(204)
            dbg_log("pre-fix-v3", "S2", "serve_with_signal.py:GET:offer", "offer served", {"room": room, "offerLen": len(sdp)})
            return self._json(200, {"sdp": sdp})
        if p.path == "/api/southstack/answer":
            q = parse_qs(p.query)
            room = (q.get("room") or [None])[0]
            room = unquote(room) if room else None
            if not room:
                dbg_log("pre-fix-v3", "S3", "serve_with_signal.py:GET:answer", "missing room on answer get", {})
                return self._json(400, {"error": "missing room"})
            data = ROOMS.get(room) or {}
            sdp = data.get("answer")
            if not sdp:
                dbg_log("pre-fix-v3", "S3", "serve_with_signal.py:GET:answer", "answer missing", {"room": room})
                # Not an error: host polls until guest posts the answer.
                return self._empty(204)
            dbg_log("pre-fix-v3", "S3", "serve_with_signal.py:GET:answer", "answer served", {"room": room, "answerLen": len(sdp)})
            return self._json(200, {"sdp": sdp})
        return self._static_get(p.path)

    def do_POST(self) -> None:
        p = urlparse(self.path)
        if p.path not in ("/api/southstack/offer", "/api/southstack/answer"):
            self.send_error(405)
            return
        ln = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(ln) if ln else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return self._json(400, {"error": "invalid json"})
        room = body.get("room")
        sdp = body.get("sdp")
        if not room or not sdp:
            return self._json(400, {"error": "room and sdp required"})
        if p.path == "/api/southstack/offer":
            ROOMS[room] = {"offer": sdp, "answer": None}
            dbg_log("pre-fix-v3", "S2", "serve_with_signal.py:POST:offer", "offer stored", {"room": room, "offerLen": len(sdp)})
            return self._json(200, {"ok": True})
        ROOMS.setdefault(room, {"offer": None, "answer": None})
        ROOMS[room]["answer"] = sdp
        dbg_log("pre-fix-v3", "S3", "serve_with_signal.py:POST:answer", "answer stored", {"room": room, "answerLen": len(sdp)})
        return self._json(200, {"ok": True})

    def _static_get(self, path: str) -> None:
        if path in ("/", ""):
            path = "/index.html"
        fs = os.path.normpath(os.path.join(ROOT, path.lstrip("/")))
        if not fs.startswith(ROOT):
            self.send_error(403)
            return
        if os.path.isdir(fs):
            fs = os.path.join(fs, "index.html")
        if not os.path.isfile(fs):
            self.send_error(404)
            return
        with open(fs, "rb") as f:
            data = f.read()
        ct = "application/octet-stream"
        if fs.endswith(".html"):
            ct = "text/html; charset=utf-8"
        elif fs.endswith(".js"):
            ct = "application/javascript; charset=utf-8"
        elif fs.endswith(".json"):
            ct = "application/json; charset=utf-8"
        elif fs.endswith(".css"):
            ct = "text/css; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    global _SERVER_PORT, _BIND_HOST
    requested_port = int(os.environ.get("PORT", "8000"))
    port = requested_port
    host = os.environ.get("BIND", "0.0.0.0")
    _BIND_HOST = host
    httpd = None
    bind_error = None
    for try_port in range(requested_port, requested_port + 30):
        try:
            httpd = ThreadingHTTPServer((host, try_port), Handler)
            port = try_port
            bind_error = None
            break
        except OSError as e:
            bind_error = e
            if e.errno != 48:
                raise
    if not httpd:
        raise bind_error if bind_error else RuntimeError("Failed to start HTTP server")
    _SERVER_PORT = port
    dbg_log("pre-fix-v3", "S1", "serve_with_signal.py:main:start", "server started", {"host": host, "requestedPort": requested_port, "actualPort": port})
    print("")
    print("=" * 60)
    print("SouthStack listening on %s:%s (all interfaces)" % (host, port))
    if port != requested_port:
        print("Note: requested port %s was busy, so it switched to %s." % (requested_port, port))
    print("=" * 60)
    for u in ["http://127.0.0.1:%s" % port, "http://localhost:%s" % port]:
        print("  This PC:     %s" % u)
    ips = guess_lan_ipv4s()
    if ips:
        print("  Other Wi‑Fi devices — open ONE of these in the browser:")
        for ip in ips:
            print("               http://%s:%s" % (ip, port))
    else:
        print("  (Could not guess LAN IP — run `ipconfig` / `ifconfig` and use that IPv4.)")
    print("")
    print("If phones/laptops show CONNECTION REFUSED:")
    print("  • Wrong PORT in the URL? This process listens on :%s only." % port)
    print("    If your QR/link says :8001 but you did not set PORT=8001, use :%s in the browser." % port)
    print("  • Firewall on THIS computer must allow incoming TCP port %s (Python)." % port)
    print("  • macOS: System Settings → Network → Firewall → Options")
    print("  • Windows: Windows Security → Firewall → Allow an app → Python")
    print("  • Phone must be on the SAME Wi‑Fi as this PC (not mobile data).")
    print("  • IP must be 192.168.x.x / 10.x.x.x — not 191.168 (typo).")
    print("=" * 60)
    print("")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
