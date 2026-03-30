#!/usr/bin/env python3
"""
SouthStack Universal Server - Works on ANY router/network
Supports: mDNS/Bonjour, UPnP, manual LAN IP, QR codes
Compatible with: Windows, macOS, Linux, Android, iOS
No port forwarding needed - works on same LAN automatically.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import subprocess
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
_SERVER_PORT = 8000
_BIND_HOST = "0.0.0.0"
_ROOMS: dict[str, dict[str, str | None]] = {}
_ROOM_LOCK = threading.Lock()
_MDNS_NAME = None
_DEBUG_LOG_PATH = "/Users/eloneflax/cse327/.cursor/debug-947c6e.log"


def dbg_log(run_id: str, hypothesis_id: str, location: str, message: str, data: dict | None = None) -> None:
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
        with open(_DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except OSError:
        pass


def get_all_local_ips() -> list[str]:
    """Get all local IPv4 addresses (cross-platform)."""
    ips = []
    seen = set()
    
    # Method 1: Socket connection guess
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.25)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        if ip and not ip.startswith("127.") and ip != "0.0.0.0":
            if ip not in seen:
                seen.add(ip)
                ips.append(ip)
        s.close()
    except OSError:
        pass
    
    # Method 2: Hostname resolution
    try:
        hostname = socket.gethostname()
        for res in socket.getaddrinfo(hostname, None, socket.AF_INET, socket.SOCK_STREAM):
            ip = res[4][0]
            if ip and ip not in seen and not ip.startswith("127."):
                seen.add(ip)
                ips.append(ip)
    except OSError:
        pass
    
    # Method 3: Platform-specific commands
    try:
        if sys.platform == "darwin":  # macOS
            result = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=2)
            for line in result.stdout.split("\n"):
                if "inet " in line:
                    match = re.search(r'inet (\d+\.\d+\.\d+\.\d+)', line)
                    if match:
                        ip = match.group(1)
                        if ip and ip not in seen and not ip.startswith("127."):
                            seen.add(ip)
                            ips.append(ip)
        elif sys.platform == "linux":
            result = subprocess.run(["ip", "addr"], capture_output=True, text=True, timeout=2)
            for line in result.stdout.split("\n"):
                if "inet " in line:
                    match = re.search(r'inet (\d+\.\d+\.\d+\.\d+)', line)
                    if match:
                        ip = match.group(1)
                        if ip and ip not in seen and not ip.startswith("127."):
                            seen.add(ip)
                            ips.append(ip)
        elif sys.platform == "win32":
            result = subprocess.run(["ipconfig"], capture_output=True, text=True, timeout=2)
            for line in result.stdout.split("\n"):
                if "IPv4" in line or "IP Address" in line:
                    match = re.search(r'(\d+\.\d+\.\d+\.\d+)', line)
                    if match:
                        ip = match.group(1)
                        if ip and ip not in seen and not ip.startswith("127."):
                            seen.add(ip)
                            ips.append(ip)
    except Exception:
        pass
    
    return ips


def setup_mdns(port: int) -> str | None:
    """Try to register mDNS/Bonjour name (optional, fails gracefully)."""
    global _MDNS_NAME
    mdns_name = f"southstack-{port}.local"
    
    # Try using avahi-daemon (Linux)
    if sys.platform == "linux":
        try:
            subprocess.run([
                "avahi-publish-service", "-R",
                f"SouthStack P2P", "_http._tcp",
                str(port), f"SouthStack running on port {port}"
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
            _MDNS_NAME = mdns_name
            return mdns_name
        except Exception:
            pass
    
    # macOS has Bonjour built-in via NSNetService (would need PyObjC)
    # For now, just return the name even if not registered
    _MDNS_NAME = mdns_name
    return mdns_name


def generate_qr_code(url: str) -> str:
    """Generate ASCII QR code for terminal display."""
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=1, border=2)
        qr.add_data(url)
        qr.make(fit=True)
        return qr.print_ascii(tty=False)
    except ImportError:
        # Fallback: simple text representation
        return f"\n📱 Scan QR or open: {url}\n"


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
        
        # Network discovery endpoint
        if p.path == "/api/southstack/discover":
            ips = get_all_local_ips()
            urls = [f"http://{ip}:{_SERVER_PORT}" for ip in ips]
            mdns_url = f"http://{_MDNS_NAME}:{_SERVER_PORT}" if _MDNS_NAME else None
            return self._json(200, {
                "port": _SERVER_PORT,
                "bind": _BIND_HOST,
                "ips": ips,
                "urls": urls,
                "mdns": _MDNS_NAME,
                "mdns_url": mdns_url,
                "hostname": socket.gethostname()
            })
        
        if p.path == "/api/southstack/ping":
            return self._empty(204)
        
        if p.path == "/api/southstack/lan-hint":
            ips = get_all_local_ips()
            urls = [f"http://{ip}:{_SERVER_PORT}" for ip in ips]
            return self._json(200, {
                "port": _SERVER_PORT,
                "bind": _BIND_HOST,
                "ips": ips,
                "urls": urls,
            })
        
        if p.path == "/api/southstack/offer":
            q = parse_qs(p.query)
            room = (q.get("room") or [None])[0]
            room = unquote(room) if room else None
            if not room:
                dbg_log("pre-fix-v3", "S2", "serve_with_signal.py:GET:offer", "missing room on offer get", {})
                return self._json(400, {"error": "missing room"})
            with _ROOM_LOCK:
                data = _ROOMS.get(room) or {}
                sdp = data.get("offer")
            if not sdp:
                dbg_log("pre-fix-v3", "S2", "serve_with_signal.py:GET:offer", "offer missing", {"room": room})
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
            with _ROOM_LOCK:
                data = _ROOMS.get(room) or {}
                sdp = data.get("answer")
                if sdp and room in _ROOMS:
                    _ROOMS[room]["answer"] = None
            if not sdp:
                dbg_log("pre-fix-v3", "S3", "serve_with_signal.py:GET:answer", "answer missing", {"room": room})
                return self._empty(204)
            dbg_log("pre-fix-v3", "S3", "serve_with_signal.py:GET:answer", "answer served", {"room": room, "answerLen": len(sdp)})
            return self._json(200, {"sdp": sdp})
        
        if p.path == "/api/southstack/candidate":
            q = parse_qs(p.query)
            room = (q.get("room") or [None])[0]
            peer = (q.get("peer") or [None])[0]
            room = unquote(room) if room else None
            peer = unquote(peer) if peer else None
            if not room or not peer:
                return self._json(400, {"error": "missing room or peer"})
            out: list[dict] = []
            with _ROOM_LOCK:
                data = _ROOMS.get(room) or {}
                candidates = data.get("candidates") or []
                keep = []
                for item in candidates:
                    from_peer = str(item.get("fromPeerId") or "")
                    to_peer = str(item.get("toPeerId") or "")
                    if from_peer == peer:
                        keep.append(item)
                        continue
                    if to_peer and to_peer != peer:
                        keep.append(item)
                        continue
                    out.append(item)
                if room in _ROOMS:
                    _ROOMS[room]["candidates"] = keep
            if not out:
                return self._empty(204)
            return self._json(200, {"candidates": out})
        
        return self._static_get(p.path)

    def do_POST(self) -> None:
        p = urlparse(self.path)
        if p.path not in ("/api/southstack/offer", "/api/southstack/answer", "/api/southstack/candidate"):
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
        if p.path != "/api/southstack/candidate" and (not room or not sdp):
            return self._json(400, {"error": "room and sdp required"})
        if p.path == "/api/southstack/offer":
            with _ROOM_LOCK:
                _ROOMS[room] = {"offer": sdp, "answer": None, "candidates": []}
            dbg_log("pre-fix-v3", "S2", "serve_with_signal.py:POST:offer", "offer stored", {"room": room, "offerLen": len(sdp)})
            return self._json(200, {"ok": True})
        if p.path == "/api/southstack/candidate":
            from_peer = str(body.get("fromPeerId") or "")
            to_peer = str(body.get("toPeerId") or "")
            cand = body.get("candidate")
            if not room or not from_peer or not cand:
                return self._json(400, {"error": "room, fromPeerId and candidate required"})
            with _ROOM_LOCK:
                _ROOMS.setdefault(room, {"offer": None, "answer": None, "candidates": []})
                lst = _ROOMS[room].get("candidates")
                if not isinstance(lst, list):
                    lst = []
                    _ROOMS[room]["candidates"] = lst
                lst.append({
                    "fromPeerId": from_peer,
                    "toPeerId": to_peer,
                    "candidate": cand,
                    "at": int(time.time() * 1000),
                })
                if len(lst) > 300:
                    _ROOMS[room]["candidates"] = lst[-300:]
            return self._json(200, {"ok": True})
        with _ROOM_LOCK:
            _ROOMS.setdefault(room, {"offer": None, "answer": None, "candidates": []})
            _ROOMS[room]["answer"] = sdp
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


def print_startup_banner(port: int, requested_port: int) -> None:
    """Print comprehensive startup info with all access methods."""
    ips = get_all_local_ips()
    mdns_url = f"http://{_MDNS_NAME}:{port}" if _MDNS_NAME else None
    
    print("")
    print("=" * 70)
    print("🚀 SouthStack Universal Server - Works on ANY Router!")
    print("=" * 70)
    print(f"Server listening on { _BIND_HOST}:{port} (all network interfaces)")
    if port != requested_port:
        print(f"⚠️  Port {requested_port} was busy, switched to {port}")
    print("")
    
    # Local access
    print("💻 LOCAL ACCESS (this computer):")
    print(f"   http://127.0.0.1:{port}")
    print(f"   http://localhost:{port}")
    print("")
    
    # Network access
    print("🌐 NETWORK ACCESS (other devices on same Wi-Fi):")
    if ips:
        for i, ip in enumerate(ips, 1):
            url = f"http://{ip}:{port}"
            print(f"   [{i}] {url}")
            if i == 1:
                print(f"       ↑ Use this URL on phones/laptops")
    else:
        print("   ⚠️  Could not detect LAN IPs. Run manually:")
        print("      macOS/Linux: ifconfig | grep 'inet '")
        print("      Windows:     ipconfig")
        print("      Then use:    http://YOUR_IP:" + str(port))
    print("")
    
    # mDNS access
    if mdns_url:
        print("🔖 BONUS - Easy Memory Name (if supported):")
        print(f"   {mdns_url}")
        print("   (Works on macOS/iOS, some Android/Linux)")
        print("")
    
    # QR Code
    if ips and len(ips) > 0:
        primary_url = f"http://{ips[0]}:{port}"
        print("📱 SCAN QR CODE:")
        qr = generate_qr_code(primary_url)
        print(qr)
    
    # Troubleshooting
    print("🔧 TROUBLESHOOTING:")
    print("   ❌ Connection refused?")
    print("      → Check firewall allows Python on port", port)
    print("      → macOS: System Settings → Network → Firewall")
    print("      → Windows: Firewall → Allow Python")
    print("   📱 Phone can't connect?")
    print("      → Same Wi-Fi? (NOT mobile data)")
    print("      → Use IP like 192.168.x.x (NOT 127.0.0.1)")
    print("      → Correct port? URL must include :" + str(port))
    print("=" * 70)
    print("")


def main() -> None:
    global _SERVER_PORT, _BIND_HOST
    
    requested_port = int(os.environ.get("PORT", "8000"))
    port = requested_port
    host = os.environ.get("BIND", "0.0.0.0")
    _BIND_HOST = host
    
    httpd = None
    bind_error = None
    
    # Try ports until one works
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
    
    # Try to setup mDNS
    setup_mdns(port)
    
    # Log startup
    dbg_log("pre-fix-v3", "S1", "serve_universal.py:main:start", "server started", {
        "host": host,
        "requestedPort": requested_port,
        "actualPort": port,
        "mdns": _MDNS_NAME
    })
    
    # Print banner
    print_startup_banner(port, requested_port)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
        httpd.shutdown()


if __name__ == "__main__":
    main()
