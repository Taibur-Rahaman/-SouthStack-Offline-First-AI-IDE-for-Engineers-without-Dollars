#!/usr/bin/env python3
"""
Automated signaling-level stability probe for SouthStack P2P.
Simulates one host and two peers repeatedly for a fixed duration.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "serve_with_signal.py")


def http_get(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.getcode(), r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return e.code, body


def http_post(url: str, body: dict) -> tuple[int, str]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.getcode(), r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return e.code, body_txt


def wait_ping(base: str, timeout_s: int = 15) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        code, _ = http_get(f"{base}/api/southstack/ping")
        if code in (200, 204):
            return
        time.sleep(0.25)
    raise RuntimeError("server ping timeout")


def wait_ping_with_server(base: str, proc: subprocess.Popen[str], timeout_s: int = 30) -> None:
    """Wait for ping, but fail fast with server logs if startup crashes."""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if proc.poll() is not None:
            out, err = proc.communicate(timeout=1)
            raise RuntimeError(
                "server exited before ping became ready\n"
                f"exit={proc.returncode}\n"
                f"stdout:\n{out}\n"
                f"stderr:\n{err}"
            )
        try:
            code, _ = http_get(f"{base}/api/southstack/ping")
            if code in (200, 204):
                return
        except urllib.error.URLError:
            pass
        time.sleep(0.25)
    raise RuntimeError("server ping timeout")


def probe(base: str, duration_s: int = 120) -> dict:
    started = time.time()
    room = "probe-room"
    loops = 0
    failures = 0
    reconnect_events = 0

    while time.time() - started < duration_s:
        loops += 1
        offer = f"offer-sdp-{loops}-{int(time.time()*1000)}"
        answer_1 = f"answer-a-{loops}-{int(time.time()*1000)}"
        answer_2 = f"answer-b-{loops}-{int(time.time()*1000)}"

        c, _ = http_post(f"{base}/api/southstack/offer", {"room": room, "sdp": offer})
        if c != 200:
            failures += 1
            continue

        c, body = http_get(f"{base}/api/southstack/offer?room={urllib.parse.quote(room)}")
        if c != 200 or offer not in body:
            failures += 1
            continue

        # peer 1 joins
        c, _ = http_post(f"{base}/api/southstack/answer", {"room": room, "sdp": answer_1})
        if c != 200:
            failures += 1
            continue
        c, body = http_get(f"{base}/api/southstack/answer?room={urllib.parse.quote(room)}")
        if c != 200 or answer_1 not in body:
            failures += 1
            continue

        # host creates new guest offer, peer 2 joins
        c, _ = http_post(f"{base}/api/southstack/offer", {"room": room, "sdp": offer + "-next"})
        if c != 200:
            failures += 1
            continue
        c, _ = http_post(f"{base}/api/southstack/answer", {"room": room, "sdp": answer_2})
        if c != 200:
            failures += 1
            continue
        c, body = http_get(f"{base}/api/southstack/answer?room={urllib.parse.quote(room)}")
        if c == 200 and answer_2 in body:
            reconnect_events += 1
        else:
            failures += 1

        time.sleep(0.4)

    return {
        "duration_s": duration_s,
        "loops": loops,
        "failures": failures,
        "reconnect_events": reconnect_events,
        "pass": failures == 0 and reconnect_events > 0,
    }


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    duration_s = int(os.environ.get("PROBE_SECONDS", "120"))
    base = f"http://127.0.0.1:{port}"

    external = os.environ.get("USE_EXTERNAL_SERVER", "0") == "1"
    proc = None
    if not external:
        proc = subprocess.Popen(
            [sys.executable, SERVER],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    try:
        if external:
            wait_ping(base, timeout_s=30)
        else:
            wait_ping_with_server(base, proc, timeout_s=30)
        result = probe(base, duration_s=duration_s)
        print(json.dumps(result, indent=2))
        if not result["pass"]:
            raise SystemExit(2)
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
